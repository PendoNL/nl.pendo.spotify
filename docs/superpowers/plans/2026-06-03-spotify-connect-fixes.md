# Spotify Connect Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five issues from spec `docs/superpowers/specs/2026-06-03-spotify-connect-fixes-design.md` — transfer-on-play, three-branch sync availability, capability listener race conditions, playlist pagination with cache, and device ID self-heal.

**Architecture:** Direct edits to existing files (`lib/SpotifyConnectOAuth2Client.js`, `drivers/spotify-connect/driver.js`, `drivers/spotify-connect/device.js`, `app.js`). No new files. No new dependencies. The spec is the source of truth for all design decisions.

**Tech Stack:** Node.js, Homey App SDK v3, `homey-oauth2app` library, Spotify Web API.

**Testing approach:** This project has no unit-test framework and Homey runtime dependencies (capabilities, OAuth2 sessions, image registry) make in-process unit testing impractical without significant scaffolding. Verification is by static `homey app validate` plus the manual smoke checklist from the spec's "Verification plan" section. Each task ends with the relevant smoke check before committing.

**Spec → Task map:**
- Spec §1 (Transfer-on-play) → Tasks 1, 6
- Spec §2 (Three-branch sync) → Task 5
- Spec §3 (Capability listeners) → Tasks 6, 7
- Spec §4 (Playlist pagination + cache) → Tasks 2, 3
- Spec §5 (Self-heal) → Tasks 4, 5
- Versioning & changelog → Task 8

---

## File responsibilities

- `lib/SpotifyConnectOAuth2Client.js` — Spotify Web API client. Holds the cache for playlists (lives on the client so it follows the OAuth session).
- `drivers/spotify-connect/driver.js` — `onPairListDevices` — records `spotifyName` and `spotifyType` in the pair-time store.
- `drivers/spotify-connect/device.js` — `_sync` loop, capability listeners, lookup-with-self-heal, lazy migration of the new store fields.
- `app.js` — flow card autocomplete listeners (only the `play_playlist` one is touched).

---

## Task 1: OAuth2Client — add `transferPlayback`, fix `play()`, wake-first in `playTrack` / `playContext`

**Files:**
- Modify: `lib/SpotifyConnectOAuth2Client.js`

**Why first:** All transfer-related client changes land in one cohesive commit. Wake-first inside `playTrack` / `playContext` is what makes the existing `play_song` / `play_artist` / `play_album` / `play_playlist` flow cards work on idle devices without any changes in `app.js`.

- [ ] **Step 1: Locate `play()` and confirm the bug**

Open `lib/SpotifyConnectOAuth2Client.js`. Current `play()` (lines 53-60):

```js
async play(deviceId) {
  return this.put({
    path: '/me/player/play',
    json: {
      'device_id': deviceId,
    }
  });
}
```

`device_id` is in `json` (body). Spotify expects it as a query parameter; in the body it is silently dropped.

- [ ] **Step 2: Fix `play()` and add `transferPlayback`**

Replace `play()` and add `transferPlayback()` immediately after it:

```js
async play(deviceId) {
  return this.put({
    path: '/me/player/play',
    query: { device_id: deviceId },
  });
}

async transferPlayback(deviceId, play = true) {
  return this.put({
    path: '/me/player',
    json: {
      device_ids: [deviceId],
      play,
    },
  });
}
```

Notes:
- `device_id` is now in `query`, matching `playTrack` / `playContext` / `volume` / `repeat` / `shuffle`.
- `transferPlayback` uses `json` (Spotify requires the body shape `{ device_ids: [...], play: bool }`).

- [ ] **Step 3: Make `playTrack` wake-first**

Find `playTrack` (around lines 125-131). Replace with:

```js
async playTrack(deviceId, trackUri) {
  await this.transferPlayback(deviceId, false);
  return this.put({
    path: '/me/player/play',
    query: { device_id: deviceId },
    json: { uris: [trackUri] },
  });
}
```

The `transferPlayback(deviceId, false)` activates the device without starting the previously-queued content; the subsequent `PUT /me/player/play` then starts the requested track. Two API calls instead of one — accepted trade-off per spec §1.

