'use strict';

const { Sonos, DeviceDiscovery } = require('sonos');

const { parseSpotifyUri, buildDidlMetadata, combinePlayMode } = require('./helpers/spotifyUri');
const { homeyVolumeToSonos, sonosVolumeToHomey } = require('./helpers/volumeScale');

/**
 * Translate UPnP faults and library errors into messages Homey users can act
 * on. The sonos lib surfaces UPnP errors with the fault code in the message
 * string; we match on those known codes.
 */
function withTimeout(promise, ms, message) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function translateSonosError(error) {
	const message = error?.message || String(error);
	if (/errorCode>800</.test(message) || /Spotify.*not.*authori[sz]ed/i.test(message)) {
		return new Error('Spotify is not linked on this Sonos speaker. Open the Sonos app → Settings → Services & Voice → Music and sign in with a Spotify Premium account.');
	}
	if (/errorCode>801</.test(message) || /premium/i.test(message)) {
		return new Error('Spotify Premium is required to play on Sonos.');
	}
	if (/errorCode>714</.test(message)) {
		return new Error('Sonos rejected the track format. The Spotify URI may be malformed or the speaker needs Spotify relinked.');
	}
	if (/ECONN|EHOST|ETIMEDOUT/.test(message)) {
		return new Error(`Sonos speaker is unreachable: ${message}`);
	}
	return error;
}

class SonosClient {

	/**
	 * Discover Sonos speakers on the LAN via SSDP.
	 * Resolves with [{ name, ip, uuid }]. Guarantees resolution within
	 * timeoutMs + 1000 even if the sonos lib's socket fails or the
	 * `timeout` event is never emitted.
	 */
	static async discover(timeoutMs = 4000) {
		return new Promise((resolve) => {
			const found = new Map();
			let settled = false;
			const done = () => {
				if (settled) return;
				settled = true;
				try { discovery.destroy && discovery.destroy(); } catch (_) { /* noop */ }
				resolve(Array.from(found.values()));
			};

			const discovery = DeviceDiscovery({ timeout: timeoutMs });

			discovery.on('DeviceAvailable', async (device) => {
				try {
					const description = await device.deviceDescription();
					const uuid = description.UDN.replace(/^uuid:/, '');
					if (!found.has(uuid)) {
						found.set(uuid, {
							name: description.roomName || description.friendlyName,
							ip: device.host,
							uuid,
						});
					}
				} catch (_) {
					// ignore individual device failures
				}
			});

			discovery.on('timeout', done);
			discovery.on('error', done);

			// Belt-and-suspenders: if neither `timeout` nor `error` fires
			// (e.g. socket creation failed asynchronously), resolve anyway.
			setTimeout(done, timeoutMs + 1000);
		});
	}

	/**
	 * Create a client pointed at a specific IP (for manual-IP pairing and
	 * for reconnection after discovery).
	 */
	static fromIp(ip) {
		return new SonosClient(ip);
	}

	constructor(ip) {
		this.ip = ip;
		this.sonos = new Sonos(ip);
	}

	async getName() {
		return withTimeout(this.sonos.getName(), 5000, `Timed out reaching ${this.ip}`);
	}

	async playTrack(uri) {
		parseSpotifyUri(uri); // throws on invalid
		try {
			await this.sonos.flush();
			await this.sonos.queue(uri);
			return await this.sonos.play();
		} catch (error) {
			throw translateSonosError(error);
		}
	}

	async playContext(uri) {
		parseSpotifyUri(uri);
		try {
			await this.sonos.flush();
			await this.sonos.queue(uri);
			return await this.sonos.play();
		} catch (error) {
			throw translateSonosError(error);
		}
	}

	/**
	 * Append a track to the current queue; if the current transport isn't
	 * the queue (e.g. a direct URI is playing), fall back to play-now.
	 */
	async addToQueue(uri) {
		parseSpotifyUri(uri);
		try {
			return await this.sonos.queue(uri);
		} catch (error) {
			return this.playTrack(uri);
		}
	}

	async play() {
		return this.sonos.play();
	}

	async pause() {
		return this.sonos.pause();
	}

	async next() {
		return this.sonos.next();
	}

	async previous() {
		return this.sonos.previous();
	}

	async setVolumeFromHomey(volume) {
		return this.sonos.setVolume(homeyVolumeToSonos(volume));
	}

	async setMuted(muted) {
		return this.sonos.setMuted(Boolean(muted));
	}

	async setShuffleAndRepeat(shuffle, repeat) {
		return this.sonos.setPlayMode(combinePlayMode(shuffle, repeat));
	}

	/**
	 * Fetch everything needed for a sync tick in parallel. Returns a shape
	 * matching `SpotifyConnectOAuth2Client.getPlaybackInfo` with extras for
	 * volume/muted/shuffle/repeat and album art URL.
	 */
	async getSyncSnapshot() {
		const [track, volumePercent, muted, transportState, playMode] = await Promise.all([
			this.sonos.currentTrack(),
			this.sonos.getVolume(),
			this.sonos.getMuted(),
			this.sonos.getCurrentState(),
			this.sonos.avTransportService().GetTransportSettings().catch(() => ({})),
		]);

		const isPlaying = transportState === 'playing';
		const durationMs = (track?.duration ?? 0) * 1000;
		const progressMs = (track?.position ?? 0) * 1000;

		const mode = (playMode?.PlayMode || 'NORMAL').toUpperCase();
		const shuffle = mode.startsWith('SHUFFLE');
		let repeat = 'none';
		if (mode === 'REPEAT_ONE' || mode === 'SHUFFLE_REPEAT_ONE') repeat = 'track';
		else if (mode === 'REPEAT_ALL' || mode === 'SHUFFLE') repeat = 'playlist';

		return {
			trackName: track?.title || '',
			artistName: track?.artist || '',
			albumName: track?.album || '',
			albumArtUrl: track?.albumArtURL || null,
			progressSeconds: Math.round(progressMs / 1000),
			durationSeconds: Math.round(durationMs / 1000),
			progressPercent: durationMs > 0 ? Math.round((progressMs / durationMs) * 100) : 0,
			isPlaying,
			volume: sonosVolumeToHomey(volumePercent),
			muted: Boolean(muted),
			shuffle,
			repeat,
		};
	}

}

module.exports = SonosClient;
