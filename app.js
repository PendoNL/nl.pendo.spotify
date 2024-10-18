'use strict';

const Homey = require('homey');
const { OAuth2App } = require('homey-oauth2app');

const SpotifyOAuth2Client = require('./lib/SpotifyOAuth2Client');

module.exports = class SpotifyApp extends OAuth2App {

	static OAUTH2_CLIENT = SpotifyOAuth2Client;
	static OAUTH2_DEBUG = true;

	async getDevices() {
		return Homey.getDevices();

		return {
			devices: [
				{'id': '123', 'name': 'Name 1'},
				{'id': '124', 'name': 'Name 2'}
			]
		};
	}

}