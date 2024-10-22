'use strict';

const Homey = require('homey');
const { OAuth2Driver } = require('homey-oauth2app');

module.exports = class SpotifyConnectDriver extends OAuth2Driver {

	async onPairListDevices({ oAuth2Client }) {
		const res = await oAuth2Client.getDevices();

		return res.devices.map(device => {
			const {
				id,
				name,
			} = device;

			return {
				name,
				data: {
					'id': id,
				},
			};
		});
	}

}