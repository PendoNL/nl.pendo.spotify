# Spotify-on-Sonos — Follow-ups After POC

POC status (as of 2026-04-18): playback works end-to-end against a real Sonos speaker via `feat/spotify-sonos`. Pair flow uses standard Homey `list_devices` template; SSDP discovery finds speakers on LAN; `sonos.play(uri)` handles Spotify URI transformation using the EU region.

## Open items

- **Delete `drivers/spotify-sonos/pair/discover_sonos.html`.** The custom pair view was abandoned when we switched to the standard `list_devices` template. The file is still in the tree and in git history but no longer referenced by `driver.compose.json`.

- **Make Spotify region configurable.** `lib/SonosClient.js` currently hard-codes `SpotifyRegion.EU` in the constructor. Non-EU users will hit UPnP 800 errors. Either expose a driver-level setting (Homey app settings UI), detect per-speaker, or add a pair-view dropdown before `list_devices`.

- **Backoff on sync failures.** `drivers/spotify-sonos/device.js` `_sync` fires every 15s. When a speaker is unreachable, we attempt SSDP re-resolve on every tick → 4s SSDP + retry every 15s even when nothing has changed. Add exponential backoff (e.g. 15s → 30s → 60s → capped at 5min) until a successful tick resets it.

- **Manual-IP pairing fallback.** We removed the custom pair view when it stopped working; users whose Homey/Sonos aren't on the same multicast domain now have no way to pair. Options: revive a minimal custom view that works (check Homey's `Homey.emit` event-routing requirements), or add a driver setting "paste IP here" that triggers discovery with a seeded host.

- **Album art for Sonos-local URLs.** We skip any `albumArtUrl` that isn't HTTPS (to satisfy Homey's `Image.setUrl`). Sonos typically returns `http://<speaker-ip>:1400/getaa?...` — valid LAN URL but HTTP. Either proxy the art through the Homey app (fetch + base64 or temp file), or accept no art for Sonos and set a static placeholder.

- **Full manual test plan run.** We skipped most of plan Task 18 during the debug session:
  - `play_song`, `play_album`, `play_artist`, `play_playlist`, `add_to_queue`, `get_playback_info` — confirm each works on Sonos.
  - All capability listeners from the tile (play/pause, next/prev, volume, mute, shuffle, repeat).
  - Regression: re-run the same set against an existing Spotify Connect device.
  - Widget `song-search` smoke test against the Sonos device.
  - Unavailability test: power off the speaker, verify graceful degradation; power back on, verify recovery.

- **Session disconnect log noise during pair iteration.** Multiple pair attempts during debugging left duplicate paired devices and sync intervals multiplying. Once re-testing, purge any duplicates and confirm only one interval runs per device.

- **`OAUTH2_DEBUG = true` in `app.js`.** Pre-existing from before this branch, not a regression here — but OAuth2 tokens are being logged in plaintext. Worth turning off before a real release.

- **`sonos` npm transitive vulnerabilities.** Two high-severity findings in the `ip` package via `sonos@1.14.3`. No fix available without forking; accept or pin differently.

- **Merge strategy.** Branch has 20 commits that tell the debug story. Consider squash-merge to `main` with a single "Add Spotify-on-Sonos driver" commit, or keep history intact for traceability — user preference.
