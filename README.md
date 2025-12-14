# Spotify Connect (beta)

This Homey app is currently in development. The main goal of this app is to provided fully working speaker cards (both for the device as on your Homey dashboard).

![Example](https://github.com/PendoNL/nl.pendo.spotify/blob/main/assets/example.png?raw=true)

### How to set this up?

Due to rate limiting in the Spotify API, you need to create a [Spotify app](https://developer.spotify.com/dashboard) yourself. Within the context of just your own devices this should work within these limits.

Choose any app name and description but make sure to set `https://callback.athom.com/oauth2/callback` as redirect URI. When asked which APIs to use select `Web API`.

1. Clone this repository
2. `cp example.env.json env.json`
3. Add your client_id and client_secret to `env.json`
4. Run `homey app install` to get the app installed
5. Add a new device

### Bugs?

I've just started tinkering around with Homey and it's apps. Feel free to create issues if you encouter bugs, but keep in mind this is a sparetime thing and I also need some time adapting to the Homey platform.

### Plans

For feature requests and an active roadmap please visit [the Homey Community topic](https://community.homey.app/t/app-pro-spotify-connect/118309).

### Thanks to

- [Code sample - nl.thermostart-example](https://github.com/athombv/nl.thermosmart-example) by Athom
- [Code sample - io.nuki-example](https://github.com/athombv/io.nuki-example) by Athom
