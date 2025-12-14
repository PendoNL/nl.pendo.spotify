'use strict';

module.exports = {

  // GET /discovered-devices
  async 'GET /discovered-devices'({ homey }) {
    return homey.app.getDiscoveredDevices();
  },

  // POST /start-pairing
  async 'POST /start-pairing'({ homey, body }) {
    const deviceName = body?.deviceName || 'Homey Spotify';
    return homey.app.startPairingMode(deviceName);
  },

  // POST /stop-pairing
  async 'POST /stop-pairing'({ homey }) {
    return homey.app.stopPairingMode();
  },

  // GET /has-credentials
  async 'GET /has-credentials'({ homey }) {
    return { hasCredentials: homey.app.hasZeroConfCredentials() };
  },

  // POST /wake-device
  async 'POST /wake-device'({ homey, body }) {
    const { deviceName } = body;
    if (!deviceName) {
      throw new Error('deviceName is required');
    }
    await homey.app.wakeDevice(deviceName);
    return { success: true };
  }

};
