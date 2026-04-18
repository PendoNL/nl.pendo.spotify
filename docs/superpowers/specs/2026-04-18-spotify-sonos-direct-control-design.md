# Spotify → Sonos Direct Control

Design doc — 2026-04-18

## Problem

Sonos speakers don't show up as transferable Spotify Connect targets in the Spotify Web API. The existing `spotify-connect` driver uses `/me/player/play`, which fails for Sonos. We want Sonos speakers to play Spotify content directly via UPnP — the speaker resolves the URI through its own Spotify integration — while keeping the existing Spotify Connect driver untouched in behavior.

## Goals

- Add Sonos speakers as a first-class device type in this Homey app.
- Reach feature parity with the existing Spotify Connect driver: the same flow cards, capabilities, and widget work against Sonos devices.
- Keep the existing `spotify-connect` driver's observable behavior unchanged.
- Lay groundwork (shared method contract) so adding a third transport later is cheap.

## Non-goals

- Sonos group management (join/leave groups, group-aware flow cards).
- Real-time UPnP event subscriptions — polling at the existing 15s cadence is good enough for v1.
- Search/browse backend changes — Spotify Web API remains the search source.
- A separate OAuth2 login for the new driver — one app-level Spotify session covers both.
- Testing framework adoption — the repo currently has none; we stay minimal.

## Architecture

A new driver `spotify-sonos` sits alongside `spotify-connect` in the same Homey app. Both share the app-level `SpotifyConnectOAuth2Client` (for search). Playback diverges:

- `spotify-connect` → Spotify Web API (existing).
- `spotify-sonos` → UPnP via the `sonos` npm library (new).

Both device classes expose a common method contract so flow-card run listeners and the widget's API are driver-agnostic:

```js
class SpotifyDevice {
  async playTrack(uri)          // spotify:track:...
  async playContext(uri)        // spotify:(album|artist|playlist):...
  async addToQueue(uri)         // adds, falls back to play-now if nothing queued
  async getPlaybackInfo()       // { track, artist, album, progressSeconds, durationSeconds, progressPercent, isPlaying }
}
```

Flow-card run listeners in `app.js` collapse to `await args.device.<method>(args.<item>.uri)` with no driver-type branching. The widget aggregates devices across both drivers.

### Why this shape

- Isolates UPnP concerns inside `drivers/spotify-sonos/`; the Spotify Connect path stays untouched in behavior.
- Collapses the duplication in `app.js`: one flow card, one run listener, works for both.
- Future transports (AirPlay, Chromecast) plug in by implementing the contract.

## Components

### New

- **`lib/SonosClient.js`** — wrapper around `sonos` npm. Exposes `discover(timeoutMs)` (static), `fromIp(ip)` (static), and instance methods matching the common contract plus transport primitives (`play`, `pause`, `next`, `previous`, `setVolume`, `setMuted`, `setShuffle`, `setRepeat`, `getState`). Owns Spotify-URI-to-`setAVTransportURI` formatting — tracks accept the raw URI, but album/artist/playlist URIs need a DIDL-Lite metadata envelope.
- **`drivers/spotify-sonos/driver.compose.json`** — same capability set as `spotify-connect` (`speaker_playing/artist/album/track/shuffle/repeat/next/prev`, `volume_set/up/down/mute`), same `capabilitiesOptions.volume_set` range (-1 to 1, step 0.01) for consistency with the existing driver. Pair flow: `login_oauth2` → custom `discover_sonos` view → `add_devices`. Repair flow: `login_oauth2`.
- **`drivers/spotify-sonos/driver.js`** — `OAuth2Driver` subclass. `onPairListDevices` runs `SonosClient.discover(4000)`. A custom pair view handler also validates a manually-entered IP by calling `getName()` before returning it as a pairable device.
- **`drivers/spotify-sonos/device.js`** — `OAuth2Device` subclass. Stores `{uuid, name, ip}` in device data. Implements the common contract plus capability listeners. Runs the 15s sync loop.
- **`drivers/spotify-sonos/pair/discover_sonos.html`** — list of discovered speakers + "Enter IP manually" input + validation feedback.