- [ ] **Step 4: Make `playContext` wake-first**

Find `playContext` (around lines 133-139). Replace with:

```js
async playContext(deviceId, contextUri) {
  await this.transferPlayback(deviceId, false);
  return this.put({
    path: '/me/player/play',
    query: { device_id: deviceId },
    json: { context_uri: contextUri },
  });
}
```

`addToQueueAndSkip` is not modified directly — its existing 404 fallback to `playTrack` inherits the wake-first behaviour transparently, so the `play_song` flow card path is covered.

- [ ] **Step 5: Validate**

Run: `homey app validate`
Expected: validation passes.

- [ ] **Step 6: Smoke**

Run: `homey app run`

- Ensure a paired Spotify device is idle in Spotify (was playing recently but currently paused / not the active target).
- Fire the "Play an album" flow card pointed at that device, picking any album.
- Expected: the device wakes and starts playing the chosen album within a few seconds.
- Repeat with "Play a playlist" and "Play an artist" cards.
- Expected: same behaviour.
- Repeat with "Play a song" (which uses `addToQueueAndSkip`).
- Expected: device wakes and plays the song. (First attempt may 404 on the queue endpoint internally, then fall back to wake-first `playTrack`.)

- [ ] **Step 7: Commit**

```bash
git add lib/SpotifyConnectOAuth2Client.js
git commit -m "Add transferPlayback, fix play(), wake-first playback

play() previously sent device_id in the JSON body; Spotify expects it
as a query parameter. transferPlayback wraps PUT /me/player. playTrack
and playContext now transfer-first so idle devices wake before
playback starts, fixing the flow cards reported in community thread."
```

---

## Task 2: OAuth2Client — full pagination + in-memory cache for playlists

**Files:**
- Modify: `lib/SpotifyConnectOAuth2Client.js`

**Why now:** Self-contained client change. The call sites stay on `getMyPlaylists()` until Task 3 swaps them to the cached version, so this task is safe to land in isolation.

- [ ] **Step 1: Rewrite `getMyPlaylists` as full-paginated**

Replace the current `getMyPlaylists` (lines 141-146) with:

```js
async getMyPlaylists() {
  const items = [];
  let offset = 0;
  const limit = 50;
  const maxPages = 50;

  for (let page = 0; page < maxPages; page++) {
    let response;
    try {
      response = await this.get({
        path: '/me/playlists',
        query: { limit, offset },
      });
    } catch (err) {
      if (err.statusCode === 429 && err.headers?.['retry-after']) {
        const retryAfterMs = parseInt(err.headers['retry-after'], 10) * 1000;
        await new Promise(r => setTimeout(r, retryAfterMs));
        response = await this.get({
          path: '/me/playlists',
          query: { limit, offset },
        });
      } else {
        throw err;
      }
    }

    if (Array.isArray(response.items)) {
      items.push(...response.items);
    }

    if (!response.next) break;
    offset += limit;
  }

  return { items };
}
```

