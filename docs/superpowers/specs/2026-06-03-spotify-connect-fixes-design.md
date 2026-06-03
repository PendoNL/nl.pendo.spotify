# Spotify Connect — Fixes for active-device, playback transfer, play/pause, and playlists

Date: 2026-06-03
Driver: `spotify-connect`

## Context

Five separate bugs reported in community thread `app-pro-spotify-connect/118309` (posts #125, #127, #128), confirmed by code reading:

1. **Devices show unavailable whenever not actively playing.** `_sync()` gates `setAvailable()` on `is_active`, so any device that isn't the current Spotify playback target gets a red exclamation mark in Homey — even though it's still a valid playback target.
2. **The "play" flow card can't transfer playback to an inactive device.** The OAuth2 client calls `PUT /me/player/play` with `device_id` in the JSON body, where Spotify silently drops it. The endpoint expects `device_id` as a query parameter. Also, the endpoint by itself does not wake inactive devices — that requires `PUT /me/player` (Transfer Playback).
3. **Play/pause and other absolute capabilities toggle a stale local cache.** `_onCapabilitySpeakerPlaying` (and similar listeners for shuffle/repeat/mute) flip an in-memory boolean that is up to 15 s stale, so the command sent to Spotify can be the opposite of what the user intended.
4. **Playlists flow card sees only the first 50 user-owned playlists.** `getMyPlaylists` calls a single `/me/playlists?limit=50` with no pagination loop.
5. **Stored Spotify device IDs are never refreshed.** Spotify reassigns Connect device IDs when hardware reconnects (Sonos reboot, AVR power-cycle). The stored ID at pair time becomes dead and the Homey device is permanently broken until manually re-paired.

This spec addresses all five.

## Out of scope

- Sonos driver (handled by a separate branch / spec).
- Spotify search-as-you-type for playlists (would change the autocomplete UX shape).
- Wrapping `next`/`previous`/`volume`/`shuffle`/`repeat` in automatic transfer-playback. Behaviour on inactive devices for those commands is unchanged.
- Skip-by-seconds flow card requested in post #124. Tracked separately.

## Section 1: Transfer-on-play

**Files**: `lib/SpotifyConnectOAuth2Client.js`, `drivers/spotify-connect/device.js`.

### Client changes

Add `transferPlayback(deviceId, play = true)`:

- Calls `PUT /me/player` with body `{ device_ids: [deviceId], play }`.
- Spotify treats this as idempotent on already-active devices.

Fix `play(deviceId)`:

- Move `device_id` from the JSON body to `query`. The endpoint requires it as a query parameter; the current placement is silently dropped.
- This also fixes a latent inconsistency with `playTrack` / `playContext`, which already use `query`.

### Composition rules in `device.js`

| Action | Path |
|---|---|
| `speaker_playing = true` (resume) | `transferPlayback(id, true)` — wakes and starts the previously-queued content. One API call. |
| `speaker_playing = false` (pause) | `pause(id)`. No transfer; pausing an inactive device is a safe no-op. |
| `playTrack(uri)` / `playContext(uri)` flow cards | `transferPlayback(id, false)` (wake without playing), then `playTrack` / `playContext` with the URI. Two API calls. The split avoids a brief blip of the previously-queued content. |

### Trade-off accepted

Every "play" interaction now adds an extra Transfer call (~150–300 ms latency). Acceptable for v1. A later optimisation can skip the transfer when the last successful `_sync()` saw the device as `is_active`.

## Section 2: Three-branch sync

**File**: `drivers/spotify-connect/device.js`.

Replace the existing two-branch `_sync()` (`is_active → sync all` / `else → unavailable`) with three:

1. **Missing from `/me/player/devices`**
   - First run the name + type self-heal (Section 5).
   - If self-heal does not recover an ID, `setUnavailable()`.

2. **Present, `is_active === true`** (current happy path)
   - `setAvailable()`.
   - Fetch `/me/player` and sync all playback caps (track/artist/album/art, playing, shuffle, repeat, volume, mute).
   - Guard: if `state.item` is `null` (ad transitions, podcast skips), skip writing `speaker_track` / `speaker_artist` / `speaker_album` and skip the album-art update, but still set `speaker_playing` / `speaker_shuffle` / `speaker_repeat` and the volume caps. The device is still the active target; we just don't have track metadata for this moment.

3. **Present, `is_active === false`** (idle but reachable)
   - `setAvailable()`.
   - Read `volume_percent` from the `/me/player/devices` entry; set `volume_set` and recompute `volume_mute`.
   - Skip the `/me/player` call entirely (it returns data for whichever device is active, not ours).
   - Clear playback caps: `speaker_playing = false`; blank `speaker_track`, `speaker_artist`, `speaker_album`; `image.setUrl(null)` then `image.update()`.

The three branches share the `setAvailable()` semantics — only "missing" maps to unavailable. Transitions in either direction are correct because every branch unconditionally writes the relevant caps.

## Section 3: Capability listeners — drop the local-toggle pattern

**File**: `drivers/spotify-connect/device.js`.

### Principle

For **absolute setters**, the value Homey passes to the listener is the user's intent, not a read of current state. Using it directly eliminates the race that the `!this.foo` toggle pattern introduces. For **relative bumpers** (`volume_up` / `volume_down`), the staleness window is inherent to the 15 s sync cadence and cannot be eliminated without an extra API call per bump. We accept that and simply remove the redundant in-memory cache.

### Changes

| Listener | Current (buggy) | New |
|---|---|---|
| `_onCapabilitySpeakerPlaying` | toggles `devicePlaying` | `(value) => transferPlayback(id, true)` if `value`, else `pause(id)` |
| `_onCapabilitySpeakerShuffle` | toggles `deviceShuffling` | `(value) => shuffle(id, value)` |
| `_onCapabilitySpeakerRepeat` | rotates `deviceRepeatMode` | `(value) => repeat(id, value)` — Homey passes the enum (`'none'` / `'track'` / `'playlist'`) |
| `_onCapabilitySpeakerVolumeMute` | toggles `deviceMuted` | `(value) => muteHandler(value)` — see below |
| `_onCapabilitySpeakerVolumeUp` | reads / writes `deviceVolume` | reads `getCapabilityValue('volume_set')`, adds `0.01`, clamps to `[0, 1]` |
| `_onCapabilitySpeakerVolumeDown` | same | same, subtracts |
| `_onCapabilitySpeakerVolumeSet` | already correct | unchanged |

### Volume mute

Spotify exposes no real mute API. We continue to fake it via `volume_percent: 0`, but unmuting needs to restore the previous level. Replace the in-memory `deviceVolume` cache with a `store.preMuteVolume` value:

- `value === true` and `getCapabilityValue('volume_set') > 0`: write current volume to `store.preMuteVolume`, then `volume(id, 0)`.
- `value === false`: read `store.preMuteVolume` (fallback `0.5` if unset / `0`), then `volume(id, that)`.

Using `store` rather than memory keeps unmute correct across an app/Homey restart.

### Caches to remove

`devicePlaying`, `deviceShuffling`, `deviceRepeatMode`, `deviceMuted`, `deviceVolume` are all dropped. The capability values held by Homey (refreshed by `_sync()` every 15 s) are the single place where state lives.

## Section 4: Playlist pagination with in-memory cache

**Files**: `lib/SpotifyConnectOAuth2Client.js`, `app.js`.

### Constraint discovered during design

The flow-card autocomplete listener in `app.js:65` fires on every keystroke. Naively expanding `getMyPlaylists` to fetch all pages would trigger up to 50 paginated API calls per character typed.

### Approach

Fetch the full library once per session (with a TTL), cache in memory, filter client-side.

**`getMyPlaylists()`** becomes the full-paginated fetch:

- Loop `limit=50, offset=N` while the response's `next` is non-null.
- Safety cap: 50 pages (2,500 playlists). Anyone beyond that has runaway library state.
- One retry honouring `Retry-After` on 429, then propagate.
- Return shape unchanged: `{ items: [...] }` so callers don't need to know it changed.

**`getAllPlaylistsCached()`** is a thin memoising layer on the same client:

- 5-minute TTL.
- First call after expiry runs the full paginated fetch; concurrent callers during the fetch wait on the in-flight promise.
- Cache is cleared automatically when the OAuth2 session ends (lives on the client instance).

**`app.js` change**: the autocomplete listener calls `getAllPlaylistsCached()` instead of `getMyPlaylists(50)`. The existing `filter(p => p.name.toLowerCase().includes(queryLower))` stays exactly as is.

### Trade-offs

- 5-minute TTL means a newly-created playlist in the Spotify app may take up to 5 minutes to appear in the autocomplete. Acceptable.
- Memory cost: ~hundreds of playlist objects per session. Negligible.
- Sort order: whatever Spotify returns (Library-view order). No custom sort.

## Section 5: Device ID self-heal (name + type)

**Files**: `drivers/spotify-connect/driver.js`, `drivers/spotify-connect/device.js`.

### Why this is needed

Spotify Connect device IDs are not stable across hardware reconnects. The stored ID at pair time can silently die, breaking the Homey device with no remedy other than delete-and-re-pair.

### Pair time (`driver.js`)

`onPairListDevices` already returns `data: { id }`. We add `store: { spotifyName: device.name, spotifyType: device.type }`. `data` is immutable post-pair; `store` is writable, which is what we need for the in-place ID swap below.

### Sync time (`device.js`)

Today `device(deviceId)` returns the matching device or `undefined`. Refactor it to classify into one of three outcomes consumed by Section 2's three-branch sync:

- `{ status: 'active', device }`
- `{ status: 'idle', device }`
- `{ status: 'missing' }`

When the result is `missing`, run the self-heal before declaring unavailable:

1. Scan the same `/me/player/devices` response for entries where
   `entry.name === store.spotifyName && entry.type === store.spotifyType`.
2. **Exactly one match** → adopt:
   - `this._id = match.id`.
   - `await this.setStoreValue('id', match.id)`.
   - Log the swap (`this.log('Self-healed device ID: …')`).
   - Continue the sync with `match` as if it were the original.
3. **Zero or more than one match** → `setUnavailable()`. Silently swapping to the wrong device is worse than failing.

### Reading `_id` after self-heal

`onOAuth2Init` currently reads `this._id = getData().id`. Update to prefer `getStoreValue('id')` when present, falling back to `getData().id`. This way the healed ID survives Homey restarts.

### Migration for already-paired devices

Existing devices have no `spotifyName` / `spotifyType` in `store`. Lazy snapshot on first successful sync (active or idle branch):

- If `store.spotifyName` is unset, write the current `device.name` and `device.type` to store.

Devices already broken before this upgrade (stored ID no longer in the API and no name stored) need a manual re-pair. There is no API path to recover them.

### Edge case: user renames device

The match is on Spotify's friendly name as reported at pair time. If the user renames the device through Spotify or on the device hardware, future self-heal attempts will miss. We accept this; renames are infrequent and re-pairing is the right escape hatch.

## Files touched

- `lib/SpotifyConnectOAuth2Client.js` — add `transferPlayback`, fix `play()` device_id placement, rewrite `getMyPlaylists` as full-paginated, add `getAllPlaylistsCached`.
- `drivers/spotify-connect/driver.js` — add `spotifyName` and `spotifyType` to pair-time store.
- `drivers/spotify-connect/device.js` — rewrite `_sync` three-branch, rewrite capability listeners, add `device()` status return, add self-heal, prefer `store.id` over `data.id` in `onOAuth2Init`, lazy migration of `spotifyName` / `spotifyType`, replace `volume_mute` cache with `store.preMuteVolume`.
- `app.js` — switch autocomplete listener to `getAllPlaylistsCached()`.

## Verification plan (smoke checklist for the implementation phase)

- With device active in Spotify → all caps sync as today.
- With device idle but visible in `/me/player/devices` → tile shows available, playback caps cleared, volume reflects API value.
- With device missing entirely → tile shows unavailable.
- "Play" flow card on an idle device → device wakes and starts playing.
- "Play" flow card on an active device → behaves as today (no double-transfer side effects).
- "Pause" on an active device → pauses.
- `play_playlist` flow card autocomplete with a query matching a Daily Mix → returns the match (verifies pagination).
- Reboot a Sonos to force a Spotify device-ID change → next `_sync()` self-heals.
- Restart Homey while a device is muted → `volume_set` restores correctly on unmute.
