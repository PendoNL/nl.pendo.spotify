'use strict';

const Homey = require('homey');
const { OAuth2Device, OAuth2Token} = require('homey-oauth2app');

const SYNC_INTERVAL = 1000 * 15;

module.exports = class SpotifyConnectDevice extends OAuth2Device {

	async createImage() {
		this.image = await this.homey.images.createImage();
		this.image.setUrl(null);

		this.setAlbumArtImage(this.image);
	}

	onOAuth2Init() {
		const { id } = this.getData();

		this._id = id;
		this.syncInterval = setInterval(() => this._sync(), SYNC_INTERVAL);

		this.createImage();

		this._sync = this._sync.bind(this);

		this.registerCapabilityListener('speaker_playing', this._onCapabilitySpeakerPlaying.bind(this));
		this.registerCapabilityListener('speaker_next', this._onCapabilitySpeakerNext.bind(this));
		this.registerCapabilityListener('speaker_prev', this._onCapabilitySpeakerPrevious.bind(this));
		this.registerCapabilityListener('speaker_shuffle', this._onCapabilitySpeakerShuffle.bind(this));
		this.registerCapabilityListener('speaker_repeat', this._onCapabilitySpeakerRepeat.bind(this));
		this.registerCapabilityListener('volume_set', this._onCapabilitySpeakerVolumeSet.bind(this));
		this.registerCapabilityListener('volume_up', this._onCapabilitySpeakerVolumeUp.bind(this));
		this.registerCapabilityListener('volume_down', this._onCapabilitySpeakerVolumeDown.bind(this));
		this.registerCapabilityListener('volume_mute', this._onCapabilitySpeakerVolumeMute.bind(this));

		this._sync();
	}

	onOAuth2Migrate() {
		let access_token;

		const data = this.getData();
		const store = this.getStore();

		if (store.access_token) {
			access_token = store.access_token;
		} else if (data.access_token) {
			access_token = data.access_token;
		} else {
			throw new Error('Missing Access Token');
		}

		const token = new OAuth2Token({
			access_token,
			token_type: 'Bearer',
		});
		const sessionId = data.id;
		const configId = this.driver.getOAuth2ConfigId();

		return {
			sessionId,
			configId,
			token,
		}
	}

	async onOAuth2MigrateSuccess() {
		await this.unsetStoreValue('token');
	}

	async onOAuth2Added() {
		await this.driver.ready();

		// Try to auto-match ZeroConf device for wake settings
		await this._tryAutoMatchZeroConfDevice();
	}

	async _tryAutoMatchZeroConfDevice() {
		try {
			const zeroConfService = this.homey.app.zeroConfService;
			if (!zeroConfService) {
				this.log('ZeroConf service not available for auto-match');
				return;
			}

			const deviceName = this.getName();
			const discoveredDevices = zeroConfService.getDiscoveredDevices();

			this.log(`Attempting to auto-match "${deviceName}" against ${discoveredDevices.length} discovered devices`);

			// Try to find a matching device by name (case-insensitive, partial match)
			const deviceNameLower = deviceName.toLowerCase();
			const match = discoveredDevices.find(d => {
				const remoteName = (d.remoteName || d.name || '').toLowerCase();
				return remoteName.includes(deviceNameLower) || deviceNameLower.includes(remoteName);
			});

			if (match) {
				const host = match.address || match.host;
				const port = match.port || 4070;

				this.log(`Auto-matched ZeroConf device: ${match.remoteName || match.name} at ${host}:${port}`);

				await this.setSettings({
					wake_host: host,
					wake_port: port
				});

				this.log('Wake settings auto-configured successfully');
			} else {
				this.log('No matching ZeroConf device found for auto-configuration');
			}
		} catch (err) {
			this.log(`Auto-match ZeroConf failed: ${err.message}`);
		}
	}

	async onOAuth2Deleted() {
		await super.onOAuth2Deleted();

		if (this.syncInterval) {
			clearInterval(this.syncInterval);
		}
	}

	/*
		Spotify methods
	*/
	async next(deviceId) {
		await this.oAuth2Client.next(deviceId);

		this._sync();
	}

	async previous(deviceId) {
		await this.oAuth2Client.previous(deviceId);

		this._sync();
	}

	async repeat(deviceId, state) {
		await this.oAuth2Client.repeat(deviceId, state);
	}

	async shuffle(deviceId, state) {
		await this.oAuth2Client.shuffle(deviceId, state);
	}

	async playing(deviceId, state) {
		state
			? await this.oAuth2Client.play(deviceId, state)
			: await this.oAuth2Client.pause(deviceId, state);
	}

	async volume(deviceId, volume) {
		return this.oAuth2Client.volume(deviceId, volume);
	}

	async device(deviceId) {
		const devices = await this.oAuth2Client.getDevices();

		return devices.devices.find((device) => device.id === deviceId)
	}

	async state() {
		return this.oAuth2Client.state();
	}

	/*
		Wake & Retry Helpers
	*/
	_delay(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	_isDeviceUnavailableError(error) {
		if (!error) return false;

		const status = error.status || error.statusCode;
		if (status === 404) return true;

		const message = (error.message || '').toLowerCase();
		return message.includes('no active device') ||
			message.includes('device not found') ||
			message.includes('player command failed') ||
			message.includes('restriction violated');
	}

	async _tryWakeDevice() {
		const wakeHost = this.getSetting('wake_host');
		let wakePort = this.getSetting('wake_port') || 4070;

		if (!wakeHost) {
			this.log('No wake_host configured, skipping wake attempt');
			return false;
		}

		const zeroConfService = this.homey.app.zeroConfService;

		if (!zeroConfService || !zeroConfService.hasCredentials()) {
			this.log('No ZeroConf credentials available, cannot wake device');
			return false;
		}

		// Refresh mDNS discovery to get current port (librespot uses dynamic ports)
		let wakeCPath = null;
		try {
			this.log(`Refreshing mDNS discovery for ${wakeHost}...`);
			const discovered = await zeroConfService.refreshDeviceDiscovery(wakeHost, 2000);

			if (discovered) {
				if (discovered.port) {
					wakePort = discovered.port;
				}
				if (discovered.txt?.CPath) {
					wakeCPath = discovered.txt.CPath;
				}
				this.log(`Fresh mDNS data: ${discovered.name} at ${discovered.host}:${wakePort} (CPath: ${wakeCPath || 'not set'})`);
			} else {
				this.log(`No fresh mDNS data received, using configured port ${wakePort}`);
			}
		} catch (discoverErr) {
			this.log(`mDNS discovery refresh failed: ${discoverErr.message}, using configured port`);
		}

		try {
			this.log(`Attempting to wake device at ${wakeHost}:${wakePort}${wakeCPath ? ` with CPath ${wakeCPath}` : ''}...`);
			const result = await zeroConfService.wakeDeviceByHost(wakeHost, wakePort, wakeCPath);
			this.log(`Wake result: ${JSON.stringify(result)}`);
			return result && result.success;
		} catch (err) {
			this.log(`Wake failed: ${err.message}`);
			return false;
		}
	}

	async _executeWithWakeRetry(operation, operationName = 'operation') {
		const MAX_RETRIES = 2;
		this.log(`[${operationName}] Starting with wake retry (max ${MAX_RETRIES} attempts)`);

		// First, check if target device is active - if not, activate it first
		await this._ensureDeviceActive(operationName);

		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			try {
				this.log(`[${operationName}] Attempt ${attempt}...`);
				const result = await operation();
				this.log(`[${operationName}] Success on attempt ${attempt}`);
				return result;
			} catch (error) {
				this.log(`[${operationName}] Attempt ${attempt} failed: ${error.message}`);
				const isDeviceError = this._isDeviceUnavailableError(error);
				this.log(`[${operationName}] Is device unavailable error: ${isDeviceError}`);

				if (!isDeviceError || attempt === MAX_RETRIES) {
					this.log(`[${operationName}] Giving up - isDeviceError=${isDeviceError}, attempt=${attempt}`);
					throw error;
				}

				// Try to activate device again
				await this._ensureDeviceActive(operationName);
			}
		}
	}

	async _ensureDeviceActive(operationName = 'operation') {
		// Check if our target device is the active one
		const currentDevice = await this.device(this._id);

		if (currentDevice && currentDevice.is_active) {
			this.log(`[${operationName}] Device ${this._id} is already active`);
			return;
		}

		this.log(`[${operationName}] Device ${this._id} is not active, need to activate it`);

		// Step 1: Try transfer playback (device might be in the list but not active)
		try {
			this.log(`[${operationName}] Step 1: Attempting transfer playback to ${this._id}`);
			await this.oAuth2Client.transferPlayback(this._id);
			this.log(`[${operationName}] Transfer succeeded, waiting 2s...`);
			await this._delay(2000);
			return;
		} catch (transferError) {
			this.log(`[${operationName}] Transfer failed: ${transferError.message}`);
		}

		// Step 2: Try wake device (if configured)
		this.log(`[${operationName}] Step 2: Attempting wake device`);
		const woken = await this._tryWakeDevice();
		this.log(`[${operationName}] Wake result: ${woken}`);
		if (woken) {
			this.log(`[${operationName}] Waiting 2s after wake...`);
			await this._delay(2000);
			// Transfer playback after wake
			try {
				this.log(`[${operationName}] Attempting transfer after wake...`);
				await this.oAuth2Client.transferPlayback(this._id);
				this.log(`[${operationName}] Transfer after wake succeeded, waiting 2s...`);
				await this._delay(2000);
			} catch (transferAfterWakeError) {
				this.log(`[${operationName}] Transfer after wake failed: ${transferAfterWakeError.message}`);
			}
		}
	}

	/*
		High-level playback methods with retry
	*/
	async playTrackWithRetry(uri) {
		this.log(`playTrackWithRetry called with uri: ${uri}`);
		return this._executeWithWakeRetry(
			() => this.oAuth2Client.addToQueueAndSkip(this._id, uri),
			'playTrack'
		);
	}

	async playContextWithRetry(uri) {
		return this._executeWithWakeRetry(
			() => this.oAuth2Client.playContext(this._id, uri),
			'playContext'
		);
	}

	async addToQueueWithRetry(uri) {
		return this._executeWithWakeRetry(
			async () => {
				try {
					await this.oAuth2Client.addToQueue(this._id, uri);
				} catch (error) {
					// Queue API requires active playback - fall back to direct play
					if (error.status === 404 || error.statusCode === 404) {
						await this.oAuth2Client.playTrack(this._id, uri);
					} else {
						throw error;
					}
				}
			},
			'addToQueue'
		);
	}

	/*
		Capabilities (with wake retry)
	*/
	_onCapabilitySpeakerNext() {
		return this._executeWithWakeRetry(
			() => this.next(this._id),
			'speaker_next'
		);
	}

	_onCapabilitySpeakerPrevious() {
		return this._executeWithWakeRetry(
			() => this.previous(this._id),
			'speaker_prev'
		);
	}

	_onCapabilitySpeakerShuffle() {
		this.deviceShuffling = !this.deviceShuffling;

		return this._executeWithWakeRetry(
			() => this.shuffle(this._id, this.deviceShuffling),
			'speaker_shuffle'
		);
	}

	_onCapabilitySpeakerRepeat() {
		switch(this.deviceRepeatMode) {
			case 'track':this.deviceRepeatMode = 'playlist';break;
			case 'playlist':this.deviceRepeatMode = 'none';break;
			case 'none':this.deviceRepeatMode = 'track';break;
		}

		this.setCapabilityValue('speaker_repeat', this.deviceRepeatMode)

		return this._executeWithWakeRetry(
			() => this.repeat(this._id, this.deviceRepeatMode),
			'speaker_repeat'
		);
	}

	_onCapabilitySpeakerVolumeSet(volume) {
		return this._executeWithWakeRetry(
			() => this.volume(this._id, volume),
			'volume_set'
		);
	}

	_onCapabilitySpeakerVolumeUp() {
		this.deviceVolume += 0.01;

		return this._executeWithWakeRetry(
			() => this.volume(this._id, this.deviceVolume),
			'volume_up'
		);
	}

	_onCapabilitySpeakerVolumeDown() {
		this.deviceVolume -= 0.01;

		return this._executeWithWakeRetry(
			() => this.volume(this._id, this.deviceVolume),
			'volume_down'
		);
	}

	_onCapabilitySpeakerVolumeMute() {
		this.deviceMuted = !this.deviceMuted;

		return this._executeWithWakeRetry(
			() => this.volume(this._id, this.deviceMuted ? 0 : this.deviceVolume),
			'volume_mute'
		);
	}

	_onCapabilitySpeakerPlaying() {
		this.devicePlaying = !this.devicePlaying;

		return this._executeWithWakeRetry(
			() => this.playing(this._id, this.devicePlaying),
			'speaker_playing'
		);
	}

	_sync() {

		Promise.resolve().then(async () => {
			const device = await this.device(this._id);

			if(device && device.is_active) {
				this.setAvailable();

				this.deviceVolume = device.volume_percent / 100;
				this.deviceMuted = this.deviceVolume === 0;

				this.setCapabilityValue('volume_mute', this.deviceMuted)

				const state = await this.state();

				this.devicePlaying = state.is_playing;
				this.deviceShuffling = state.shuffle_state;
				this.deviceRepeatMode = state.repeat_state === "track" ? "track" : (state.repeat_state === "context" ? "playlist" : "none");

				const artist = state.item.artists.map((artist) => artist.name).join(' & ');

				this.setCapabilityValue('speaker_playing', this.devicePlaying)
				this.setCapabilityValue('speaker_shuffle', this.deviceShuffling)
				this.setCapabilityValue('speaker_repeat', this.deviceRepeatMode)
				this.setCapabilityValue('speaker_artist', artist)
				this.setCapabilityValue('speaker_album', state.item.album.name)
				this.setCapabilityValue('speaker_track', state.item.name)

				const albumCover = state.item.album.images.find((image) => image.url)?.url;

				if(albumCover) {
					this.image.setUrl(albumCover);
					this.image.update();
				}

			} else {
				// Keep device available so flow cards can trigger wake/retry logic
				this.setAvailable();
				// Reset playback state when not active
				this.devicePlaying = false;
				this.setCapabilityValue('speaker_playing', false).catch(() => {});
			}
		}).catch(err => {
			this.error(err);
			this.setUnavailable(err).catch(this.error);
		});

	}

}