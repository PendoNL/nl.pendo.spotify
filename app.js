'use strict';

const { OAuth2App } = require('homey-oauth2app');

const SpotifyConnectOAuth2Client = require('./lib/SpotifyConnectOAuth2Client');

module.exports = class SpotifyApp extends OAuth2App {

	static OAUTH2_CLIENT = SpotifyConnectOAuth2Client;
	static OAUTH2_DEBUG = true;

	async onInit() {
		await super.onInit();

		this._registerPlaySong();
		this._registerPlayArtist();
		this._registerPlayPlaylist();
		this._registerPlayAlbum();
		this._registerAddToQueue();
		this._registerGetPlaybackInfo();
	}

	_registerPlaySong() {
		const card = this.homey.flow.getActionCard('play_song');

		card.registerArgumentAutocompleteListener('song', async (query, args) => {
			if (!query || query.length < 2) return [];
			const results = await args.device.oAuth2Client.search(query, 'track', 10);
			return results.tracks.items.map(track => ({
				name: track.name,
				description: track.artists.map(a => a.name).join(', '),
				image: track.album.images[2]?.url,
				id: track.id,
				uri: track.uri,
			}));
		});

		card.registerRunListener(async ({ device, song }) => device.playTrack(song.uri));
	}

	_registerPlayArtist() {
		const card = this.homey.flow.getActionCard('play_artist');

		card.registerArgumentAutocompleteListener('artist', async (query, args) => {
			if (!query || query.length < 2) return [];
			const results = await args.device.oAuth2Client.search(query, 'artist', 10);
			return results.artists.items.map(artist => ({
				name: artist.name,
				description: `${artist.followers?.total?.toLocaleString() || 0} followers`,
				image: artist.images[2]?.url,
				id: artist.id,
				uri: artist.uri,
			}));
		});

		card.registerRunListener(async ({ device, artist }) => device.playContext(artist.uri));
	}

	_registerPlayPlaylist() {
		const card = this.homey.flow.getActionCard('play_playlist');

		card.registerArgumentAutocompleteListener('playlist', async (query, args) => {
			const results = await args.device.oAuth2Client.getAllPlaylistsCached();
			const q = (query || '').toLowerCase();
			return results.items
				.filter(p => p !== null)
				.filter(p => !query || p.name.toLowerCase().includes(q))
				.map(p => ({
					name: p.name,
					description: `${p.tracks?.total || 0} tracks`,
					image: p.images?.[0]?.url,
					id: p.id,
					uri: p.uri,
				}));
		});

		card.registerRunListener(async ({ device, playlist }) => device.playContext(playlist.uri));
	}

	_registerPlayAlbum() {
		const card = this.homey.flow.getActionCard('play_album');

		card.registerArgumentAutocompleteListener('album', async (query, args) => {
			if (!query || query.length < 2) return [];
			const results = await args.device.oAuth2Client.search(query, 'album', 10);
			return results.albums.items.map(album => ({
				name: album.name,
				description: album.artists.map(a => a.name).join(', '),
				image: album.images[2]?.url,
				id: album.id,
				uri: album.uri,
			}));
		});

		card.registerRunListener(async ({ device, album }) => device.playContext(album.uri));
	}

	_registerAddToQueue() {
		const card = this.homey.flow.getActionCard('add_to_queue');

		card.registerArgumentAutocompleteListener('song', async (query, args) => {
			if (!query || query.length < 2) return [];
			const results = await args.device.oAuth2Client.search(query, 'track', 10);
			return results.tracks.items.map(track => ({
				name: track.name,
				description: track.artists.map(a => a.name).join(', '),
				image: track.album.images[2]?.url,
				id: track.id,
				uri: track.uri,
			}));
		});

		card.registerRunListener(async ({ device, song }) => device.addToQueue(song.uri));
	}

	_registerGetPlaybackInfo() {
		const card = this.homey.flow.getActionCard('get_playback_info');

		card.registerRunListener(async ({ device }) => {
			const info = await device.getPlaybackInfo();
			return {
				track_name: info.trackName,
				artist_name: info.artistName,
				album_name: info.albumName,
				progress_seconds: info.progressSeconds,
				duration_seconds: info.durationSeconds,
				progress_percent: info.progressPercent,
				is_playing: info.isPlaying,
			};
		});
	}

};
