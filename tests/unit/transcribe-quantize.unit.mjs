// Placing heard notes on a beat grid (js/transcribe-quantize.js). Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantize, findOffset } from '../../js/transcribe-quantize.js';

const BPM = 90;
const BEAT = 60000 / BPM;
// Small, irregular early/late per note (ms), like a real player
const WOBBLE = [0, 12, -9, 15, -14, 6, -4, 13, -10, 8, -15, 3, 11, -6, 9, -12];
// [beat position, label] → notes heard, with a downbeat at 1000 ms
function play(positions, { wobble = 0, late = 0 } = {}) {
  return positions.map(([beat, label], i) => ({ label, at: 1000 + beat * BEAT + late + (WOBBLE[i % WOBBLE.length] * wobble) / 15 }));
}
const run = (positions, opts = {}, q = {}) => quantize(play(positions, opts), { bpm: BPM, beatsPerBar: 4, downbeat: 1000, ...q });
// The steps as a short string: '.' empty, else the label(s)
const show = r => r.steps.map(s => (Array.isArray(s) ? `[${s.join('+')}]` : s || '.')).join(' ');

test('quarter notes stay quarter notes', () => {
  const r = run([[0, '1'], [1, '2'], [2, '3'], [3, '4']], { wobble: 15 });
  assert.equal(r.subdivision, 1);
  assert.equal(show(r), '1 2 3 4');
});

test('8ths and 16ths', () => {
  const eighths = run([[0, '1'], [0.5, '2'], [1, '3'], [1.5, '4']], { wobble: 15 });
  assert.equal(eighths.subdivision, 2);
  assert.equal(show(eighths), '1 2 3 4 . . . .');
  const sixteenths = run([[0, '1'], [0.25, '2'], [0.5, '3'], [0.75, '4'], [1, '5']], { wobble: 15 });
  assert.equal(sixteenths.subdivision, 4);
  assert.equal(show(sixteenths).slice(0, 9), '1 2 3 4 5');
});

test('triplets are told apart from 16ths', () => {
  const r = run([[0, '1'], [1 / 3, '2'], [2 / 3, '3'], [1, '4'], [4 / 3, '5'], [5 / 3, '6']], { wobble: 15 });
  assert.equal(r.subdivision, 3);
  assert.equal(show(r).slice(0, 11), '1 2 3 4 5 6');
});

test('a swung pair reads as triplets', () => {
  const r = run([[0, '1'], [2 / 3, '2'], [1, '1'], [5 / 3, '2'], [2, '1'], [8 / 3, '2']], { wobble: 15 });
  assert.equal(r.subdivision, 3);
  assert.equal(show(r).slice(0, 17), '1 . 2 1 . 2 1 . 2');
});

test('mostly triplets with one straight beat: triplets win, the odd note is rounded', () => {
  const r = run([[0, '1'], [1 / 3, '2'], [2 / 3, '3'], [1, '4'], [4 / 3, '5'], [5 / 3, '6'], [2, '1'], [2.5, '2']]);
  assert.equal(r.subdivision, 3);
  assert.equal(r.rounded, 1);
});

test('notes together become one chord step', () => {
  const r = run([[0, '1'], [0, '6'], [1, '3'], [1, '5'], [1, '7']]);
  assert.equal(show(r), '[1+6] [3+5+7] . .');
});

test('playing consistently late (or a laggy mic) is taken out', () => {
  const late = BEAT * 0.15; // 100 ms late every note
  const r = run([[0, '1'], [0.5, '2'], [1, '3'], [1.5, '4'], [2, '5'], [3, '6']], { wobble: 10, late });
  assert.ok(Math.abs(r.offset - 0.15) < 0.03);
  assert.equal(show(r), '1 2 3 4 5 . 6 .');
  assert.ok(Math.abs(findOffset([0.1, 1.1, 2.12, 3.08]) - 0.1) < 0.02);
  // A known feel is kept as given (edited notes mustn't change it)
  assert.equal(run([[0, '1'], [1, '2'], [2, '3']], { late }, { offset: 0.15 }).offset, 0.15);
});

test('a forced grid places everything on it', () => {
  const r = run([[0, '1'], [1 / 3, '2'], [2 / 3, '3']], {}, { grid: 4 });
  assert.equal(r.subdivision, 4);
  assert.equal(show(r).slice(0, 7), '1 2 . 3'); // 1/3 and 2/3 of a beat round to 16ths 1 and 3
  assert.equal(r.rounded, 2);
});

test('several bars: measures fill out, notes before the "1" are left out', () => {
  const r = run([[-1, '8'], [0, '1'], [4, '2'], [7, '3']]);
  assert.equal(r.dropped, 1);
  assert.equal(r.measures, 2);
  assert.equal(show(r), '1 . . . 2 . . 3');
  assert.deepEqual(r.noteSteps, [null, 0, 4, 7]); // which step each note landed on
});
