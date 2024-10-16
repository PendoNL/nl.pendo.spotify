# Spotify Connect (beta)

This Homey app is currently in development. The main goal of this app is to provided fully working speaker cards (both for the device as on your Homey dashboard).

### How to set this up?

Due to rate limiting in the Spotify API, you need to create a [Spotify app](https://developer.spotify.com/dashboard) yourself. Within the context of just your own devices this should work within these limits.

1. Clone this repository
2. `cp example.env.json env.json`
3. Add your client_id and client_secret to `env.json`
4. Run `homey app install` to get the app installed
5. Add a new device

### Bugs?

I've just started tinkering around with Homey and it's apps. Feel free to create issues if you encouter bugs, but keep in mind this is a sparetime thing and I also need some time adapting to the Homey platform.

### Plans

- [X] Get Spotify OAuth2 working
- [X] Get a working Spotify device using this driver
- [X] Implement speaker-related abilities
  - [X] Load player state (artist, song, album, shuffle mode, repeat, volume, playing)
  - [X] Set the album cover media element for the device
  - [X] speaker_previous and speaker_next
  - [X] volume_up, volume_down, volume_mute and volume_set
  - [X] speaker_playing (pause and unpause)
- [ ] Functionality testing
- [ ] Code review & clean-up
- [ ] Publish the app to Homey
- [ ] Add flow action (not sure about this one as the official app supports these already)

For the app to be publishable I need to find a way to turn the client_id and client_secret fields into app settings and have them injected into CLIENT_ID and CLIENT_SECRET constants of `SpotifyOAuth2Client`.