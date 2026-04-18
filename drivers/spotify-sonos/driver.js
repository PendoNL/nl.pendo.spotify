'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

const SonosClient = require('../../lib/SonosClient');

module.exports = class SpotifySonosDriver extends OAuth2Driver {

	/**
	 * Extends the OAuth2Driver pair flow. super.onPair wires up OAuth2 login
	 * and `list_devices`; we add handlers for our custom `discover_sonos`
	 * view (SSDP discovery + manual IP entry).
	 */
	async onPair(session) {
		await super.onPair(session);

		let pickedDevices = [];

		session.setHandler('sonos:discover', async () => {
			const found = await SonosClient.discover(4000);
			return found.map(({ name, ip, uuid }) => ({ name, ip, uuid }));
		});

		session.setHandler('sonos:validate_ip', async (ip) => {
			const client = SonosClient.fromIp(ip);
			const name = await client.getName();
			// we don't have a UUID from manual IP; generate a stable id from ip
			return { name, ip, uuid: `manual:${ip}` };
		});

		session.setHandler('sonos:pick', async (devices) => {
			pickedDevices = devices;
			return true;
		});

		// When the pair navigation transitions from discover_sonos to
		// add_devices, the add_devices template will call list_devices.
		// We return whatever the user picked.
		session.setHandler('list_devices', async () => {
			return pickedDevices.map(({ name, ip, uuid }) => ({
				name,
				data: { uuid },
				store: { ip },
			}));
		});
	}

	/**
	 * Unused (custom list_devices above) but kept for parity with the
	 * OAuth2Driver contract.
	 */
	async onPairListDevices() {
		return [];
	}

};
