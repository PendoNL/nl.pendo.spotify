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
