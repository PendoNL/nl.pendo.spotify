'use strict';

const { OAuth2App } = require('homey-oauth2app');

const SpotifyConnectOAuth2Client = require('./lib/SpotifyConnectOAuth2Client');
const SpotifyZeroConfService = require('./lib/SpotifyZeroConfService');

module.exports = class SpotifyApp extends OAuth2App {

	static OAUTH2_CLIENT = SpotifyConnectOAuth2Client;
	static OAUTH2_DEBUG = true;

	async onInit() {
		await super.onInit();

		// Initialize ZeroConf service for device wake functionality
		this.zeroConfService = new SpotifyZeroConfService(this.homey);

		// Start device discovery in background
		this._startBackgroundDiscovery();

		// Listen for credential capture events
		this.homey.on('spotify_credentials_captured', ({ userName }) => {
			this.log(`Spotify credentials captured for user: ${userName}`);
		});

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

		// Run: play the selected song (with wake/retry logic)
		playSongCard.registerRunListener(async (args) => {
			const { device, song } = args;
			this.log(`play_song: Starting playback of ${song.name} on ${device.getName()}`);
			try {
				await device.playTrackWithRetry(song.uri);
				this.log(`play_song: Playback started successfully`);
			} catch (err) {
				this.error(`play_song: Error - ${err.message}`, err);
				throw err;
			}
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
			await device.playContextWithRetry(artist.uri);
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
			await device.playContextWithRetry(playlist.uri);
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
			await device.playContextWithRetry(album.uri);
		});

		// Wake Device card
		const wakeDeviceCard = this.homey.flow.getActionCard('wake_device');

		wakeDeviceCard.registerRunListener(async (args) => {
			const { hostname, port } = args;
			if (!hostname) {
				throw new Error('Hostname is required');
			}
			const result = await this.zeroConfService.wakeDeviceByHost(hostname, port || 4070);
			this.log(`Wake device result: ${JSON.stringify(result)}`);
			return result;
		});

		// Add to Queue card
		const addToQueueCard = this.homey.flow.getActionCard('add_to_queue');

		addToQueueCard.registerArgumentAutocompleteListener('song', async (query, args) => {
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

		addToQueueCard.registerRunListener(async (args) => {
			const { device, song } = args;
			await device.addToQueueWithRetry(song.uri);
		});

		// Get Playback Info card
		const getPlaybackInfoCard = this.homey.flow.getActionCard('get_playback_info');

		getPlaybackInfoCard.registerRunListener(async (args) => {
			const { device } = args;
			const state = await device.oAuth2Client.state();

			if (!state || !state.item) {
				return {
					track_name: '',
					artist_name: '',
					album_name: '',
					progress_seconds: 0,
					duration_seconds: 0,
					progress_percent: 0,
					is_playing: false
				};
			}

			const progressMs = state.progress_ms || 0;
			const durationMs = state.item.duration_ms || 0;
			const progressSeconds = Math.round(progressMs / 1000);
			const durationSeconds = Math.round(durationMs / 1000);
			const progressPercent = durationMs > 0 ? Math.round((progressMs / durationMs) * 100) : 0;

			return {
				track_name: state.item.name || '',
				artist_name: state.item.artists?.map(a => a.name).join(', ') || '',
				album_name: state.item.album?.name || '',
				progress_seconds: progressSeconds,
				duration_seconds: durationSeconds,
				progress_percent: progressPercent,
				is_playing: state.is_playing || false
			};
		});

		// Transfer Playback card
		const transferPlaybackCard = this.homey.flow.getActionCard('transfer_playback');

		transferPlaybackCard.registerArgumentAutocompleteListener('device', async (query) => {
			const oAuth2Client = this.getFirstSavedOAuth2Client();
			if (!oAuth2Client) {
				return [];
			}

			const result = await oAuth2Client.getDevices();
			const devices = result.devices || [];
			const queryLower = (query || '').toLowerCase();

			return devices
				.filter(device => !query || device.name.toLowerCase().includes(queryLower))
				.map(device => ({
					name: device.name,
					description: `${device.type}${device.is_active ? ' (Active)' : ''}`,
					id: device.id
				}));
		});

		transferPlaybackCard.registerRunListener(async (args) => {
			const { device } = args;
			const oAuth2Client = this.getFirstSavedOAuth2Client();
			if (!oAuth2Client) {
				throw new Error('No Spotify account connected');
			}
			await oAuth2Client.transferPlayback(device.id);
			this.log(`Transferred playback to ${device.name}`);
		});

		// Get Devices card
		const getDevicesCard = this.homey.flow.getActionCard('get_devices');

		getDevicesCard.registerRunListener(async () => {
			const oAuth2Client = this.getFirstSavedOAuth2Client();
			if (!oAuth2Client) {
				throw new Error('No Spotify account connected');
			}

			const result = await oAuth2Client.getDevices();
			const devices = result.devices || [];

			const deviceNames = devices.map(d => d.name).join(', ');
			const deviceIds = devices.map(d => d.id).join(', ');
			const activeDevice = devices.find(d => d.is_active);

			return {
				device_names: deviceNames || '',
				device_count: devices.length,
				active_device: activeDevice?.name || '',
				device_ids: deviceIds || ''
			};
		});
	}

	/**
	 * Start background discovery of Spotify Connect devices
	 */
	_startBackgroundDiscovery() {
		try {
			this.zeroConfService.startDiscovery();
			this.log('Background Spotify device discovery started');
		} catch (error) {
			this.error('Failed to start device discovery:', error);
		}
	}

	/**
	 * Start ZeroConf pairing mode
	 * Called from settings page
	 */
	async startPairingMode(deviceName = 'Homey Spotify') {
		return this.zeroConfService.startPairingMode(deviceName);
	}

	/**
	 * Stop ZeroConf pairing mode
	 */
	async stopPairingMode() {
		return this.zeroConfService.stopPairingMode();
	}

	/**
	 * Check if we have stored ZeroConf credentials
	 */
	hasZeroConfCredentials() {
		return this.zeroConfService.hasCredentials();
	}

	/**
	 * Get discovered Spotify Connect devices
	 */
	getDiscoveredDevices() {
		return this.zeroConfService.getDiscoveredDevices();
	}

	/**
	 * Wake a specific device by name
	 */
	async wakeDevice(deviceName) {
		return this.zeroConfService.wakeDevice(deviceName);
	}

	/**
	 * Wake a device by hostname/IP (for testing)
	 */
	async wakeDeviceByHost(host, port = 4070) {
		return this.zeroConfService.wakeDeviceByHost(host, port);
	}

	/**
	 * Reset ZeroConf identity (deviceId and credentials)
	 */
	async resetZeroConfIdentity() {
		// Clear stored credentials
		this.homey.settings.unset('spotify_zeroconf_credentials');
		// Clear device ID so a new one is generated
		this.homey.settings.unset('zeroconf_device_id');
		// Reinitialize the service to get a new deviceId
		if (this.zeroConfService) {
			this.zeroConfService.destroy();
		}
		this.zeroConfService = new SpotifyZeroConfService(this.homey);
		this.log('ZeroConf identity reset');
		return { success: true };
	}

	/**
	 * Cleanup on app unload
	 */
	async onUninit() {
		if (this.zeroConfService) {
			this.zeroConfService.destroy();
		}
	}

}