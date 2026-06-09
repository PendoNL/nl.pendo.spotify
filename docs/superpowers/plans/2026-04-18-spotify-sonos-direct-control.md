# Spotify → Sonos Direct Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `spotify-sonos` driver that plays Spotify content on Sonos speakers via UPnP, alongside the existing `spotify-connect` driver, with a shared OAuth2 session and a common method contract so flow cards and the widget work for both.

**Architecture:** Two drivers in one Homey app. Both device classes expose the same methods (`playTrack`, `playContext`, `addToQueue`, `getPlaybackInfo`). Flow-card listeners become one-liners. The Sonos driver uses the `sonos` npm package for UPnP; pairing uses SSDP discovery with manual-IP fallback; state syncs every 15s via polling.

**Tech Stack:** Homey SDK 3, `homey-oauth2app`, `sonos` npm package (SSDP + UPnP), Node.js built-in `node:test` for unit tests.

**Repo conventions:** Existing files use tabs for indentation and single quotes; match that style. Match existing `use strict;` preamble and `module.exports = class X extends Y {}` pattern.

---

## File Structure

**New files:**
- `lib/SonosClient.js` — wrapper around the `sonos` npm package. Static `discover(timeoutMs)` and `fromIp(ip)`; instance methods for playback, volume, state, shuffle/repeat.
- `lib/helpers/spotifyUri.js` — pure helpers: `parseSpotifyUri`, `buildDidlMetadata`, `combinePlayMode`.
- `lib/helpers/volumeScale.js` — pure helpers: `homeyVolumeToSonos`, `sonosVolumeToHomey`.
- `drivers/spotify-sonos/driver.compose.json` — capability set + pair flow.
- `drivers/spotify-sonos/driver.js` — `OAuth2Driver` subclass.
- `drivers/spotify-sonos/device.js` — `OAuth2Device` subclass.
- `drivers/spotify-sonos/pair/discover_sonos.html` — custom pair view.
- `drivers/spotify-sonos/assets/images/large.jpg`, `small.jpg` — placeholder icons (copy from `spotify-connect` for v1).
- `test/spotifyUri.test.js` — unit tests for `spotifyUri.js`.
- `test/volumeScale.test.js` — unit tests for `volumeScale.js`.

**Modified files:**
- `package.json` — add `sonos` dependency, add `test` script.
- `lib/SpotifyConnectOAuth2Client.js` — add `getPlaybackInfo()`.
- `drivers/spotify-connect/device.js` — add contract methods: `playTrack`, `playContext`, `addToQueue`, `getPlaybackInfo`.
- `app.js` — refactor flow-card run listeners to call the contract methods on the device.
- `.homeycompose/app.json` — bump version to `1.5.0`.
- `.homeycompose/flow/actions/play_song.json`, `play_album.json`, `play_artist.json`, `play_playlist.json`, `add_to_queue.json`, `get_playback_info.json` — widen `filter` to `driver_id=spotify-connect|spotify-sonos`.
- `.homeychangelog.json` — add `1.5.0` entry.
- `widgets/song-search/api.js` — resolve device across both drivers; call contract methods.
- `widgets/song-search/public/index.html` — unchanged for v1 (device picker only renders when multiple devices; existing `Homey.getDeviceIds()` already handles both drivers).

---

## Task 1: Add `test` script and scaffold `test/` directory

**Files:**
- Modify: `package.json`
- Create: `test/.gitkeep`

- [ ] **Step 1: Read current `package.json`**

Run: `cat package.json`
Expected output:
```json
{
  "dependencies": {
    "homey-oauth2app": "^3.5.7"
  }
}
```

- [ ] **Step 2: Replace `package.json` content**

```json
{
  "scripts": {
    "test": "node --test test/*.test.js"
  },
  "dependencies": {
    "homey-oauth2app": "^3.5.7"
  }
}
```

- [ ] **Step 3: Create `test/.gitkeep` to track the empty directory**

```
```

(empty file)

- [ ] **Step 4: Verify `npm test` runs (expected: "tests 0")**

