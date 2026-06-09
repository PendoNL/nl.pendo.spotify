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

  static PLAYLIST_CACHE_TTL_MS = 5 * 60 * 1000;

  async onInit() {
    this._clientId = this.homey.settings.get('client_id');
    this._clientSecret = this.homey.settings.get('client_secret');
    this._playlistCache = null;
    this._playlistCacheAt = 0;
    this._playlistCachePromise = null;
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
      query: { device_id: deviceId },
    });
  }

  async transferPlayback(deviceId, play = true) {
    return this.put({
      path: '/me/player',
      json: {
        device_ids: [deviceId],
        play,
      },
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

  async search(query, type = 'track', limit = 10, offset = 0, market = null) {
    const params = {
      q: query,
      type: type,
      limit: limit,
      offset: offset,
    };
    if (market) {
      params.market = market;
    }
    return this.get({
      path: '/search',
      query: params,
    });
  }

  async playTrack(deviceId, trackUri) {
    await this.transferPlayback(deviceId, false);
    return this.put({
      path: '/me/player/play',
      query: { device_id: deviceId },
      json: { uris: [trackUri] },
    });
  }

  async playContext(deviceId, contextUri) {
    await this.transferPlayback(deviceId, false);
    return this.put({
      path: '/me/player/play',
      query: { device_id: deviceId },
      json: { context_uri: contextUri },
    });
  }

  async getMyPlaylists() {
    const items = [];
    let offset = 0;
    const limit = 50;
    const maxPages = 50;

    for (let page = 0; page < maxPages; page++) {
      let response;
      try {
        response = await this.get({
          path: '/me/playlists',
          query: { limit, offset },
        });
      } catch (err) {
        if (err.statusCode === 429 && err.headers?.['retry-after']) {
          const retryAfterMs = parseInt(err.headers['retry-after'], 10) * 1000;
          await new Promise(r => setTimeout(r, retryAfterMs));
          response = await this.get({
            path: '/me/playlists',
            query: { limit, offset },
          });
        } else {
          throw err;
        }
      }

      if (Array.isArray(response.items)) {
        items.push(...response.items);
      }

      if (!response.next) break;
      offset += limit;
    }

    return { items };
  }

  async getAllPlaylistsCached() {
    const now = Date.now();
    const ttl = this.constructor.PLAYLIST_CACHE_TTL_MS;

    if (this._playlistCache && (now - this._playlistCacheAt) < ttl) {
      return this._playlistCache;
    }

    if (this._playlistCachePromise) {
      return this._playlistCachePromise;
    }

    this._playlistCachePromise = (async () => {
      try {
        const result = await this.getMyPlaylists();
        this._playlistCache = result;
        this._playlistCacheAt = Date.now();
        return result;
      } finally {
        this._playlistCachePromise = null;
      }
    })();

    return this._playlistCachePromise;
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

  async getPlaybackInfo() {
    const state = await this.state();

    if (!state || !state.item) {
      return {
        trackName: '',
        artistName: '',
        albumName: '',
        progressSeconds: 0,
        durationSeconds: 0,
        progressPercent: 0,
        isPlaying: false,
      };
    }

    const progressMs = state.progress_ms || 0;
    const durationMs = state.item.duration_ms || 0;

    return {
      trackName: state.item.name || '',
      artistName: state.item.artists?.map(a => a.name).join(', ') || '',
      albumName: state.item.album?.name || '',
      progressSeconds: Math.round(progressMs / 1000),
      durationSeconds: Math.round(durationMs / 1000),
      progressPercent: durationMs > 0 ? Math.round((progressMs / durationMs) * 100) : 0,
      isPlaying: state.is_playing || false,
    };
  }

}