// Tempo and metre from note times (js/tempo-detect.js). Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBpm, detectBeatsPerBar } from '../../js/tempo-detect.js';

// wobble: a small, irregular early/late per note (ms), like a real player
const WOBBLE = [0, 6, -4, 9, -7, 3, -2, 8, -5, 4, -8, 2, 7, -3, 5, -6];
const beats = (bpm, n, wobble = 0) => Array.from({ length: n }, (_, i) => i * (60000 / bpm) + (WOBBLE[i % WOBBLE.length] * wobble) / 9);

test('steady beats give their tempo', () => {
  assert.equal(detectBpm(beats(90, 16)), 90);
  assert.equal(detectBpm(beats(120, 16)), 120);
});

test('a little human timing still lands on the tempo', () => {
  assert.ok(Math.abs(detectBpm(beats(90, 16, 9)) - 90) <= 2);
});

test('very fast or slow pulses fold into 40-180 BPM', () => {
  assert.equal(detectBpm(beats(240, 16)), 120);
  assert.equal(detectBpm(beats(30, 8)), 60);
});

test('too few notes: no guess', () => {
  assert.equal(detectBpm([0, 500, 1000]), null);
});

test('chord lengths pick the metre', () => {
  assert.equal(detectBeatsPerBar([4, 4, 4, 8]), 4);
  assert.equal(detectBeatsPerBar([3, 3, 6, 3]), 3);
  assert.equal(detectBeatsPerBar([6, 6]), 3);
});

test('a free-time intro doesn\'t outvote a steady groove', () => {
  // Heard in a test clip: three chords played freely (6, 6, 7 beats), then a steady 4
  assert.equal(detectBeatsPerBar([6, 6, 7, 4, 4, 4, 4, 4]), 4);
  assert.equal(detectBeatsPerBar([8, 8, 5, 3, 3, 3, 3, 3]), 3);
  // …and with one more long chord, which used to tip it to 3/4
  assert.equal(detectBeatsPerBar([6, 6, 7, 4, 4, 4, 4, 4, 6]), 4);
});

test('not enough chord changes: no guess, and ties go to 4', () => {
  assert.equal(detectBeatsPerBar([4]), null);
  assert.equal(detectBeatsPerBar([12, 12]), 4);
});