Run: `npm test`
Expected: exits 0 with `# tests 0` (no tests found yet — that's fine).

- [ ] **Step 5: Commit**

```bash
git add package.json test/.gitkeep
git commit -m "Add test script scaffold"
```

---

## Task 2: `parseSpotifyUri` helper with tests

**Files:**
- Create: `test/spotifyUri.test.js`
- Create: `lib/helpers/spotifyUri.js`

Parses a Spotify URI string into its kind and id; rejects malformed input.

- [ ] **Step 1: Write the failing test**

Create `test/spotifyUri.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSpotifyUri } = require('../lib/helpers/spotifyUri');

test('parseSpotifyUri: track', () => {
	assert.deepEqual(
		parseSpotifyUri('spotify:track:4iV5W9uYEdYUVa79Axb7Rh'),
		{ kind: 'track', id: '4iV5W9uYEdYUVa79Axb7Rh' }
	);
});

test('parseSpotifyUri: album', () => {
	assert.deepEqual(
		parseSpotifyUri('spotify:album:1DFixLWuPkv3KT3TnV35m3'),
		{ kind: 'album', id: '1DFixLWuPkv3KT3TnV35m3' }
	);
});

test('parseSpotifyUri: artist', () => {
	assert.deepEqual(
		parseSpotifyUri('spotify:artist:4Z8W4fKeB5YxbusRsdQVPb'),
		{ kind: 'artist', id: '4Z8W4fKeB5YxbusRsdQVPb' }
	);
});

test('parseSpotifyUri: playlist', () => {
	assert.deepEqual(
		parseSpotifyUri('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'),
		{ kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' }
	);
});

test('parseSpotifyUri: user playlist', () => {
	assert.deepEqual(
		parseSpotifyUri('spotify:user:someuser:playlist:37i9dQZF1DXcBWIGoYBM5M'),
		{ kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M', user: 'someuser' }
	);
});

test('parseSpotifyUri: rejects empty', () => {
	assert.throws(() => parseSpotifyUri(''), /invalid spotify uri/i);
});

test('parseSpotifyUri: rejects non-spotify', () => {
	assert.throws(() => parseSpotifyUri('http://example.com'), /invalid spotify uri/i);
});

test('parseSpotifyUri: rejects unknown kind', () => {
	assert.throws(() => parseSpotifyUri('spotify:episode:abc'), /unsupported spotify kind/i);
});
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

Run: `npm test`
Expected: fails loading `../lib/helpers/spotifyUri`.

- [ ] **Step 3: Implement `parseSpotifyUri`**

Create `lib/helpers/spotifyUri.js`:

```javascript
'use strict';

const KINDS = ['track', 'album', 'artist', 'playlist'];

function parseSpotifyUri(uri) {
	if (typeof uri !== 'string' || uri.length === 0) {
		throw new Error('Invalid Spotify URI: empty');
	}

	const parts = uri.split(':');

	// spotify:<kind>:<id>
	if (parts.length === 3 && parts[0] === 'spotify') {
		const [, kind, id] = parts;
		if (!KINDS.includes(kind)) {
			throw new Error(`Unsupported Spotify kind: ${kind}`);
		}
		return { kind, id };
	}

	// spotify:user:<user>:playlist:<id>
	if (parts.length === 5 && parts[0] === 'spotify' && parts[1] === 'user' && parts[3] === 'playlist') {
		return { kind: 'playlist', id: parts[4], user: parts[2] };
	}

	throw new Error(`Invalid Spotify URI: ${uri}`);
}

module.exports = { parseSpotifyUri };
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add test/spotifyUri.test.js lib/helpers/spotifyUri.js
git commit -m "Add parseSpotifyUri helper"
```

---

## Task 3: `buildDidlMetadata` helper with tests

**Files:**
- Modify: `test/spotifyUri.test.js`
- Modify: `lib/helpers/spotifyUri.js`

Produces the DIDL-Lite XML envelope Sonos requires when `setAVTransportURI` is called with a context (album/artist/playlist) URI. For single tracks, returns an empty string (the `sonos` lib accepts raw track URIs with no metadata).

- [ ] **Step 1: Append failing tests**

Append to `test/spotifyUri.test.js`:

```javascript
const { buildDidlMetadata } = require('../lib/helpers/spotifyUri');

test('buildDidlMetadata: track returns empty string', () => {
	const meta = buildDidlMetadata({ kind: 'track', id: '4iV5W9uYEdYUVa79Axb7Rh' });
	assert.equal(meta, '');
});

test('buildDidlMetadata: album wraps id in DIDL-Lite with class object.container.album.musicAlbum', () => {
	const meta = buildDidlMetadata({ kind: 'album', id: '1DFixLWuPkv3KT3TnV35m3' });
	assert.match(meta, /<DIDL-Lite[^>]*>/);
	assert.match(meta, /spotify:album:1DFixLWuPkv3KT3TnV35m3/);
	assert.match(meta, /object\.container\.album\.musicAlbum/);
});

test('buildDidlMetadata: playlist wraps in object.container.playlistContainer', () => {
	const meta = buildDidlMetadata({ kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
	assert.match(meta, /spotify:playlist:37i9dQZF1DXcBWIGoYBM5M/);
	assert.match(meta, /object\.container\.playlistContainer/);
});

test('buildDidlMetadata: artist wraps in object.container.person.musicArtist', () => {
	const meta = buildDidlMetadata({ kind: 'artist', id: '4Z8W4fKeB5YxbusRsdQVPb' });
	assert.match(meta, /spotify:artist:4Z8W4fKeB5YxbusRsdQVPb/);
	assert.match(meta, /object\.container\.person\.musicArtist/);
});

test('buildDidlMetadata: escapes XML characters in id (defence)', () => {
	const meta = buildDidlMetadata({ kind: 'album', id: 'a&b<c>"d' });
	assert.doesNotMatch(meta, /[^&]&[^amp;]/); // no unescaped ampersand
	assert.doesNotMatch(meta, /<c>/);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test`
Expected: fails — `buildDidlMetadata` undefined.

- [ ] **Step 3: Implement `buildDidlMetadata`**

Replace `lib/helpers/spotifyUri.js` module exports section and append the new function. Final file content:

```javascript
'use strict';

const KINDS = ['track', 'album', 'artist', 'playlist'];

// Spotify service ID registered with Sonos. 2311 is the widely-used value for
// the third-party Spotify service; if a user's household uses a different ID
// the helper still produces valid XML — Sonos rejects at playback time, and we
// surface that error at the driver layer.
const SPOTIFY_SERVICE_TOKEN = 'SA_RINCON2311_X_#Svc2311-0-Token';

const CLASS_BY_KIND = {
	album: 'object.container.album.musicAlbum',
	artist: 'object.container.person.musicArtist',
	playlist: 'object.container.playlistContainer',
};

function parseSpotifyUri(uri) {
	if (typeof uri !== 'string' || uri.length === 0) {
		throw new Error('Invalid Spotify URI: empty');
	}

	const parts = uri.split(':');

	if (parts.length === 3 && parts[0] === 'spotify') {
		const [, kind, id] = parts;
		if (!KINDS.includes(kind)) {
			throw new Error(`Unsupported Spotify kind: ${kind}`);
		}
		return { kind, id };
	}

	if (parts.length === 5 && parts[0] === 'spotify' && parts[1] === 'user' && parts[3] === 'playlist') {
		return { kind: 'playlist', id: parts[4], user: parts[2] };
	}

	throw new Error(`Invalid Spotify URI: ${uri}`);
}

function escapeXml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function buildDidlMetadata({ kind, id }) {
	if (kind === 'track') {
		return '';
	}

	const upnpClass = CLASS_BY_KIND[kind];
	if (!upnpClass) {
		throw new Error(`No DIDL-Lite class for kind: ${kind}`);
	}

	const safeId = escapeXml(id);
	const itemId = `0${kind[0]}${safeId}`; // simple prefix; Sonos treats this as opaque

	return (
		'<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"'
		+ ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"'
		+ ' xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"'
		+ ' xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">'
		+ `<item id="${itemId}" parentID="0" restricted="true">`
		+ `<dc:title>${kind}</dc:title>`
		+ `<upnp:class>${upnpClass}</upnp:class>`
		+ `<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">${SPOTIFY_SERVICE_TOKEN}</desc>`
		+ `<res protocolInfo="sonos.com-spotify:*:*:*">spotify:${kind}:${safeId}</res>`
		+ '</item>'
		+ '</DIDL-Lite>'
	);
}

module.exports = { parseSpotifyUri, buildDidlMetadata };
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test`
Expected: 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add test/spotifyUri.test.js lib/helpers/spotifyUri.js
git commit -m "Add buildDidlMetadata helper"
```

---

## Task 4: `combinePlayMode` helper with tests

**Files:**
- Modify: `test/spotifyUri.test.js`
- Modify: `lib/helpers/spotifyUri.js`

Maps `(shuffle: bool, repeat: 'none' | 'track' | 'playlist')` to one of Sonos's six play modes: `NORMAL`, `REPEAT_ALL`, `REPEAT_ONE`, `SHUFFLE_NOREPEAT`, `SHUFFLE`, `SHUFFLE_REPEAT_ONE`.

- [ ] **Step 1: Append failing tests**

Append to `test/spotifyUri.test.js`:

```javascript
const { combinePlayMode } = require('../lib/helpers/spotifyUri');

test('combinePlayMode: no shuffle, no repeat → NORMAL', () => {
	assert.equal(combinePlayMode(false, 'none'), 'NORMAL');
});

test('combinePlayMode: no shuffle, repeat track → REPEAT_ONE', () => {
	assert.equal(combinePlayMode(false, 'track'), 'REPEAT_ONE');
});

test('combinePlayMode: no shuffle, repeat playlist → REPEAT_ALL', () => {
	assert.equal(combinePlayMode(false, 'playlist'), 'REPEAT_ALL');
});

test('combinePlayMode: shuffle, no repeat → SHUFFLE_NOREPEAT', () => {
	assert.equal(combinePlayMode(true, 'none'), 'SHUFFLE_NOREPEAT');
});

test('combinePlayMode: shuffle, repeat playlist → SHUFFLE', () => {
	assert.equal(combinePlayMode(true, 'playlist'), 'SHUFFLE');
});

test('combinePlayMode: shuffle, repeat track → SHUFFLE_REPEAT_ONE', () => {
	assert.equal(combinePlayMode(true, 'track'), 'SHUFFLE_REPEAT_ONE');
});

test('combinePlayMode: rejects unknown repeat value', () => {
	assert.throws(() => combinePlayMode(false, 'invalid'), /unknown repeat/i);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test`
Expected: fails — `combinePlayMode` undefined.

- [ ] **Step 3: Add `combinePlayMode` to `lib/helpers/spotifyUri.js`**

Add the function above `module.exports`:

```javascript
function combinePlayMode(shuffle, repeat) {
	const validRepeats = ['none', 'track', 'playlist'];
	if (!validRepeats.includes(repeat)) {
		throw new Error(`Unknown repeat: ${repeat}`);
	}
	if (shuffle) {
		if (repeat === 'track') return 'SHUFFLE_REPEAT_ONE';
		if (repeat === 'playlist') return 'SHUFFLE';
		return 'SHUFFLE_NOREPEAT';
	}
	if (repeat === 'track') return 'REPEAT_ONE';
	if (repeat === 'playlist') return 'REPEAT_ALL';
	return 'NORMAL';
}
```

And update the exports line to:

```javascript
module.exports = { parseSpotifyUri, buildDidlMetadata, combinePlayMode };
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test`
Expected: 20 tests pass.

- [ ] **Step 5: Commit**

```bash
git add test/spotifyUri.test.js lib/helpers/spotifyUri.js
git commit -m "Add combinePlayMode helper"
```

---

## Task 5: Volume-scale helpers with tests

**Files:**
- Create: `test/volumeScale.test.js`
- Create: `lib/helpers/volumeScale.js`

The existing `spotify-connect` driver declares `volume_set` as `-1..1` step `0.01`. The Sonos driver uses the same range for consistency. These helpers convert between Homey's `-1..1` and Sonos's `0..100`.

- [ ] **Step 1: Write failing tests**

Create `test/volumeScale.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { homeyVolumeToSonos, sonosVolumeToHomey } = require('../lib/helpers/volumeScale');

test('homeyVolumeToSonos: -1 → 0', () => {
	assert.equal(homeyVolumeToSonos(-1), 0);
});

test('homeyVolumeToSonos: 0 → 50', () => {
	assert.equal(homeyVolumeToSonos(0), 50);
});

test('homeyVolumeToSonos: 1 → 100', () => {
	assert.equal(homeyVolumeToSonos(1), 100);
});

test('homeyVolumeToSonos: 0.5 → 75', () => {
	assert.equal(homeyVolumeToSonos(0.5), 75);
});

test('homeyVolumeToSonos: clamps below -1 to 0', () => {
	assert.equal(homeyVolumeToSonos(-2), 0);
});

test('homeyVolumeToSonos: clamps above 1 to 100', () => {
	assert.equal(homeyVolumeToSonos(2), 100);
});

test('sonosVolumeToHomey: 0 → -1', () => {
	assert.equal(sonosVolumeToHomey(0), -1);
});

test('sonosVolumeToHomey: 50 → 0', () => {
	assert.equal(sonosVolumeToHomey(50), 0);
});

test('sonosVolumeToHomey: 100 → 1', () => {
	assert.equal(sonosVolumeToHomey(100), 1);
});

test('sonosVolumeToHomey: round-trip stable', () => {
	for (const v of [-1, -0.5, 0, 0.5, 1]) {
		assert.equal(sonosVolumeToHomey(homeyVolumeToSonos(v)), v);
	}
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test`
Expected: fails — module not found.

- [ ] **Step 3: Implement**

Create `lib/helpers/volumeScale.js`:

```javascript
'use strict';

function homeyVolumeToSonos(volume) {
	const clamped = Math.max(-1, Math.min(1, volume));
	return Math.round((clamped + 1) * 50);
}

function sonosVolumeToHomey(percent) {
	const clamped = Math.max(0, Math.min(100, percent));
	return (clamped / 50) - 1;
}

module.exports = { homeyVolumeToSonos, sonosVolumeToHomey };
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test`
Expected: all tests pass (30 total now).

- [ ] **Step 5: Commit**

```bash
git add test/volumeScale.test.js lib/helpers/volumeScale.js
git commit -m "Add volume scale helpers"
```

---

## Task 6: Add `getPlaybackInfo()` on the OAuth2 client

**Files:**
- Modify: `lib/SpotifyConnectOAuth2Client.js`

Normalises the Spotify `/me/player` response into the same shape the Sonos driver will produce, so both device classes satisfy the contract identically.

- [ ] **Step 1: Open the file and add the new method**

In `lib/SpotifyConnectOAuth2Client.js`, inside the class, after the existing `addToQueueAndSkip` method, add:

```javascript
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
```

- [ ] **Step 2: Validate the app still loads**

Run: `npx homey app validate`
Expected: passes with level `debug` (default).

- [ ] **Step 3: Commit**

```bash
git add lib/SpotifyConnectOAuth2Client.js
git commit -m "Add getPlaybackInfo on OAuth2Client"
```

---

## Task 7: Expose the contract on `spotify-connect` device

**Files:**
- Modify: `drivers/spotify-connect/device.js`

Add `playTrack`, `playContext`, `addToQueue`, `getPlaybackInfo` as thin methods on the device. No behaviour change — just surfacing the contract so `app.js` can be driver-agnostic.

- [ ] **Step 1: Add contract methods to `SpotifyConnectDevice`**

Open `drivers/spotify-connect/device.js`. Inside the class, after the existing `async state()` method and before the `Capabilities` comment block, add:

```javascript
	/*
		Common contract (matches spotify-sonos device)
	*/
	async playTrack(uri) {
		return this.oAuth2Client.addToQueueAndSkip(this._id, uri);
	}

	async playContext(uri) {
		return this.oAuth2Client.playContext(this._id, uri);
	}

	async addToQueue(uri) {
		try {
			return await this.oAuth2Client.addToQueue(this._id, uri);
		} catch (error) {
			if (error.status === 404 || error.statusCode === 404) {
				return this.oAuth2Client.playTrack(this._id, uri);
			}
			throw error;
		}
	}

	async getPlaybackInfo() {
		return this.oAuth2Client.getPlaybackInfo();
	}
```

- [ ] **Step 2: Validate the app still loads**

Run: `npx homey app validate`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add drivers/spotify-connect/device.js
git commit -m "Expose common playback contract on spotify-connect device"
```

---

## Task 8: Refactor `app.js` to use the contract

**Files:**
- Modify: `app.js`

Each flow-card run listener becomes a one-liner calling a contract method on the device. Autocomplete listeners stay as-is.

- [ ] **Step 1: Read current `app.js`**

Run: `cat app.js`

- [ ] **Step 2: Replace the entire file content**

Overwrite `app.js`:

```javascript
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
			const results = await args.device.oAuth2Client.getMyPlaylists(50);
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
```

- [ ] **Step 3: Validate**

Run: `npx homey app validate`
Expected: passes.

- [ ] **Step 4: Run the app and exercise one flow card with a Spotify Connect device (manual regression check)**

Run: `npx homey app run`
From Homey: trigger `Play a song` flow against an existing Spotify Connect device; verify it still plays.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Refactor app.js flow listeners onto device contract"
```

---

## Task 9: Add `sonos` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install `sonos` at a known-good version**

Run: `npm install sonos@1.15.0 --save-exact`
Expected: `package-lock.json` is updated and `sonos` is added under `dependencies`.

- [ ] **Step 2: Verify the dependency is declared**

Run: `node -e "console.log(require('sonos').Sonos !== undefined)"`
Expected: `true`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add sonos dependency"
```

---

## Task 10: `SonosClient` wrapper

**Files:**
- Create: `lib/SonosClient.js`

Wraps the `sonos` npm package. Exposes a static `discover(timeoutMs)` that returns `[{ name, ip, uuid }]`, a static `fromIp(ip)` that returns an instance, and instance methods implementing the contract plus transport primitives.

- [ ] **Step 1: Create the file**

Create `lib/SonosClient.js`:

```javascript
'use strict';

const { Sonos, DeviceDiscovery } = require('sonos');

const { parseSpotifyUri, buildDidlMetadata, combinePlayMode } = require('./helpers/spotifyUri');
const { homeyVolumeToSonos, sonosVolumeToHomey } = require('./helpers/volumeScale');

/**
 * Translate UPnP faults and library errors into messages Homey users can act
 * on. The sonos lib surfaces UPnP errors with the fault code in the message
 * string; we match on those known codes.
 */
function translateSonosError(error) {
	const message = error?.message || String(error);
	if (/(\s|^)800\b/.test(message) || /Spotify.*not.*authori[sz]ed/i.test(message)) {
		return new Error('Spotify is not linked on this Sonos speaker. Open the Sonos app → Settings → Services and sign in.');
	}
	if (/(\s|^)801\b/.test(message) || /premium/i.test(message)) {
		return new Error('Spotify Premium is required to play on Sonos.');
	}
	if (/ECONN|EHOST|ETIMEDOUT/.test(message)) {
		return new Error(`Sonos speaker is unreachable: ${message}`);
	}
	return error;
}

class SonosClient {

	/**
	 * Discover Sonos speakers on the LAN via SSDP.
	 * Resolves with [{ name, ip, uuid }]. Empty array on timeout.
	 */
	static async discover(timeoutMs = 4000) {
		return new Promise((resolve) => {
			const found = new Map();

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

			discovery.on('timeout', () => {
				resolve(Array.from(found.values()));
			});
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
		return this.sonos.getName();
	}

	async playTrack(uri) {
		parseSpotifyUri(uri); // throws on invalid
		try {
			await this.sonos.setAVTransportURI({ uri, metadata: '' });
			return await this.sonos.play();
		} catch (error) {
			throw translateSonosError(error);
		}
	}

	async playContext(uri) {
		const parsed = parseSpotifyUri(uri);
		const metadata = buildDidlMetadata(parsed);
		try {
			await this.sonos.setAVTransportURI({ uri, metadata });
			return await this.sonos.play();
		} catch (error) {
			throw translateSonosError(error);
		}
	}

	/**
	 * Add to queue; fall back to play-now if no queue is active or the Sonos
	 * rejects the queue call (e.g. current transport is a direct URI).
	 */
	async addToQueue(uri) {
		parseSpotifyUri(uri);
		try {
			return await this.sonos.queue(uri);
		} catch (error) {
			// Queue failures typically mean "no active queue" — fall back to
			// direct play, which also handles Spotify-not-linked surfacing.
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
		const [track, volumePercent, muted, transportState, positionInfo, playMode] = await Promise.all([
			this.sonos.currentTrack(),
			this.sonos.getVolume(),
			this.sonos.getMuted(),
			this.sonos.getCurrentState(),
			this.sonos.avTransportService().GetPositionInfo().catch(() => ({})),
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
```

- [ ] **Step 2: Sanity-check that it loads without syntax errors**

Run: `node -e "const C = require('./lib/SonosClient'); console.log(typeof C.discover, typeof C.fromIp)"`
Expected: `function function`.

- [ ] **Step 3: Commit**

```bash
git add lib/SonosClient.js
git commit -m "Add SonosClient wrapper"
```

---

## Task 11: `spotify-sonos` driver compose + assets

**Files:**
- Create: `drivers/spotify-sonos/driver.compose.json`
- Create: `drivers/spotify-sonos/assets/images/small.jpg`
- Create: `drivers/spotify-sonos/assets/images/large.jpg`

- [ ] **Step 1: Create the driver compose file**

Create `drivers/spotify-sonos/driver.compose.json`:

```json
{
	"id": "spotify-sonos",
	"name": {
		"en": "Spotify on Sonos"
	},
	"class": "speaker",
	"capabilities": [
		"speaker_playing",
		"speaker_artist",
		"speaker_album",
		"speaker_track",
		"speaker_shuffle",
		"speaker_repeat",
		"speaker_next",
		"speaker_prev",
		"volume_set",
		"volume_up",
		"volume_down",
		"volume_mute"
	],
	"capabilitiesOptions": {
		"volume_set": {
			"min": -1,
			"max": 1,
			"step": 0.01
		}
	},
	"images": {
		"large": "{{driverAssetsPath}}/images/large.jpg",
		"small": "{{driverAssetsPath}}/images/small.jpg"
	},
	"pair": [
		{
			"id": "login_oauth2",
			"template": "login_oauth2"
		},
		{
			"id": "discover_sonos",
			"navigation": {
				"next": "add_devices"
			}
		},
		{
			"id": "add_devices",
			"template": "add_devices"
		}
	],
	"repair": [
		{
			"id": "login_oauth2",
			"template": "login_oauth2"
		}
	]
}
```

- [ ] **Step 2: Copy placeholder icons from the existing driver**

Run:
```bash
mkdir -p drivers/spotify-sonos/assets/images
cp drivers/spotify-connect/assets/images/small.jpg drivers/spotify-sonos/assets/images/small.jpg
cp drivers/spotify-connect/assets/images/large.jpg drivers/spotify-sonos/assets/images/large.jpg
```

- [ ] **Step 3: Commit**

```bash
git add drivers/spotify-sonos/driver.compose.json drivers/spotify-sonos/assets
git commit -m "Scaffold spotify-sonos driver compose and assets"
```

---

## Task 12: `spotify-sonos` driver.js with discovery + manual-IP handler

**Files:**
- Create: `drivers/spotify-sonos/driver.js`

- [ ] **Step 1: Create the driver**

Create `drivers/spotify-sonos/driver.js`:

```javascript
'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

const SonosClient = require('../../lib/SonosClient');

module.exports = class SpotifySonosDriver extends OAuth2Driver {

	/**
	 * Extends the OAuth2Driver pair flow. super.onPair wires up OAuth2 login
	 * and `list_devices`; we add handlers for our custom `discover_sonos`
	 * view (SSDP discovery + manual IP entry).
	 */
	async onPair(session) {
		await super.onPair(session);

		let pickedDevices = [];

		session.setHandler('sonos:discover', async () => {
			const found = await SonosClient.discover(4000);
			return found.map(({ name, ip, uuid }) => ({ name, ip, uuid }));
		});

		session.setHandler('sonos:validate_ip', async (ip) => {
			const client = SonosClient.fromIp(ip);
			const name = await client.getName();
			// we don't have a UUID from manual IP; generate a stable id from ip
			return { name, ip, uuid: `manual:${ip}` };
		});

		session.setHandler('sonos:pick', async (devices) => {
			pickedDevices = devices;
			return true;
		});

		// When the pair navigation transitions from discover_sonos to
		// add_devices, the add_devices template will call list_devices.
		// We return whatever the user picked.
		session.setHandler('list_devices', async () => {
			return pickedDevices.map(({ name, ip, uuid }) => ({
				name,
				data: { uuid },
				store: { ip },
			}));
		});
	}

	/**
	 * Unused (custom list_devices above) but kept for parity with the
	 * OAuth2Driver contract.
	 */
	async onPairListDevices() {
		return [];
	}

};
```

- [ ] **Step 2: Validate**

Run: `npx homey app validate`
Expected: passes. (The app.json is regenerated from `.homeycompose/app.json` + per-driver `driver.compose.json` by the Homey CLI.)

- [ ] **Step 3: Commit**

```bash
git add drivers/spotify-sonos/driver.js
git commit -m "Add spotify-sonos driver with discovery + manual IP"
```

---

## Task 13: `discover_sonos` pair view

**Files:**
- Create: `drivers/spotify-sonos/pair/discover_sonos.html`

- [ ] **Step 1: Create the view**

Create `drivers/spotify-sonos/pair/discover_sonos.html`:

```html
<!DOCTYPE html>
<html>
<head>
	<style>
		.wrap { padding: 16px; font-family: sans-serif; }
		.actions { margin-top: 12px; }
		.device { padding: 12px; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; cursor: pointer; }
		.device.selected { border-color: #1DB954; background: #e7f7ec; }
		.device input { margin: 0; }
		.muted { color: #666; font-size: 12px; }
		.row { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
		input[type="text"] { flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
		button { padding: 8px 14px; border-radius: 4px; border: 1px solid #1DB954; background: #1DB954; color: white; cursor: pointer; }
		button:disabled { opacity: 0.5; cursor: default; }
		.secondary { background: white; color: #333; border-color: #ccc; }
		.error { color: #c00; font-size: 13px; margin-top: 8px; }
	</style>
</head>
<body>
	<div class="wrap">
		<h2 data-i18n="pair.discover_sonos.title">Find your Sonos speakers</h2>
		<p class="muted" data-i18n="pair.discover_sonos.subtitle">Make sure your Sonos speakers are powered on and connected to the same Wi-Fi network as Homey.</p>

		<div id="list"></div>
		<div id="empty" class="muted" style="display:none;">No Sonos speakers found on the network.</div>

		<div class="row">
			<input type="text" id="manualIp" placeholder="Enter IP address manually (e.g. 192.168.1.42)" />
			<button class="secondary" id="manualAddBtn">Add</button>
		</div>
		<div class="error" id="error"></div>

		<div class="actions row">
			<button class="secondary" id="rescanBtn">Re-scan</button>
			<button id="continueBtn" disabled>Continue</button>
		</div>
	</div>

	<script type="text/javascript">
		let picked = new Map();

		function onHomeyReady(Homey) {
			Homey.ready();

			const listEl = document.getElementById('list');
			const emptyEl = document.getElementById('empty');
			const errEl = document.getElementById('error');
			const continueBtn = document.getElementById('continueBtn');
			const rescanBtn = document.getElementById('rescanBtn');
			const manualIp = document.getElementById('manualIp');
			const manualAddBtn = document.getElementById('manualAddBtn');

			function refreshContinueState() {
				continueBtn.disabled = picked.size === 0;
			}

			function renderDevice(device) {
				const key = device.uuid;
				if (document.querySelector(`[data-uuid="${key}"]`)) return;

				const row = document.createElement('div');
				row.className = 'device';
				row.dataset.uuid = key;

				const cb = document.createElement('input');
				cb.type = 'checkbox';

				const label = document.createElement('div');
				label.innerHTML = `<strong>${device.name}</strong><div class="muted">${device.ip}</div>`;

				row.appendChild(cb);
				row.appendChild(label);

				row.addEventListener('click', (e) => {
					if (e.target !== cb) cb.checked = !cb.checked;
					if (cb.checked) {
						picked.set(key, device);
						row.classList.add('selected');
					} else {
						picked.delete(key);
						row.classList.remove('selected');
					}
					refreshContinueState();
				});

				listEl.appendChild(row);
			}

			async function scan() {
				listEl.innerHTML = '';
				emptyEl.style.display = 'none';
				errEl.textContent = '';
				rescanBtn.disabled = true;
				rescanBtn.textContent = 'Scanning…';
				try {
					const devices = await Homey.emit('sonos:discover');
					(devices || []).forEach(renderDevice);
					if ((devices || []).length === 0) emptyEl.style.display = 'block';
				} catch (err) {
					errEl.textContent = `Scan failed: ${err.message || err}`;
				} finally {
					rescanBtn.disabled = false;
					rescanBtn.textContent = 'Re-scan';
				}
			}

			manualAddBtn.addEventListener('click', async () => {
				const ip = manualIp.value.trim();
				if (!ip) return;
				errEl.textContent = '';
				manualAddBtn.disabled = true;
				try {
					const device = await Homey.emit('sonos:validate_ip', ip);
					renderDevice(device);
					manualIp.value = '';
				} catch (err) {
					errEl.textContent = `Could not reach speaker at ${ip}: ${err.message || err}`;
				} finally {
					manualAddBtn.disabled = false;
				}
			});

			rescanBtn.addEventListener('click', scan);

			continueBtn.addEventListener('click', async () => {
				await Homey.emit('sonos:pick', Array.from(picked.values()));
				Homey.nextView();
			});

			scan();
		}
	</script>
</body>
</html>
```

- [ ] **Step 2: Validate**

Run: `npx homey app validate`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add drivers/spotify-sonos/pair/discover_sonos.html
git commit -m "Add discover_sonos pair view"
```

---

## Task 14: `spotify-sonos` device.js — capabilities + sync

**Files:**
- Create: `drivers/spotify-sonos/device.js`

- [ ] **Step 1: Create the device**

Create `drivers/spotify-sonos/device.js`:

```javascript
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
		await super.onOAuth2Deleted();
		if (this.syncInterval) clearInterval(this.syncInterval);
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

		if (snap.albumArtUrl) {
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
```

- [ ] **Step 2: Validate**

Run: `npx homey app validate`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add drivers/spotify-sonos/device.js
git commit -m "Add spotify-sonos device with sync and capabilities"
```

---

## Task 15: Widen flow-card device filters

**Files:**
- Modify: `.homeycompose/flow/actions/play_song.json`
- Modify: `.homeycompose/flow/actions/play_album.json`
- Modify: `.homeycompose/flow/actions/play_artist.json`
- Modify: `.homeycompose/flow/actions/play_playlist.json`
- Modify: `.homeycompose/flow/actions/add_to_queue.json`
- Modify: `.homeycompose/flow/actions/get_playback_info.json`

- [ ] **Step 1: Update each file's device filter**

In every file above, find the line:

```json
			"filter": "driver_id=spotify-connect"
```

Replace with:

```json
			"filter": "driver_id=spotify-connect|spotify-sonos"
```

- [ ] **Step 2: Validate**

Run: `npx homey app validate`
Expected: passes.

- [ ] **Step 3: Fallback if the `|` syntax is rejected**

If `homey app validate` errors on the pipe syntax, remove the `filter` key entirely from each of the six files, and extend each autocomplete listener in `app.js` with an early guard. Example for `_registerPlaySong`:

```javascript
		card.registerArgumentAutocompleteListener('song', async (query, args) => {
			const id = args.device?.driver?.id;
			if (id !== 'spotify-connect' && id !== 'spotify-sonos') return [];
			if (!query || query.length < 2) return [];
			// ...rest unchanged
		});
```

Apply the same guard to each of the six card registrations before re-running `npx homey app validate`.

- [ ] **Step 4: Commit**

```bash
git add .homeycompose/flow/actions app.js
git commit -m "Allow flow cards to target spotify-sonos devices"
```

---

## Task 16: Update widget to accept both drivers

**Files:**
- Modify: `widgets/song-search/api.js`

`getDriver('spotify-connect')` is hardcoded; expand to look across both drivers.

- [ ] **Step 1: Replace the file content**

Overwrite `widgets/song-search/api.js`:

```javascript
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
```

- [ ] **Step 2: Validate**

Run: `npx homey app validate`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add widgets/song-search/api.js
git commit -m "Make song-search widget driver-agnostic"
```

---

## Task 17: Version bump + changelog

**Files:**
- Modify: `.homeycompose/app.json`
- Modify: `.homeychangelog.json`

- [ ] **Step 1: Bump version in `.homeycompose/app.json`**

Change:

```json
"version": "1.4.1",
```

to:

```json
"version": "1.5.0",
```

- [ ] **Step 2: Add changelog entry**

In `.homeychangelog.json`, add a new entry at the top of the JSON object:

```json
	"1.5.0": {
		"en": "Added Sonos driver for direct Spotify playback via UPnP. Works alongside the existing Spotify Connect driver."
	},
```

(Comma-terminated; the existing `1.4.1` entry stays.)

- [ ] **Step 3: Validate**

Run: `npx homey app validate`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add .homeycompose/app.json .homeychangelog.json
git commit -m "Bump version to 1.5.0"
```

---

## Task 18: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the app locally**

Run: `npx homey app run`
Expected: the app starts and registers both drivers.

- [ ] **Step 2: Pair a Sonos via discovery**

From Homey: Add device → Spotify Connect app → "Spotify on Sonos" → log in with Spotify → discovery view shows your speaker → select → Continue → Add devices.
Expected: device appears on the dashboard, populates within 15s with artist/album/track from current Sonos state.

- [ ] **Step 3: Pair a Sonos via manual IP**

Repeat the pairing flow. Before picking from the discovered list, enter an IP manually (use the IP of the same speaker for testing) → Add → confirms and appears in the list → Continue.
Expected: pairs successfully.

- [ ] **Step 4: Exercise each flow card against the Sonos device**

From Homey Flow editor, create and trigger one flow per card:
- `Play a song` → search a known track → run → Sonos plays it.
- `Play an album` → run → Sonos plays the album context.
- `Play an artist` → run → Sonos plays the artist context.
- `Play a playlist` → pick from user playlists → run → Sonos plays the playlist.
- `Add song to queue` → while playback is active → song queues.
- `Get current playback info` → returns non-empty tokens matching what's playing.

Expected: each action succeeds within ~2s; Sonos reflects the change.

- [ ] **Step 5: Exercise each capability from the device tile**

On the Homey device tile for the Sonos speaker:
- Play/pause toggle → Sonos follows.
- Next/previous → Sonos follows.
- Volume slider → Sonos follows.
- Mute → Sonos follows.
- Shuffle, repeat → Sonos follows (note: shuffle/repeat only apply while a queue/context is active).

- [ ] **Step 6: Regression-check the Spotify Connect driver**

With an existing Spotify Connect device: run `Play a song` flow; toggle capabilities from the tile. Confirm behaviour is unchanged from pre-refactor.

- [ ] **Step 7: Widget smoke test**

Add the `song-search` widget to the Homey dashboard with the Sonos device selected. Search for a track. Click it. Expected: Sonos plays the track; no errors in the app log.

- [ ] **Step 8: Sync-loop smoke test**

Change the track on the Sonos speaker from the Sonos app directly. Wait up to 15s. Verify the Homey device tile updates artist/album/track accordingly.

- [ ] **Step 9: Unavailability smoke test**

Power off the Sonos speaker. Wait up to 30s. Verify the Homey device becomes unavailable with a reasonable error message. Power it back on. Verify it becomes available again on the next sync.

- [ ] **Step 10: No commit needed**

If any of the above steps fails, open a new task in the plan or an in-session TODO to address it before proceeding to push / release.
