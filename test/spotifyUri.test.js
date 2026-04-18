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
	assert.doesNotMatch(meta, /&(?!amp;|lt;|gt;|quot;|apos;)/); // no unescaped ampersand
	assert.doesNotMatch(meta, /<c>/);
});
