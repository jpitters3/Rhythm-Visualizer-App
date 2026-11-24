import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepNotes, soundKind, chipText, countFor, chordName } from '../../js/play-along-model.js';

const alt = i => (i % 2 === 0 ? 'R' : 'L');

test('a rest has no notes', () => {
  assert.equal(stepNotes('', 0, alt), null);
  assert.equal(stepNotes(['', '', '', ''], 0, alt), null);
});

test('a single note takes the step hand', () => {
  assert.deepEqual(stepNotes('3', 0, alt), [{ label: '3', hand: 'R' }]);
  assert.deepEqual(stepNotes('T', 1, alt), [{ label: 'T', hand: 'L' }]);
});

test('chord slots 0-1 are the left hand, 2-3 the right', () => {
  assert.deepEqual(stepNotes(['4', '6', '8', ''], 0, alt), [
    { label: '4', hand: 'L' },
    { label: '6', hand: 'L' },
    { label: '8', hand: 'R' },
  ]);
  assert.deepEqual(stepNotes(['', '1', '3', '5'], 0, alt).map(n => n.hand), ['L', 'R', 'R']);
});

test('sound kinds and chip text', () => {
  assert.equal(soundKind('T'), 'tak');
  assert.equal(soundKind('S'), 'slap');
  assert.equal(soundKind('Ding'), 'ding');
  assert.equal(soundKind('5'), 'tone');
  assert.equal(chipText('Ding'), 'D');
  assert.equal(chipText('7'), '7');
});

test('counts follow the subdivision', () => {
  const eighths = Array.from({ length: 8 }, (_, i) => countFor(i, 4, 2).text);
  assert.deepEqual(eighths, ['1', '+', '2', '+', '3', '+', '4', '+']);
  const sixteenths = Array.from({ length: 4 }, (_, i) => countFor(i, 4, 4).text);
  assert.deepEqual(sixteenths, ['1', 'e', '+', 'a']);
  assert.deepEqual(countFor(8, 4, 2), { text: '1', onBeat: true });
});

test('triads get a short chord name', () => {
  assert.equal(chordName(['D4', 'F4', 'A4']), 'Dm');
  assert.equal(chordName(['C4', 'E4', 'G4']), 'C');
  assert.equal(chordName(['D3_ding', 'F4', 'A4']), 'Dm');
});

test('non-triads have no name', () => {
  assert.equal(chordName(['D4', 'A4']), '');
  assert.equal(chordName(['D4', 'E4', 'F4']), '');
  assert.equal(chordName(['tak', 'D4', 'F4']), '');
});
