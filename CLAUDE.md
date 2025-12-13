# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Homey app (SDK v3) that provides Spotify Connect integration, allowing users to control Spotify playback through Homey's speaker interface. The app uses OAuth2 authentication via the `homey-oauth2app` library.

## Development Commands

```bash
# Install the app on your Homey for testing
homey app install

# Run the app (development mode)
homey app run

# Validate the app
homey app validate

# Build the app (generates .homeybuild directory)
homey app build

# Publish the app
homey app publish
```

## Setup Requirements

1. Copy `example.env.json` to `env.json`
2. Create a Spotify app at https://developer.spotify.com/dashboard
3. Set redirect URI to `https://callback.athom.com/oauth2/callback`
4. Add your `client_id` and `client_secret` to `env.json`

## Architecture

### Homey App Structure

- **app.js** - Main app entry point, extends `OAuth2App` from homey-oauth2app
- **drivers/spotify-connect/** - The Spotify Connect device driver
  - `driver.js` - Device pairing logic, extends `OAuth2Driver`
  - `device.js` - Device control and state sync, extends `OAuth2Device`
  - `driver.compose.json` - Driver configuration (capabilities, pairing flow)
- **lib/SpotifyConnectOAuth2Client.js** - Spotify API client, extends `OAuth2Client`
- **.homeycompose/app.json** - App manifest source (edit this, not `app.json`)

### Key Patterns

**OAuth2 Flow**: The app uses `homey-oauth2app` which handles token management. The OAuth2Client reads credentials from Homey app settings (`client_id`, `client_secret`).

**Device Sync**: Devices poll Spotify API every 15 seconds (`SYNC_INTERVAL`) to update playback state. The `_sync()` method in device.js fetches current device/player state and updates capabilities.

**Capability Mapping**: Homey speaker capabilities map to Spotify API endpoints:
- `speaker_playing` -> play/pause
- `speaker_next/prev` -> next/previous track
- `speaker_shuffle/repeat` -> shuffle/repeat state
- `volume_*` -> volume control (0-100 percent converted to 0-1 range)

### Configuration

The `app.json` is auto-generated from `.homeycompose/` directory. Always edit `.homeycompose/app.json` for app-level changes and `drivers/*/driver.compose.json` for driver configuration.