### Refactored

- **`lib/SpotifyConnectOAuth2Client.js`** — add a `getPlaybackInfo()` wrapper over `state()` that returns the same shape as the Sonos driver. Existing methods (`playTrack`, `playContext`, `addToQueue`, `addToQueueAndSkip`) stay.
- **`drivers/spotify-connect/device.js`** — expose `playTrack`, `playContext`, `addToQueue`, `getPlaybackInfo` as thin wrappers so it satisfies the common contract. Existing capability listeners and sync unchanged.
- **`app.js`** — each flow-card run listener becomes one line of the form `await args.device.<method>(args.<item>.uri)`. Autocomplete listeners unchanged.
- **`.homeycompose/flow/actions/*.json`** — device-arg filter widened to accept both drivers. Preferred syntax: `driver_id=spotify-connect|spotify-sonos`. If that syntax isn't supported by the Homey CLI/runtime, fall back to removing the filter and filtering acceptable drivers inside each flow card's autocomplete listener.
- **`widgets/song-search/api.js`** — `search` and `play` endpoints look up the target device across both drivers' `getDevices()` and call the common contract.
- **`widgets/song-search/public/index.html`** — add a device picker when more than one device (across drivers) exists; keep current behavior when there's exactly one.

### Dependency

- Add `sonos` to `package.json`. Homey apps run in a sandboxed Node runtime; the `sonos` lib uses UDP multicast for SSDP. If multicast doesn't fire on a user's subnet, discovery returns empty and the manual-IP path handles it — so failure is graceful by construction.

## Data flow

### Pair

1. User adds a Sonos device. OAuth2 login view is shown (reuses existing Spotify session if present — same OAuth2 app-level client as the Spotify Connect driver).
2. `discover_sonos` view runs `SonosClient.discover(4000)`, rendering `{name, ip, uuid}` rows.
3. If discovery returns empty, the view renders an "Enter IP manually" input. On submit, the driver instantiates `SonosClient.fromIp(ip)`, calls `getName()` to validate, and returns the speaker.
4. User selects one or more speakers → `add_devices` persists `{uuid, name, ip}` in device data.

### Playback (e.g. `play_song`)

1. Autocomplete listener (unchanged) calls `device.oAuth2Client.search(query, 'track', 10)`.
2. Run listener: `await device.playTrack(track.uri)`.
3. For Sonos: `SonosClient.setAVTransportURI('spotify:track:…', '')` → `play()`. For context URIs (album/artist/playlist) from `play_album/play_artist/play_playlist`, `SonosClient.playContext(uri)` wraps the URI in a DIDL-Lite metadata envelope before calling `setAVTransportURI`.
4. For `add_to_queue`: Sonos's `addToQueue` requires the current transport to be the queue (`x-rincon-queue:…`); if it isn't, fall back to `playTrack` — matches the existing driver's behavior.

### Sync (15s interval)

1. In parallel: `currentTrack()`, `getVolume()`, `getMuted()`, `getCurrentState()`.
2. Update `speaker_track/artist/album`, `speaker_playing`, `volume_set`, `volume_mute`.
3. Update album-art `Image` via `currentTrack().albumArtURL`.
4. If any call throws `ETIMEDOUT`/`ECONNREFUSED`/`EHOSTUNREACH`: run one SSDP re-resolve by stored UUID, update stored IP if changed, retry once. If still failing → `setUnavailable()`. Next tick retries from scratch.

### Capability → Sonos mapping

