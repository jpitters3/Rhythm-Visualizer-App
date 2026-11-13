// Following a progression played in time (js/live-follower.js). Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFollowing, hearNote, stopFollowing, chordLengths, beatsPerBar } from '../../js/live-follower.js';

// D Kurd labels: Ding D3, 1 A3, 2 Bb3, 3 C4, 4 D4, 5 E4, 6 F4, 7 G4, 8 A4
const Dm = ['1', '4', '6'];
const C = ['3', '5', '7'];
const Bb = ['2', '4', '6'];
// Every triad on the pan, as followed when nothing was captured
const SCALE = {
  Dm, C, Bb,
  F: ['6', '8', '3'], Am: ['1', '3', '5'], Gm: ['7', '2', '4'], A: ['1', '8', '5'], Dm2: ['Ding', '6', '8'],
};
const named = labels => Object.entries(SCALE).find(([, l]) => l === labels)?.[0];

// Arpeggiates each chord in time; returns the follower and when each chord began
function play(candidates, progression, { bpm = 90, beatsPerChord = 4, reps = 2, extra = () => [] } = {}) {
  const f = startFollowing(candidates.map(labels => ({ labels })));
  const beat = 60000 / bpm;
  const starts = [];
  let t = 1000;
  for (let r = 0; r < reps; r++) {
    for (const chord of progression) {
      starts.push(t);
      for (let b = 0; b < beatsPerChord; b++) {
        hearNote(f, chord[b % chord.length], t);
        extra(b, t).forEach(([label, at]) => hearNote(f, label, at));
        t += beat;
      }
    }
  }
  stopFollowing(f, t);
  return { f, starts };
}

const heard = f => f.changes.map(c => named(f.candidates[c.idx].labels));

test('follows the chords it was taught, each change on its first note', () => {
  const { f, starts } = play([Dm, C, Bb], [Dm, C, Bb]);
  assert.deepEqual(heard(f), ['Dm', 'C', 'Bb', 'Dm', 'C', 'Bb']);
  assert.deepEqual(f.changes.map(c => c.at), starts);
  assert.equal(f.bpm, 90);
  assert.equal(beatsPerBar(f), 4);
  assert.deepEqual(chordLengths(f), [4, 4, 4, 4, 4, 4]);
});

test('with every chord on the scale, an arpeggio doesn\'t pass through in-between chords', () => {
  const { f } = play(Object.values(SCALE), [Dm, C, Bb]);
  assert.deepEqual(heard(f), ['Dm', 'C', 'Bb', 'Dm', 'C', 'Bb']);
});

test('three beats a chord reads as 3/4', () => {
  const { f } = play([Dm, C, Bb], [Dm, C, Bb], { bpm: 100, beatsPerChord: 3, reps: 3 });
  assert.equal(f.changes.length, 9);
  assert.equal(f.bpm, 100);
  assert.equal(beatsPerBar(f), 3);
});

test('a chord played on and on is one chord', () => {
  const { f } = play([Dm, C, Bb], [Dm], { reps: 4 });
  assert.deepEqual(heard(f), ['Dm']);
});

test('a passing note doesn\'t change the chord', () => {
  // An E4 grace note just after beat 2 of every chord
  const grace = (b, t) => (b === 1 ? [['5', t + 150]] : []);
  const { f } = play([Dm, Bb], [Dm, Bb], { extra: grace });
  assert.deepEqual(heard(f), ['Dm', 'Bb', 'Dm', 'Bb']);
});

test('stopping mid-bar doesn\'t lengthen the last chord', () => {
  const f = startFollowing([{ labels: Dm }, { labels: C }]);
  const beat = 60000 / 90;
  let t = 0;
  for (const chord of [Dm, C, Dm, C]) {
    for (let b = 0; b < 4; b++) { hearNote(f, chord[b % 3], t); t += beat; }
  }
  stopFollowing(f, t - beat + beat * 0.6); // 0.6 into the last chord's 4th beat
  assert.equal(chordLengths(f).at(-1), 3);
});
