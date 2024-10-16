'use strict';

const Homey = require('homey');
const { OAuth2Device, OAuth2Token} = require('homey-oauth2app');

const SYNC_INTERVAL = 1000 * 15;

module.exports = class SpotifyDevice extends OAuth2Device {

	async createImage() {
		this.image = await this.homey.images.createImage();
		this.image.setUrl(null);

		this.setAlbumArtImage(this.image);
	}

	onOAuth2Init() {
		this.log('device init');

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
				this.setUnavailable();
			}
		}).catch(err => {
			this.error(err);
			this.setUnavailable(err).catch(this.error);
		});

	}

}