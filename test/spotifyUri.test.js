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
