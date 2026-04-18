'use strict';

const DRIVERS = ['spotify-connect', 'spotify-sonos'];

function findDeviceByWidgetId(homey, deviceId) {
	for (const driverId of DRIVERS) {
		const driver = homey.app.homey.drivers.getDriver(driverId);
		const device = driver.getDevices().find(d => d.__id === deviceId);
		if (device) return device;
	}
	return null;
}

module.exports = {
	async search({ homey, body }) {
		try {
			const { query: rawQuery, deviceId, offset: rawOffset, type: rawType } = body;
			const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
			const offset = parseInt(rawOffset, 10) || 0;
			const type = typeof rawType === 'string' && rawType ? rawType : 'track,artist,album,playlist';

			homey.app.log(`Widget search: query="${query}", type="${type}", deviceId="${deviceId}", offset=${offset}`);

			if (!query || query.length < 2) return [];
			if (!deviceId) throw new Error('No device configured');

			const device = findDeviceByWidgetId(homey, deviceId);
			if (!device) throw new Error(`Device not found: ${deviceId}`);

			let results;
			try {
				results = await device.oAuth2Client.search(query, type, 10, offset);
			} catch (err) {
				if (err.status === 400) {
					homey.app.log(`Widget search: Spotify rejected query="${query}" with 400`);
					return { items: [], hasMore: false };
				}
				if (err.status === 403) {
					homey.app.error('Widget search: Spotify returned 403. User may not be allowlisted in the Spotify Developer Dashboard.');
					throw new Error('Spotify access denied. The app owner may need to allowlist your Spotify account.');
				}
				throw err;
			}

			const items = [];
			let hasMore = false;

			if (results.tracks?.items) {
				results.tracks.items.forEach(track => {
					items.push({
						type: 'track',
						name: track.name,
						subtitle: track.artists.map(a => a.name).join(', '),
						image: track.album.images[2]?.url || track.album.images[0]?.url,
						uri: track.uri,
					});
				});
				if (results.tracks.next) hasMore = true;
			}

			if (results.artists?.items) {
				results.artists.items.forEach(artist => {
					items.push({
						type: 'artist',
						name: artist.name,
						subtitle: `${artist.followers?.total?.toLocaleString() || 0} followers`,
						image: artist.images[2]?.url || artist.images[0]?.url,
						uri: artist.uri,
					});
				});
				if (results.artists.next) hasMore = true;
			}

			if (results.albums?.items) {
				results.albums.items.forEach(album => {
					items.push({
						type: 'album',
						name: album.name,
						subtitle: album.artists.map(a => a.name).join(', '),
						image: album.images[2]?.url || album.images[0]?.url,
						uri: album.uri,
					});
				});
				if (results.albums.next) hasMore = true;
			}

			if (results.playlists?.items) {
				results.playlists.items.filter(p => p !== null).forEach(playlist => {
					items.push({
						type: 'playlist',
						name: playlist.name,
						subtitle: `${playlist.tracks?.total || 0} tracks`,
						image: playlist.images?.[0]?.url,
						uri: playlist.uri,
					});
				});
				if (results.playlists.next) hasMore = true;
			}

			return { items, hasMore };
		} catch (error) {
			homey.app.error(`Widget search error: ${error.message}`, error);
			throw error;
		}
	},

	async play({ homey, body }) {
		try {
			const { deviceId, uri, type } = body;
			if (!deviceId) throw new Error('No device configured');

			const device = findDeviceByWidgetId(homey, deviceId);
			if (!device) throw new Error('Device not found');

			if (type === 'track') {
				await device.playTrack(uri);
			} else {
				await device.playContext(uri);
			}

			return { success: true };
		} catch (error) {
			homey.app.error(`Widget play error: ${error.message}`, error);
			throw error;
		}
	},
};
