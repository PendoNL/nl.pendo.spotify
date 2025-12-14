'use strict';

const { OAuth2App } = require('homey-oauth2app');

const SpotifyConnectOAuth2Client = require('./lib/SpotifyConnectOAuth2Client');

module.exports = class SpotifyApp extends OAuth2App {

	static OAUTH2_CLIENT = SpotifyConnectOAuth2Client;
	static OAUTH2_DEBUG = true;

	async onInit() {
		await super.onInit();

		const playSongCard = this.homey.flow.getActionCard('play_song');

		// Autocomplete: search Spotify when user types
		playSongCard.registerArgumentAutocompleteListener('song', async (query, args) => {
			if (!query || query.length < 2) return [];

			const oAuth2Client = args.device.oAuth2Client;
			const results = await oAuth2Client.search(query, 'track', 10);

			return results.tracks.items.map(track => ({
				name: track.name,
				description: track.artists.map(a => a.name).join(', '),
				image: track.album.images[2]?.url,
				id: track.id,
				uri: track.uri
			}));
		});

		// Run: play the selected song (queue + skip to avoid single-track loop)
		playSongCard.registerRunListener(async (args) => {
			const { device, song } = args;
			await device.oAuth2Client.addToQueueAndSkip(device._id, song.uri);
		});

		// Play Artist card
		const playArtistCard = this.homey.flow.getActionCard('play_artist');

		playArtistCard.registerArgumentAutocompleteListener('artist', async (query, args) => {
			if (!query || query.length < 2) return [];

			const oAuth2Client = args.device.oAuth2Client;
			const results = await oAuth2Client.search(query, 'artist', 10);

			return results.artists.items.map(artist => ({
				name: artist.name,
				description: `${artist.followers?.total?.toLocaleString() || 0} followers`,
				image: artist.images[2]?.url,
				id: artist.id,
				uri: artist.uri
			}));
		});

		playArtistCard.registerRunListener(async (args) => {
			const { device, artist } = args;
			await device.oAuth2Client.playContext(device._id, artist.uri);
		});

		// Play Playlist card
		const playPlaylistCard = this.homey.flow.getActionCard('play_playlist');

		playPlaylistCard.registerArgumentAutocompleteListener('playlist', async (query, args) => {
			const oAuth2Client = args.device.oAuth2Client;
			const results = await oAuth2Client.getMyPlaylists(50);

			const queryLower = (query || '').toLowerCase();

			return results.items
				.filter(playlist => playlist !== null)
				.filter(playlist => !query || playlist.name.toLowerCase().includes(queryLower))
				.map(playlist => ({
					name: playlist.name,
					description: `${playlist.tracks?.total || 0} tracks`,
					image: playlist.images?.[0]?.url,
					id: playlist.id,
					uri: playlist.uri
				}));
		});

		playPlaylistCard.registerRunListener(async (args) => {
			const { device, playlist } = args;
			await device.oAuth2Client.playContext(device._id, playlist.uri);
		});

		// Play Album card
		const playAlbumCard = this.homey.flow.getActionCard('play_album');

		playAlbumCard.registerArgumentAutocompleteListener('album', async (query, args) => {
			if (!query || query.length < 2) return [];

			const oAuth2Client = args.device.oAuth2Client;
			const results = await oAuth2Client.search(query, 'album', 10);

			return results.albums.items.map(album => ({
				name: album.name,
				description: album.artists.map(a => a.name).join(', '),
				image: album.images[2]?.url,
				id: album.id,
				uri: album.uri
			}));
		});

		playAlbumCard.registerRunListener(async (args) => {
			const { device, album } = args;
			await device.oAuth2Client.playContext(device._id, album.uri);
		});
	}

}