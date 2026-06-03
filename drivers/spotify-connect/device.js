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
		this._id = this.getStoreValue('id') || this.getData().id;
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

	async _lookupDevice() {
		const { devices } = await this.oAuth2Client.getDevices();
		let device = devices.find(d => d.id === this._id);

		if (!device) {
			const storedName = this.getStoreValue('spotifyName');
			const storedType = this.getStoreValue('spotifyType');

			if (storedName && storedType) {
				const matches = devices.filter(
					d => d.name === storedName && d.type === storedType
				);

				if (matches.length === 1) {
					device = matches[0];
					this.log(
						`Self-healed device ID: ${this._id} → ${device.id} (${storedName})`
					);
					this._id = device.id;
					await this.setStoreValue('id', device.id);
				}
			}
		}

		if (!device) return { status: 'missing' };
		return { status: device.is_active ? 'active' : 'idle', device };
	}

	async device(deviceId) {
		const devices = await this.oAuth2Client.getDevices();

		return devices.devices.find((device) => device.id === deviceId)
	}

	async state() {
		return this.oAuth2Client.state();
	}

	/*
		Capabilities
	*/
	_onCapabilitySpeakerNext() {
		return this.next(this._id);
	}

	_onCapabilitySpeakerPrevious() {
		return this.previous(this._id);
	}

	_onCapabilitySpeakerShuffle() {
		this.deviceShuffling = !this.deviceShuffling;

		return this.shuffle(this._id, this.deviceShuffling);
	}

	_onCapabilitySpeakerRepeat() {
		switch(this.deviceRepeatMode) {
			case 'track':this.deviceRepeatMode = 'playlist';break;
			case 'playlist':this.deviceRepeatMode = 'none';break;
			case 'none':this.deviceRepeatMode = 'track';break;
		}

		this.setCapabilityValue('speaker_repeat', this.deviceRepeatMode)

		return this.repeat(this._id, this.deviceRepeatMode);
	}

	_onCapabilitySpeakerVolumeSet(volume) {
		return this.volume(this._id, volume);
	}

	_onCapabilitySpeakerVolumeUp() {
		this.deviceVolume += 0.01;

		return this.volume(this._id, this.deviceVolume);
	}

	_onCapabilitySpeakerVolumeDown() {
		this.deviceVolume -= 0.01;

		return this.volume(this._id, this.deviceVolume);
	}

	_onCapabilitySpeakerVolumeMute() {
		this.deviceMuted = !this.deviceMuted;

		return this.volume(this._id, this.deviceMuted ? 0 : this.deviceVolume);
	}

	_onCapabilitySpeakerPlaying() {
		this.devicePlaying = !this.devicePlaying;

		return this.playing(this._id, this.devicePlaying);
	}

	_sync() {
		Promise.resolve().then(async () => {
			const result = await this._lookupDevice();

			if (result.status === 'missing') {
				await this.setUnavailable();
				return;
			}

			if (!this.getStoreValue('spotifyName')) {
				await this.setStoreValue('spotifyName', result.device.name);
				await this.setStoreValue('spotifyType', result.device.type);
			}

			await this.setAvailable();

			const volume = result.device.volume_percent / 100;
			this.setCapabilityValue('volume_set', volume);
			this.setCapabilityValue('volume_mute', volume === 0);

			if (result.status === 'idle') {
				this.setCapabilityValue('speaker_playing', false);
				this.setCapabilityValue('speaker_track', '');
				this.setCapabilityValue('speaker_artist', '');
				this.setCapabilityValue('speaker_album', '');
				this.image.setUrl(null);
				await this.image.update();
				return;
			}

			const state = await this.state();

			if (!state) {
				return;
			}

			this.setCapabilityValue('speaker_playing', state.is_playing);
			this.setCapabilityValue('speaker_shuffle', state.shuffle_state);
			this.setCapabilityValue(
				'speaker_repeat',
				state.repeat_state === 'track' ? 'track'
					: state.repeat_state === 'context' ? 'playlist'
					: 'none'
			);

			if (state.item) {
				const artist = state.item.artists.map(a => a.name).join(' & ');
				this.setCapabilityValue('speaker_artist', artist);
				this.setCapabilityValue('speaker_album', state.item.album.name);
				this.setCapabilityValue('speaker_track', state.item.name);

				const cover = state.item.album.images.find(img => img.url)?.url;
				if (cover) {
					this.image.setUrl(cover);
					await this.image.update();
				}
			}
		}).catch(err => {
			this.error(err);
			this.setUnavailable(err).catch(this.error);
		});
	}

}