Notes:
- Loop terminates when `response.next` is null (Spotify's pagination signal).
- 50-page cap (2,500 playlists) prevents runaway loops.
- One single 429 retry honouring `Retry-After`; subsequent 429s propagate.
- Return shape is `{ items }` so existing callers (`app.js:67`) see no signature change.

- [ ] **Step 2: Add the cache field in the class**

At the top of the class body (just below the static fields), add the cache state:

```js
static PLAYLIST_CACHE_TTL_MS = 5 * 60 * 1000;
```

Inside the class, initialise instance fields in `onInit` (which already exists at line 22). Add to the end of `onInit`:

```js
this._playlistCache = null;
this._playlistCacheAt = 0;
this._playlistCachePromise = null;
```

- [ ] **Step 3: Add `getAllPlaylistsCached`**

After `getMyPlaylists()`, add:

```js
async getAllPlaylistsCached() {
  const now = Date.now();
  const ttl = this.constructor.PLAYLIST_CACHE_TTL_MS;

  if (this._playlistCache && (now - this._playlistCacheAt) < ttl) {
    return this._playlistCache;
  }

  if (this._playlistCachePromise) {
    return this._playlistCachePromise;
  }

  this._playlistCachePromise = (async () => {
    try {
      const result = await this.getMyPlaylists();
      this._playlistCache = result;
      this._playlistCacheAt = Date.now();
      return result;
    } finally {
      this._playlistCachePromise = null;
    }
  })();

  return this._playlistCachePromise;
}
```

Notes:
- Concurrent callers during the first fetch wait on the in-flight promise rather than firing parallel fetches.
- TTL is checked against the time the cache was *written*, so an in-progress refresh doesn't reset the clock until it succeeds.

- [ ] **Step 4: Validate**

Run: `homey app validate`
Expected: passes.

- [ ] **Step 5: Smoke (deferred)**

No call site uses these yet. Smoke happens at the end of Task 3.

- [ ] **Step 6: Commit**

```bash
git add lib/SpotifyConnectOAuth2Client.js
git commit -m "Paginate getMyPlaylists, add 5-min cache layer

Loops /me/playlists?limit=50&offset=N until exhausted, capped at 50
pages. getAllPlaylistsCached memoises the full result for 5 minutes;
concurrent callers share the in-flight promise."
```

---

## Task 3: app.js — wire playlist autocomplete to the cache

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Switch the autocomplete listener to the cached call**

In `app.js`, at the `play_playlist` autocomplete listener (around line 65-81), change:

```js
const results = await oAuth2Client.getMyPlaylists(50);
```

to:

```js
const results = await oAuth2Client.getAllPlaylistsCached();
```

The rest of the listener (filter + map) stays identical.

- [ ] **Step 2: Validate**

Run: `homey app validate`
Expected: passes.

- [ ] **Step 3: Smoke**

Run the app on Homey: `homey app run`
Open the Flow editor in Homey, add a "Play a playlist" action card.
- Type a query that matches a playlist beyond the first 50 alphabetically (e.g., "Daily Mix" if you have one).
- Expected: the playlist shows up in the autocomplete.
- Type a query that matches a manually-created playlist.
- Expected: still shows up.

If the autocomplete is empty on first keystroke for several seconds, that's the cache warming up (full pagination on first call). Subsequent keystrokes within 5 minutes should be instant.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "Wire play_playlist autocomplete to cached full library

Replaces single-page fetch with cached pagination so playlists past
the first 50 (Daily Mix, etc.) are findable. Cache TTL 5 min."
```

---

## Task 4: driver.js + device.js — pair-time store, prefer store.id over data.id

**Files:**
- Modify: `drivers/spotify-connect/driver.js`
- Modify: `drivers/spotify-connect/device.js`

**Why before Task 5:** Task 5's self-heal predicate needs `spotifyName` / `spotifyType` to live somewhere. This task adds them to the pair payload, but the heal logic itself is part of Task 5.

- [ ] **Step 1: Add store fields to `onPairListDevices`**

In `drivers/spotify-connect/driver.js`, change the return shape of the map:

```js
return res.devices.map(device => {
  const { id, name, type } = device;

  return {
    name,
    data: {
      id,
    },
    store: {
      spotifyName: name,
      spotifyType: type,
    },
  };
});
```

This only affects future pair operations. Existing devices have empty `store.spotifyName` — Task 5 handles the lazy migration.

- [ ] **Step 2: Prefer `store.id` over `data.id` in `onOAuth2Init`**

In `drivers/spotify-connect/device.js`, change the `_id` assignment at the top of `onOAuth2Init` (line 17-21):

```js
onOAuth2Init() {
  this._id = this.getStoreValue('id') || this.getData().id;
  this.syncInterval = setInterval(() => this._sync(), SYNC_INTERVAL);
  ...
```

`data.id` is immutable post-pair so it remains as the bootstrap value. After a self-heal (Task 5), the freshly-adopted ID is written to `store.id`, and on next app restart it takes precedence.

- [ ] **Step 3: Validate**

Run: `homey app validate`
Expected: passes.

- [ ] **Step 4: Smoke**

No observable behaviour change for existing devices. To verify the pair-time write:
- Pair a new Spotify device (or re-pair an existing one).
- Use Homey's developer tools (`http://<homey-ip>/manager/devices/...` or the dev page) to inspect the device's `store` object.
- Expected: `spotifyName` and `spotifyType` fields are present.

If you don't want to re-pair right now, skip and verify after Task 5's smoke.

- [ ] **Step 5: Commit**

```bash
git add drivers/spotify-connect/driver.js drivers/spotify-connect/device.js
git commit -m "Persist spotifyName/spotifyType at pair, prefer store.id

Pair-time store now records the Spotify-reported name and type so
sync-time self-heal can recover when Spotify reassigns the device ID.
onOAuth2Init prefers store.id when present so a healed ID survives
restart."
```

---

## Task 5: device.js — three-branch sync with self-heal, null guard, lazy migration

**Files:**
- Modify: `drivers/spotify-connect/device.js`

**Largest task in the plan.** All changes live within `_sync()` and a new helper. Read the spec sections §2 and §5 before starting.

- [ ] **Step 1: Add the `_lookupDevice` helper**

Add a new method on the class, placed just above the existing `device(deviceId)` method (around line 117):

```js
async _lookupDevice() {
  const { devices } = await this.oAuth2Client.getDevices();
  let device = devices.find(d => d.id === this._id);

  if (!device) {
    const storedName = this.getStoreValue('spotifyName');
    const storedType = this.getStoreValue('spotifyType');

    if (storedName && storedType) {
      const matches = devices.filter(
        d => d.name === storedName && d.type === storedType
      );

      if (matches.length === 1) {
        device = matches[0];
        this.log(
          `Self-healed device ID: ${this._id} → ${device.id} (${storedName})`
        );
        this._id = device.id;
        await this.setStoreValue('id', device.id);
      }
    }
  }

  if (!device) return { status: 'missing' };
  return { status: device.is_active ? 'active' : 'idle', device };
}
```

Notes:
- One `/me/player/devices` call serves both the primary lookup and the self-heal scan.
- `matches.length === 1` is the only auto-heal case; zero or multiple matches fall through to `missing` so we never adopt the wrong device.
- The original `device(deviceId)` method (lines 117-121) stays for backwards compat with anything that may use it externally — it's untouched.

- [ ] **Step 2: Rewrite `_sync()`**

Replace the entire `_sync()` method (lines 184-227) with:

```js
_sync() {
  Promise.resolve().then(async () => {
    const result = await this._lookupDevice();

    if (result.status === 'missing') {
      await this.setUnavailable();
      return;
    }

    if (!this.getStoreValue('spotifyName')) {
      await this.setStoreValue('spotifyName', result.device.name);
      await this.setStoreValue('spotifyType', result.device.type);
    }

    await this.setAvailable();

    const volume = result.device.volume_percent / 100;
    this.setCapabilityValue('volume_set', volume);
    this.setCapabilityValue('volume_mute', volume === 0);

    if (result.status === 'idle') {
      this.setCapabilityValue('speaker_playing', false);
      this.setCapabilityValue('speaker_track', '');
      this.setCapabilityValue('speaker_artist', '');
      this.setCapabilityValue('speaker_album', '');
      this.image.setUrl(null);
      await this.image.update();
      return;
    }

    const state = await this.state();

    this.setCapabilityValue('speaker_playing', state.is_playing);
    this.setCapabilityValue('speaker_shuffle', state.shuffle_state);
    this.setCapabilityValue(
      'speaker_repeat',
      state.repeat_state === 'track' ? 'track'
        : state.repeat_state === 'context' ? 'playlist'
        : 'none'
    );

    if (state.item) {
      const artist = state.item.artists.map(a => a.name).join(' & ');
      this.setCapabilityValue('speaker_artist', artist);
      this.setCapabilityValue('speaker_album', state.item.album.name);
      this.setCapabilityValue('speaker_track', state.item.name);

      const cover = state.item.album.images.find(img => img.url)?.url;
      if (cover) {
        this.image.setUrl(cover);
        await this.image.update();
      }
    }
  }).catch(err => {
    this.error(err);
    this.setUnavailable(err).catch(this.error);
  });
}
```

Notes:
- `volume` is written in both branches because the devices endpoint provides it regardless of active state.
- `volume_mute` is recomputed from `volume === 0` so the muted indicator reflects reality even after external changes.
- Idle branch clears track/artist/album/art unconditionally so the tile reflects "nothing playing here right now."
- Active branch's `state.item` null guard skips track metadata writes during ad transitions / podcast skips but still writes `speaker_playing`, `speaker_shuffle`, `speaker_repeat`.
- Lazy migration writes `spotifyName` / `spotifyType` the first time an existing device is reached after the upgrade.

- [ ] **Step 3: Validate**

Run: `homey app validate`
Expected: passes.

- [ ] **Step 4: Smoke — active device path**

Run: `homey app run`

- Start playing music on a paired Spotify device.
- Open the device tile in Homey app.
- Expected within 15 s: tile shows the track, artist, album art, `speaker_playing = true`, volume reflects Spotify.

- [ ] **Step 5: Smoke — idle device path**

- Pause playback (or transfer playback to a different device).
- Expected within 15 s: tile stays *available* (no red exclamation), `speaker_playing` flips to false, track/artist/album/art clear.

This is the core bug fix from the community thread. If the tile goes unavailable here, `_lookupDevice` is mis-classifying. Re-read step 1.

- [ ] **Step 6: Smoke — missing device path**

- Close the Spotify app on every device you have (so the paired device drops out of `/me/player/devices`).
- Wait up to a minute (devices need to lose their token).
- Expected: tile goes unavailable.

- [ ] **Step 7: Smoke — self-heal path**

- Force a Spotify device-ID reassignment: easiest method is reboot a Sonos or hardware player that has Spotify Connect.
- After it comes back online and is reachable in Spotify:
- Expected within 15 s: device stays/becomes available (auto-adopted new ID). Check the app log for the line `Self-healed device ID: <old> → <new> (<name>)`.

If you don't have a hardware player handy, skip this and rely on the spec.

- [ ] **Step 8: Smoke — lazy migration for existing devices**

For any device paired before this change:
- Wait one sync cycle while the device is reachable.
- Inspect the device's store via Homey dev tools.
- Expected: `spotifyName` and `spotifyType` are now populated.

- [ ] **Step 9: Commit**

```bash
git add drivers/spotify-connect/device.js
git commit -m "Three-branch sync with self-heal and idle-state handling

_sync now distinguishes active / idle / missing. Idle devices stay
available with cleared playback caps; missing devices try a name+type
self-heal before going unavailable. state.item null no longer throws.
Existing devices lazily snapshot spotifyName/spotifyType on first
successful sync."
```

---

## Task 6: device.js — fix play/pause listener, route via transferPlayback

**Files:**
- Modify: `drivers/spotify-connect/device.js`

- [ ] **Step 1: Rewrite `_onCapabilitySpeakerPlaying`**

Find the current method (lines 178-182):

```js
_onCapabilitySpeakerPlaying() {
  this.devicePlaying = !this.devicePlaying;
  return this.playing(this._id, this.devicePlaying);
}
```

Replace with:

```js
_onCapabilitySpeakerPlaying(value) {
  if (value) {
    return this.oAuth2Client.transferPlayback(this._id, true);
  }
  return this.oAuth2Client.pause(this._id);
}
```

Notes:
- Uses the value Homey passes in directly. No cache read, no race.
- `value === true` (resume) goes through `transferPlayback(id, true)` so an idle device wakes and starts playing whatever was queued.
- `value === false` (pause) just pauses; pausing an idle device is a safe no-op for Spotify.
- The old `playing()` helper on the device class is now bypassed for this listener but still used by `_sync`-adjacent code? Check: `grep -n "this.playing(" drivers/spotify-connect/device.js`. If unused after this change, leave the `playing()` method in place for Task 7's cleanup pass.

- [ ] **Step 2: Validate**

Run: `homey app validate`
Expected: passes.

- [ ] **Step 3: Smoke — play wakes an idle device**

Run: `homey app run`

- Make sure the target Spotify device is paired in Homey, not currently playing, and you've had something playing on it recently (so Spotify has queue context to resume).
- In Homey, tap the play button on the device tile.
- Expected: the device wakes and starts playing within a couple of seconds. No need to manually switch playback first.

- [ ] **Step 4: Smoke — pause from playing**

- With the device playing, tap pause on the tile.
- Expected: playback stops on that device.

- [ ] **Step 5: Smoke — play when it's already playing**

- With the device already playing, fire the "Play" flow card.
- Expected: no-op (Spotify treats transfer-with-play on the active device as a no-op, no double-track skip).

- [ ] **Step 6: Commit**

```bash
git add drivers/spotify-connect/device.js
git commit -m "Fix speaker_playing listener: use value, route via transfer

Old listener toggled a stale cached boolean every call, causing
play/pause inversions reported in community thread post 125. Now uses
the value Homey passes and routes resume through transferPlayback so
idle devices wake correctly."
```

---

## Task 7: device.js — rewrite shuffle/repeat/mute/volume_up/volume_down listeners

**Files:**
- Modify: `drivers/spotify-connect/device.js`

**Why:** Same race condition as Task 6, applied uniformly to all remaining listeners that toggled a stale cached boolean / enum.

- [ ] **Step 1: Rewrite `_onCapabilitySpeakerShuffle`**

Replace lines 138-142:

```js
_onCapabilitySpeakerShuffle(value) {
  return this.oAuth2Client.shuffle(this._id, value);
}
```

- [ ] **Step 2: Rewrite `_onCapabilitySpeakerRepeat`**

Replace lines 144-154:

```js
_onCapabilitySpeakerRepeat(value) {
  this.setCapabilityValue('speaker_repeat', value);
  return this.oAuth2Client.repeat(this._id, value);
}
```

Notes:
- Homey already passes the new enum (`'none'` / `'track'` / `'playlist'`).
- `oAuth2Client.repeat(deviceId, state)` already maps `'playlist'` → `'context'` internally (lines 71-85 of OAuth2Client). No change needed there.
- The explicit `setCapabilityValue` preserves the previous behaviour of immediately reflecting the requested mode in the UI without waiting for the next sync.

- [ ] **Step 3: Rewrite `_onCapabilitySpeakerVolumeUp` and `_onCapabilitySpeakerVolumeDown`**

Replace lines 160-170:

```js
_onCapabilitySpeakerVolumeUp() {
  const current = this.getCapabilityValue('volume_set') ?? 0;
  const next = Math.min(1, current + 0.01);
  return this.volume(this._id, next);
}

_onCapabilitySpeakerVolumeDown() {
  const current = this.getCapabilityValue('volume_set') ?? 0;
  const next = Math.max(0, current - 0.01);
  return this.volume(this._id, next);
}
```

Notes:
- Reads the current value from Homey's capability store, not a local cache.
- Bump stays at 0.01 (1%) per Joshua's call.
- Clamping prevents Spotify rejecting `volume_percent > 100` or `< 0`.

- [ ] **Step 4: Rewrite `_onCapabilitySpeakerVolumeMute`**

Replace lines 172-176:

```js
async _onCapabilitySpeakerVolumeMute(value) {
  if (value) {
    const current = this.getCapabilityValue('volume_set') ?? 0;
    if (current > 0) {
      await this.setStoreValue('preMuteVolume', current);
    }
    return this.volume(this._id, 0);
  }
  const stored = this.getStoreValue('preMuteVolume');
  const restore = (typeof stored === 'number' && stored > 0) ? stored : 0.5;
  return this.volume(this._id, restore);
}
```

Notes:
- `preMuteVolume` lives in store (persists across restarts), not in-memory.
- Falls back to 0.5 if the user mutes from a fresh install or unmutes without a prior mute.

- [ ] **Step 5: Remove unused in-memory cache fields**

Search for any remaining writes to the cache fields and remove them:

```bash
grep -n "this\.deviceVolume\|this\.deviceMuted\|this\.deviceShuffling\|this\.deviceRepeatMode\|this\.devicePlaying" drivers/spotify-connect/device.js
```

After Tasks 5-7, the only remaining writes should be in code we just removed. If any survive (e.g., the original `_sync` write into `this.deviceVolume = device.volume_percent / 100` from line 192) — Task 5's rewrite of `_sync` already removed it; double-check no stragglers remain. The `playing()` method on lines 107-111 is now unused; remove it too:

```bash
grep -n "this\.playing(" drivers/spotify-connect/device.js
```

If no callers remain, delete the `playing()` method (lines 107-111).

- [ ] **Step 6: Validate**

Run: `homey app validate`
Expected: passes.

- [ ] **Step 7: Smoke — shuffle**

Run: `homey app run`

- Toggle shuffle on the device tile.
- Expected: shuffle state in Spotify changes to match (verify in the Spotify app).
- Toggle it back.
- Expected: returns to opposite.

- [ ] **Step 8: Smoke — repeat**

- Cycle the repeat capability through none → track → playlist → none on the tile.
- Expected: Spotify's repeat state matches at each step.

- [ ] **Step 9: Smoke — volume up/down**

- Tap volume up several times.
- Expected: volume bumps by 1% each tap on Spotify.

- [ ] **Step 10: Smoke — mute**

- Note the current volume (say 60%).
- Tap mute on the tile.
- Expected: volume goes to 0; Spotify shows muted.
- Tap mute again to unmute.
- Expected: volume restores to 60% (the previous value).
- Restart the app while muted (`homey app run` again), then unmute.
- Expected: still restores to 60% (because `preMuteVolume` is in `store`).

- [ ] **Step 11: Commit**

```bash
git add drivers/spotify-connect/device.js
git commit -m "Drop local-toggle pattern from shuffle/repeat/mute/volume

All listeners now use the value Homey passes (or getCapabilityValue
for relative bumps), eliminating the 15s stale-cache race that could
flip the requested state. volume_mute restore level moves to store
so it survives app restarts."
```

---

## Task 8: Version bump + changelog entry

**Files:**
- Modify: `app.json`
- Modify: `.homeychangelog.json`

- [ ] **Step 1: Bump version in `app.json`**

Open `app.json`, find the `"version"` field (currently `"1.4.1"`), change to `"1.5.0"`. This is a minor bump because the changes are user-visible behaviour fixes and a new internal API path (transferPlayback).

- [ ] **Step 2: Add a changelog entry**

In `.homeychangelog.json`, add a new top-level entry keyed by `"1.5.0"`:

```json
"1.5.0": {
  "en": "Fixes: devices no longer go unavailable when idle, play card now wakes inactive devices via Spotify Connect transfer, play/pause/shuffle/repeat/mute no longer flip the wrong way after external state changes, playlist autocomplete now sees your full library (including Daily Mix), and devices auto-recover when Spotify reassigns their ID."
}
```

Keep the existing entries above untouched.

- [ ] **Step 3: Validate**

Run: `homey app validate`
Expected: passes. The validator checks `app.json` schema and changelog format.

- [ ] **Step 4: Commit**

```bash
git add app.json .homeychangelog.json
git commit -m "Bump version to v1.5.0

Covers Spotify Connect fixes for transfer-on-play, idle device
availability, capability listener races, playlist pagination, and
device ID self-heal."
```

---

## Final verification (after all tasks)

Run the spec's smoke checklist end-to-end against a real Homey + paired Spotify devices:

- [ ] Device active in Spotify → all caps sync as today
- [ ] Device idle but visible → tile available, playback caps cleared, volume reflects API
- [ ] Device missing entirely → tile unavailable
- [ ] "Play" flow card on idle device → wakes and starts playing
- [ ] "Play" flow card on active device → no double-track behaviour
- [ ] "Pause" on active device → pauses
- [ ] `play_playlist` autocomplete with Daily Mix query → returns the match
- [ ] Reboot a Sonos to force ID change → next sync self-heals (check logs)
- [ ] Restart Homey while muted → `volume_set` restores correctly on unmute

If everything passes, the implementation is complete. Push when ready.
