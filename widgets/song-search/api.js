'use strict';

module.exports = {
  async search({ homey, body }) {
    const { query, deviceId } = body;

    if (!query || query.length < 2) {
      return [];
    }

    if (!deviceId) {
      throw new Error('No device configured');
    }

    const driver = homey.app.homey.drivers.getDriver('spotify-connect');
    const device = driver.getDevices().find(d => d.getData().id === deviceId);

    if (!device) {
      throw new Error('Device not found');
    }

    const results = await device.oAuth2Client.search(query, 'track', 10);

    return results.tracks.items.map(track => ({
      name: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      image: track.album.images[2]?.url || track.album.images[0]?.url,
      uri: track.uri
    }));
  },

  async play({ homey, body }) {
    const { deviceId, trackUri } = body;

    if (!deviceId) {
      throw new Error('No device configured');
    }

    const driver = homey.app.homey.drivers.getDriver('spotify-connect');
    const device = driver.getDevices().find(d => d.getData().id === deviceId);

    if (!device) {
      throw new Error('Device not found');
    }

    await device.oAuth2Client.playTrack(device.getData().id, trackUri);

    return { success: true };
  }
};
