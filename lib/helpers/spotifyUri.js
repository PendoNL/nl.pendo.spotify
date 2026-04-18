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
