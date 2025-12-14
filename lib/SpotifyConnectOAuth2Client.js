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

  async search(query, type = 'track', limit = 10) {
    return this.get({
      path: '/search',
      query: {
        q: query,
        type: type,
        limit: limit
      }
    });
  }

  async playTrack(deviceId, trackUri) {
    return this.put({
      path: '/me/player/play',
      query: { device_id: deviceId },
      json: { uris: [trackUri] }
    });
  }

  async playContext(deviceId, contextUri) {
    return this.put({
      path: '/me/player/play',
      query: { device_id: deviceId },
      json: { context_uri: contextUri }
    });
  }

  async getMyPlaylists(limit = 50) {
    return this.get({
      path: '/me/playlists',
      query: { limit }
    });
  }

  async addToQueue(deviceId, uri) {
    return this.post({
      path: '/me/player/queue',
      query: {
        uri: uri,
        device_id: deviceId
      }
    });
  }

  async addToQueueAndSkip(deviceId, uri) {
    try {
      await this.addToQueue(deviceId, uri);
      await this.next(deviceId);
    } catch (error) {
      // Queue API requires active playback - fall back to direct play
      if (error.status === 404 || error.statusCode === 404) {
        await this.playTrack(deviceId, uri);
      } else {
        throw error;
      }
    }
  }

}