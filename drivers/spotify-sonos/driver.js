'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

const SonosClient = require('../../lib/SonosClient');

module.exports = class SpotifySonosDriver extends OAuth2Driver {

	/**
	 * Extends the OAuth2Driver pair flow. super.onPair wires up OAuth2 login
	 * and `list_devices`; we add handlers for our custom `discover_sonos`
	 * view (SSDP discovery + manual IP entry).
	 */
	async onPairListDevices() {
		this.log('pair: onPairListDevices — running SSDP discovery');
		const found = await SonosClient.discover(4000);
		this.log(`pair: onPairListDevices — ${found.length} speaker(s) found`);
		return found.map(({ name, ip, uuid }) => ({
			name,
			data: { uuid },
			store: { ip },
		}));
	}

};