| Homey capability | Sonos call |
|---|---|
| `speaker_playing` (true/false) | `play()` / `pause()` |
| `speaker_next` / `speaker_prev` | `next()` / `previous()` |
| `volume_set` (-1..1, step 0.01) | `setVolume(Math.round((v + 1) * 50))` |
| `volume_mute` (bool) | `setMuted(bool)` |
| `speaker_shuffle`, `speaker_repeat` | `setPlayMode(mode)` where `mode` combines both flags (`NORMAL` / `REPEAT_ALL` / `REPEAT_ONE` / `SHUFFLE_NOREPEAT` / `SHUFFLE` / `SHUFFLE_REPEAT_ONE`) |

Shuffle and repeat only take effect when the current Sonos transport is the queue (i.e. a context URI is playing, not a single-track URI). That matches the existing driver's quirk: the Spotify Web API ignores shuffle/repeat changes when there's no active context either. Documented, not fixed.

## Error handling

| Situation | Behavior |
|---|---|
| SSDP discovery returns empty | Pair view shows "No speakers found" + manual-IP input |
| Manual IP doesn't respond | Pair view shows "Could not reach speaker at {ip}" |
| Sonos unreachable during normal operation | Re-resolve IP by UUID once, retry; still failing → `setUnavailable()` with message, resume on next sync |
| Spotify not linked on the Sonos | Catch UPnP fault 800/801 from `setAVTransportURI`; surface "Spotify is not linked on this Sonos speaker. Open the Sonos app → Settings → Services and sign in." |
| Invalid / malformed Spotify URI | Validate `/^spotify:(track\|album\|artist\|playlist\|user):.+$/` before sending; throw a clear error if it doesn't match |
| Spotify Premium required (free account) | Sonos returns a distinguishable UPnP fault; surface "Spotify Premium is required to play on Sonos." |
| `sonos` lib multicast blocked on Homey's network | `discover()` returns empty → manual-IP path is available |

## Testing

- **Manual, with a real speaker.** The spec includes a test script for reviewers:
  1. Pair one speaker via discovery.
  2. Pair one speaker via manual IP.
  3. For each of `play_song`, `play_album`, `play_artist`, `play_playlist`, `add_to_queue`, `get_playback_info` — confirm the action works against both driver types.
  4. Toggle each capability (play/pause, next, prev, volume, mute, shuffle, repeat) from the device tile; verify Sonos reflects it.
  5. Wait 15s after changing state directly on the Sonos app; verify Homey picks up the change.
  6. Unplug the Sonos speaker; verify the device becomes unavailable within ~30s; plug back in; verify it becomes available again.
- **Unit tests for pure helpers** — no test framework added. Small `node:test`-style asserts under `test/` for: URI validation regex, DIDL-Lite envelope builder, play-mode combiner.
- **Regression:** re-run the full manual test script against a Spotify Connect device to confirm the method-contract refactor didn't change observable behavior.

## Risks / open questions

- **Flow-card filter OR syntax:** if `driver_id=spotify-connect|spotify-sonos` isn't accepted by the Homey compose step, we fall back to removing the filter and filtering inside the autocomplete listener. Confirmed during implementation, not now.
- **`sonos` lib on Homey's sandbox:** UDP multicast support in the Homey app runtime. If SSDP never fires, the design still works via manual-IP pairing but discovery UX degrades. If even manual IP fails due to sandbox restrictions on outbound UDP/HTTP-to-LAN, we block on implementation and revisit.
- **Album art on Sonos for Spotify URIs:** `currentTrack().albumArtURL` sometimes returns a relative Sonos-internal URL rather than a Spotify CDN URL. We'll use it as-is (it resolves via the speaker's IP); if that doesn't render in Homey, fall back to `null` and accept no art for Sonos. Decide during implementation.

## Rollout

- Bump app version (`1.4.1` → `1.5.0` — new driver is a minor feature).
- Changelog entry: "Added Sonos driver for direct Spotify playback via UPnP."
- Existing Spotify Connect devices are unaffected by the method-contract refactor (same capabilities, same pair flow).
