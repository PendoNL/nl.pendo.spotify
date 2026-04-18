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
