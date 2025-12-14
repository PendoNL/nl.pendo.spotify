# ZeroConf Wake Device Feature - Implementation State

## Status: Initial Implementation Complete (Untested)

## Goal
Add "wake device" functionality to the Homey Spotify app by implementing Spotify Connect ZeroConf protocol.

## What Was Built

### Architecture
1. **Pairing Flow**: Homey broadcasts as a fake Spotify Connect device, user taps it in their Spotify app, credentials are captured and stored.
2. **Wake Flow**: Use stored credentials to wake any Spotify Connect device on the network via its local addUser endpoint.

### Files Created
- `lib/SpotifyZeroConfService.js` - Core ZeroConf service handling:
  - mDNS broadcasting via bonjour-service
  - HTTP server for getInfo/addUser endpoints
  - Device discovery on the network
  - Credential storage in Homey settings
  - Wake device functionality

- `api.js` - App-level API endpoints:
  - `GET /discovered-devices`
  - `POST /start-pairing`
  - `POST /stop-pairing`
  - `GET /has-credentials`
  - `POST /wake-device`

- `.homeycompose/flow/actions/wake_device.json` - Flow card for waking devices

### Files Modified
- `app.js` - Added:
  - ZeroConfService initialization
  - Background device discovery
  - Flow card registration for wake_device
  - Helper methods: startPairingMode, stopPairingMode, hasZeroConfCredentials, getDiscoveredDevices, wakeDevice
  - onUninit cleanup

- `settings/index.html` - Added ZeroConf pairing section:
  - Pairing status display
  - Discovered devices list (auto-refreshes every 5s)
  - Start/Stop pairing buttons
  - Pairing instructions

- `package.json` - Added dependency: `bonjour-service`

## Dependencies Added
```bash
npm install bonjour-service spotify-zeroconf
```
Note: spotify-zeroconf was installed but not directly used - we built custom implementation instead.

## Known Concerns / TODO

### Critical: Blob Credential Binding
Research indicates the blob credentials are tied to the receiving device's `unique_id`. This means:
- Credentials captured when connecting to "Homey" (unique_id: ABC)
- May NOT work when sent to "Speaker" (unique_id: XYZ)

**Testing needed** to confirm if this is a blocker.

### Potential Solutions if Blob Binding is an Issue
1. Use the captured credentials to get a reusable auth token instead
2. Investigate if librespot's credential format is more portable
3. Look into spotify-zeroconf's internal credential caching mechanism

### Other TODOs
- [ ] Test on actual Homey hardware (not just `homey app run`)
- [ ] Test mDNS broadcasting doesn't conflict with Homey's mDNS
- [ ] Add error handling for network issues
- [ ] Add timeout for pairing mode
- [ ] Consider adding "Refresh Devices" button to settings

## How to Test

```bash
homey app install
```

1. Open app settings
2. Click "Start Pairing Mode"
3. Open Spotify app on phone
4. Look for "Homey Spotify" in available devices
5. Tap it to pair
6. Check if credentials are captured (status should update)
7. Create a flow with "Wake a Spotify device" action
8. Test waking a device

## Key Resources
- [spotify-zeroconf npm](https://www.npmjs.com/package/spotify-zeroconf)
- [bonjour-service npm](https://www.npmjs.com/package/bonjour-service)
- [Spotify ZeroConf addUser - Sonos Community](https://en.community.sonos.com/controllers-and-music-services-229131/spotify-connect-zeroconf-adduser-call-parameters-6901082)
- [librespot authentication docs](https://github.com/librespot-org/librespot/blob/master/docs/authentication.md)
- [librespot ZeroConf discussion](https://github.com/librespot-org/librespot/discussions/615)

## Code Entry Points
- Service: `lib/SpotifyZeroConfService.js`
- App integration: `app.js` (search for "zeroConf")
- Settings UI: `settings/index.html` (search for "ZeroConf")
- API: `api.js`
- Flow card: `.homeycompose/flow/actions/wake_device.json`
