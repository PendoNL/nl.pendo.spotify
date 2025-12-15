'use strict';

module.exports = {

  async getDiscoveredDevices({ homey }) {
    return homey.app.getDiscoveredDevices();
  },

  async startPairing({ homey, body }) {
    const deviceName = body?.deviceName || 'Homey Spotify';
    return homey.app.startPairingMode(deviceName);
  },

  async stopPairing({ homey }) {
    return homey.app.stopPairingMode();
  },

  async hasCredentials({ homey }) {
    return { hasCredentials: homey.app.hasZeroConfCredentials() };
  },

  async wakeDevice({ homey, body }) {
    const { deviceName } = body;
    if (!deviceName) {
      throw new Error('deviceName is required');
    }
    await homey.app.wakeDevice(deviceName);
    return { success: true };
  },

  async resetIdentity({ homey }) {
    return homey.app.resetZeroConfIdentity();
  },

  async wakeDeviceByHost({ homey, body }) {
    const { host, port } = body;
    if (!host) {
      throw new Error('host is required');
    }
    return homey.app.wakeDeviceByHost(host, port || 4070);
  }

};
