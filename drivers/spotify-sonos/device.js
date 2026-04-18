'use strict';

const { OAuth2Device } = require('homey-oauth2app');

const SonosClient = require('../../lib/SonosClient');

const SYNC_INTERVAL = 1000 * 15;

module.exports = class SpotifySonosDevice extends OAuth2Device {

	async onOAuth2Init() {
		const { uuid } = this.getData();
		const ip = this.getStoreValue('ip');

		this._uuid = uuid;
		this._ip = ip;
		this.sonos = SonosClient.fromIp(ip);

		this._shuffle = false;
		this._repeat = 'none';

		await this._createAlbumArtImage();
		this._registerCapabilityListeners();

		this.syncInterval = setInterval(() => this._sync(), SYNC_INTERVAL);
		this._sync();
	}

	async onOAuth2Deleted() {
		if (this.syncInterval) clearInterval(this.syncInterval);
		await super.onOAuth2Deleted();
	}

	async _createAlbumArtImage() {
		this.image = await this.homey.images.createImage();
		this.image.setUrl(null);
		await this.setAlbumArtImage(this.image);
	}

	_registerCapabilityListeners() {
		this.registerCapabilityListener('speaker_playing', (v) => (v ? this.sonos.play() : this.sonos.pause()));
		this.registerCapabilityListener('speaker_next', () => this.sonos.next());
		this.registerCapabilityListener('speaker_prev', () => this.sonos.previous());

		this.registerCapabilityListener('speaker_shuffle', (v) => {
			this._shuffle = Boolean(v);
			return this.sonos.setShuffleAndRepeat(this._shuffle, this._repeat);
		});
		this.registerCapabilityListener('speaker_repeat', (v) => {
			this._repeat = v || 'none';
			return this.sonos.setShuffleAndRepeat(this._shuffle, this._repeat);
		});

		this.registerCapabilityListener('volume_set', (v) => this.sonos.setVolumeFromHomey(v));
		this.registerCapabilityListener('volume_up', () => {
			const current = this.getCapabilityValue('volume_set') || 0;
			return this.sonos.setVolumeFromHomey(Math.min(1, current + 0.02));
		});
		this.registerCapabilityListener('volume_down', () => {
			const current = this.getCapabilityValue('volume_set') || 0;
			return this.sonos.setVolumeFromHomey(Math.max(-1, current - 0.02));
		});
		this.registerCapabilityListener('volume_mute', (v) => this.sonos.setMuted(Boolean(v)));
	}

	/*
		Common contract (matches spotify-connect device)
	*/
	async playTrack(uri) {
		return this.sonos.playTrack(uri);
	}

	async playContext(uri) {
		return this.sonos.playContext(uri);
	}

	async addToQueue(uri) {
		return this.sonos.addToQueue(uri);
	}

	async getPlaybackInfo() {
		const snap = await this.sonos.getSyncSnapshot();
		return {
			trackName: snap.trackName,
			artistName: snap.artistName,
			albumName: snap.albumName,
			progressSeconds: snap.progressSeconds,
			durationSeconds: snap.durationSeconds,
			progressPercent: snap.progressPercent,
			isPlaying: snap.isPlaying,
		};
	}

	/*
		Sync
	*/
	async _sync() {
		try {
			await this._applySnapshot(await this.sonos.getSyncSnapshot());
		} catch (firstErr) {
			this.log(`Sonos sync failed at ${this._ip}, attempting IP re-resolve by UUID`);
			const reResolved = await this._resolveIpByUuid();
			if (!reResolved) {
				this.error(`Sonos sync failed; IP re-resolve found no match: ${firstErr.message}`);
				this.setUnavailable(firstErr.message).catch(this.error);
				return;
			}
			try {
				await this._applySnapshot(await this.sonos.getSyncSnapshot());
			} catch (secondErr) {
				this.error(`Sonos sync failed after IP re-resolve: ${secondErr.message}`);
				this.setUnavailable(secondErr.message).catch(this.error);
			}
		}
	}

	async _applySnapshot(snap) {
		this.setAvailable();

		this._shuffle = snap.shuffle;
		this._repeat = snap.repeat;

		this.setCapabilityValue('speaker_playing', snap.isPlaying).catch(this.error);
		this.setCapabilityValue('speaker_track', snap.trackName).catch(this.error);
		this.setCapabilityValue('speaker_artist', snap.artistName).catch(this.error);
		this.setCapabilityValue('speaker_album', snap.albumName).catch(this.error);
		this.setCapabilityValue('speaker_shuffle', snap.shuffle).catch(this.error);
		this.setCapabilityValue('speaker_repeat', snap.repeat).catch(this.error);
		this.setCapabilityValue('volume_set', snap.volume).catch(this.error);
		this.setCapabilityValue('volume_mute', snap.muted).catch(this.error);

		if (snap.albumArtUrl && snap.albumArtUrl.startsWith('https://')) {
			this.image.setUrl(snap.albumArtUrl);
			this.image.update().catch(this.error);
		}
	}

	/**
	 * Re-discover Sonos speakers on the LAN; if one matches our stored UUID,
	 * update this._ip and this.sonos. Returns true if re-resolved.
	 */
	async _resolveIpByUuid() {
		if (!this._uuid || this._uuid.startsWith('manual:')) return false;
		try {
			const found = await SonosClient.discover(4000);
			const match = found.find(d => d.uuid === this._uuid);
			if (!match) return false;
			if (match.ip !== this._ip) {
				this._ip = match.ip;
				await this.setStoreValue('ip', match.ip);
				this.sonos = SonosClient.fromIp(match.ip);
			}
			return true;
		} catch (_) {
			return false;
		}
	}

};
