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
