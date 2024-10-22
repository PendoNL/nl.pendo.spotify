'use strict';

const Homey = require('homey');
const { OAuth2Client, fetch } = require('homey-oauth2app');

module.exports = class SpotifyConnectOAuth2Client extends OAuth2Client {
  static CLIENT_ID = '';
  static CLIENT_SECRET = '';

  static API_URL = 'https://api.spotify.com/v1';
  static TOKEN_URL = 'https://accounts.spotify.com/api/token';
  static AUTHORIZATION_URL = 'https://accounts.spotify.com/authorize';
  static SCOPES = [
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'app-remote-control',
      'playlist-read-private',
      'user-library-read'
  ];

  async onInit() {
    this._clientId = this.homey.settings.get('client_id');
    this._clientSecret = this.homey.settings.get('client_secret');
  }

  async getDevices() {
    return this.get({
      path: '/me/player/devices',
    });
  }

  async state() {
    return this.get({
      path: '/me/player',
    });
  }

  async next(deviceId) {
    return this.post({
      path: '/me/player/next',
      json: { 'device_id': deviceId }
    });
  }

  async previous(deviceId) {
    return this.post({
      path: '/me/player/previous',
      json: { 'device_id': deviceId }
    });
  }

  async play(deviceId) {
    return this.put({
      path: '/me/player/play',
      json: {
        'device_id': deviceId,
      }
    });
  }

  async pause(deviceId) {
    return this.put({
      path: '/me/player/pause',
      json: {
        'device_id': deviceId,
      }
    });
  }

  async repeat(deviceId, state) {
    switch(state) {
      case 'none':state = 'off';break;
      case 'track':state = 'track';break;
      case 'playlist':state = 'context';break;
    }

    return this.put({
      path: '/me/player/repeat',
      query: {
        'device_id': deviceId,
        'state': state
      }
    });
  }

  async shuffle(deviceId, state) {
    return this.put({
      path: '/me/player/shuffle',
      query: {
        'device_id': deviceId,
        'state': state
      }
    });
  }

  async volume(deviceId, volume) {
    this.log(volume);

    return this.put({
      path: '/me/player/volume',
      query: {
        'device_id': deviceId,
        'volume_percent': Math.round(volume * 100)
      }
  });
}

}