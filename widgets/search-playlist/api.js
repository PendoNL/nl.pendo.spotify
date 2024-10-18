'use strict';

module.exports = {
  async getDevices({ homey, query }) {
    var res = await homey.app.getDevices();

    return res.devices.map(device => {
      const {
        id,
        name,
      } = device;

      return {
        "device_id": id,
        "name": name
      };
    });
  }
};
