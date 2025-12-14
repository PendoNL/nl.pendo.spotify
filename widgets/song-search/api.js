'use strict';

module.exports = {
  async search({ homey, body }) {
    try {
      const { query, deviceId } = body;

      homey.app.log(`Widget search: query="${query}", deviceId="${deviceId}"`);

      if (!query || query.length < 2) {
        return [];
      }

      if (!deviceId) {
        throw new Error('No device configured');
      }

      // Get the device directly from the app's driver
      const driver = homey.app.homey.drivers.getDriver('spotify-connect');
      const devices = driver.getDevices();

      homey.app.log(`Found ${devices.length} devices`);
      devices.forEach(d => homey.app.log(`- Device: id=${d.id}, __id=${d.__id}, getData().id=${d.getData().id}, name=${d.getName()}`));

      const device = devices.find(d => d.__id === deviceId);

      if (!device) {
        throw new Error(`Device not found: ${deviceId}`);
      }

      homey.app.log(`Using device: ${device.getName()}`);

      // Search all types at once
      const results = await device.oAuth2Client.search(query, 'track,artist,album,playlist', 20);

      const items = [];

      // Add tracks
      if (results.tracks?.items) {
        results.tracks.items.slice(0, 5).forEach(track => {
          items.push({
            type: 'track',
            name: track.name,
            subtitle: track.artists.map(a => a.name).join(', '),
            image: track.album.images[2]?.url || track.album.images[0]?.url,
            uri: track.uri
          });
        });
      }

      // Add artists
      if (results.artists?.items) {
        results.artists.items.slice(0, 3).forEach(artist => {
          items.push({
            type: 'artist',
            name: artist.name,
            subtitle: `${artist.followers?.total?.toLocaleString() || 0} followers`,
            image: artist.images[2]?.url || artist.images[0]?.url,
            uri: artist.uri
          });
        });
      }

      // Add albums
      if (results.albums?.items) {
        results.albums.items.slice(0, 3).forEach(album => {
          items.push({
            type: 'album',
            name: album.name,
            subtitle: album.artists.map(a => a.name).join(', '),
            image: album.images[2]?.url || album.images[0]?.url,
            uri: album.uri
          });
        });
      }

      // Add playlists
      if (results.playlists?.items) {
        results.playlists.items.filter(p => p !== null).slice(0, 3).forEach(playlist => {
          items.push({
            type: 'playlist',
            name: playlist.name,
            subtitle: `${playlist.tracks?.total || 0} tracks`,
            image: playlist.images?.[0]?.url,
            uri: playlist.uri
          });
        });
      }

      return items;
    } catch (error) {
      homey.app.error(`Widget search error: ${error.message}`, error);
      throw error;
    }
  },

  async play({ homey, body }) {
    try {
      const { deviceId, uri, type } = body;

      if (!deviceId) {
        throw new Error('No device configured');
      }

      const driver = homey.app.homey.drivers.getDriver('spotify-connect');
      const device = driver.getDevices().find(d => d.__id === deviceId);

      if (!device) {
        throw new Error('Device not found');
      }

      // Use the Spotify device ID for the API call
      const spotifyDeviceId = device.getData().id;

      // Tracks: add to queue and skip to play immediately (avoids single-track loop)
      // Others: use playContext to start playing the artist/album/playlist
      if (type === 'track') {
        await device.oAuth2Client.addToQueueAndSkip(spotifyDeviceId, uri);
      } else {
        await device.oAuth2Client.playContext(spotifyDeviceId, uri);
      }

      return { success: true };
    } catch (error) {
      homey.app.error(`Widget play error: ${error.message}`, error);
      throw error;
    }
  }
};
