// Rhythm by Ear rules (js/rhythm-ear-levels.js). Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, NAMED_RHYTHMS, beatsFor, generatePhrase, fittingRhythms,
  levelNumber, roundScore, verdict, ROUND_MAX, rhythmKey, distinctRhythmCount,
  LIBRARY_SETS, libraryRhythms, libraryPhrase,
} from '../../js/rhythm-ear-levels.js';

const SAMPLES = 400;
const isAccent = (l) => l === 'T' || l === 'S';

CATEGORIES.forEach(cat => {
  cat.levels.forEach((level, idx) => {
    test(`${cat.name} level ${idx + 1} phrases follow its rules`, () => {
      const beats = beatsFor(cat);
      let sawEven = false;
      let sawDingInMix = false;
      for (let s = 0; s < SAMPLES; s++) {
        const { labels } = generatePhrase(cat, level);
        assert.equal(labels.length, beats);
        assert.equal(labels[0], 'Ding');
        assert.ok(labels.every(l => ['', 'Ding', 'T', 'S'].includes(l)));

        const notes = labels.map((l, i) => (l && i > 0 ? i + 1 : null)).filter(Boolean);
        assert.equal(notes.length, level.notes, `notes: ${labels}`);
        if (level.where === 'odd') assert.ok(notes.every(b => b % 2 === 1), `odd only: ${labels}`);
        if (notes.some(b => b % 2 === 0)) sawEven = true;

        const accents = labels.filter(isAccent).length;
        if (level.sounds === 'dings') assert.equal(accents, 0, `Dings only: ${labels}`);
        else assert.ok(accents > 0, `mix has a Tak or Slap: ${labels}`);
        if (level.sounds === 'mix' && accents < level.notes) sawDingInMix = true;
      }
      if (level.where === 'any') assert.ok(sawEven, 'even beats can appear');
      if (level.sounds === 'mix' && level.notes > 1) assert.ok(sawDingInMix, 'mix levels can add Dings');
    });
  });
});

test('named rhythms come first, each once per level', () => {
  const cat = CATEGORIES[0];
  const level = cat.levels[3]; // 2 notes, any beat: Tresillo fits
  assert.deepEqual(fittingRhythms(cat, level).map(r => r.name), ['Tresillo']);
  const first = generatePhrase(cat, level);
  assert.equal(first.name, 'Tresillo');
  assert.deepEqual(first.labels.map((l, i) => (l ? i + 1 : null)).filter(Boolean), [1, 4, 7]);
  assert.equal(generatePhrase(cat, level, { usedNames: new Set(['Tresillo']) }).name, null);
});

// Plays every level's rounds many times, like the game does.
const ROUNDS = 3;
CATEGORIES.forEach(cat => {
  cat.levels.forEach((level, idx) => {
    test(`${cat.name} level ${idx + 1}: no rhythm repeats and random never copies a named one`, () => {
      const rounds = distinctRhythmCount(cat, level, ROUNDS);
      const namedTimings = new Set(fittingRhythms(cat, level).map(r => r.onsets.join()));
      for (let run = 0; run < 60; run++) {
        const usedKeys = new Set();
        const usedNames = new Set();
        for (let r = 0; r < rounds; r++) {
          const p = generatePhrase(cat, level, { usedKeys, usedNames });
          assert.ok(p, `round ${r + 1} of ${rounds} had a rhythm`);
          const key = rhythmKey(p.labels);
          assert.ok(!usedKeys.has(key), `repeat ${key}`);
          if (p.name) {
            assert.ok(!usedNames.has(p.name), `named repeat ${p.name}`);
            usedNames.add(p.name);
          } else {
            const timing = p.labels.map((l, i) => (l ? i + 1 : null)).filter(Boolean).join();
            assert.ok(!namedTimings.has(timing), `random copied a named rhythm: ${timing}`);
          }
          usedKeys.add(key);
        }
      }
    });
  });
});

test('every level has enough distinct rhythms for 3 rounds', () => {
  CATEGORIES.forEach(cat => cat.levels.forEach((level, i) => {
    assert.equal(distinctRhythmCount(cat, level, 3), 3, `${cat.name} level ${i + 1}`);
  }));
  assert.equal(distinctRhythmCount(CATEGORIES[0], CATEGORIES[0].levels[0]), 3); // Ding on 3, 5 or 7
});

test('level numbers run on across categories', () => {
  assert.equal(levelNumber(0, 0), 1);
  assert.equal(levelNumber(0, 9), 10);
  assert.equal(levelNumber(1, 0), 11);
  assert.equal(CATEGORIES.reduce((n, c) => n + c.levels.length, 0), 17);
});

test('Tak and Slap alone do not make a new rhythm', () => {
  assert.equal(rhythmKey(['Ding', '', 'T', '']), rhythmKey(['Ding', '', 'S', '']));
  assert.notEqual(rhythmKey(['Ding', '', 'T', '']), rhythmKey(['Ding', '', 'Ding', '']));
});

test('the claves fill the Two Measures levels with five notes', () => {
  const cat = CATEGORIES[1];
  const names = fittingRhythms(cat, cat.levels[1]).map(r => r.name);
  assert.ok(names.includes('Son clave'));
  assert.ok(names.includes('Bossa nova'));
  assert.ok(fittingRhythms(cat, cat.levels[3]).some(r => r.name === 'Tresillo ×2'));
});

test('named rhythm data is well formed', () => {
  NAMED_RHYTHMS.forEach(r => {
    assert.equal(r.onsets[0], 1, r.name);
    assert.ok(r.onsets.every((b, i) => b <= r.steps && (i === 0 || b > r.onsets[i - 1])), r.name);
    assert.ok(r.about.length > 0);
    assert.equal(r.voicing.length, r.onsets.length, r.name);
    assert.equal(r.voicing[0], 'Ding', r.name);
  });
});

test('the library sets hold every named rhythm exactly once', () => {
  const names = LIBRARY_SETS.flatMap(set => libraryRhythms(set).map(r => r.name));
  assert.equal(names.length, NAMED_RHYTHMS.length);
  assert.equal(new Set(names).size, names.length);
});

test('library phrases place the fixed voicing on the rhythm\'s beats', () => {
  const tresillo = NAMED_RHYTHMS.find(r => r.name === 'Tresillo');
  assert.deepEqual(libraryPhrase(tresillo).labels, ['Ding', '', '', 'T', '', '', 'T', '']);
  const son = libraryPhrase(NAMED_RHYTHMS.find(r => r.name === 'Son clave'));
  assert.equal(son.labels.length, 16);
  assert.equal(son.labels[10], 'Ding');
});

test('first try within 15s is a perfect round', () => {
  assert.equal(roundScore(1, 0), ROUND_MAX);
  assert.equal(roundScore(1, 15), ROUND_MAX);
});

test('more tries and more time both lower the score', () => {
  assert.ok(roundScore(2, 10) < roundScore(1, 10));
  assert.ok(roundScore(5, 10) < roundScore(3, 10));
  assert.equal(roundScore(1, 45), 80);
});

test('score bottoms out but a correct answer always earns something', () => {
  assert.equal(roundScore(9, 600), 10);
  assert.equal(roundScore(9, 600, { hint: true }), 5);
});

test('using the hint costs 20 points', () => {
  assert.equal(roundScore(1, 0, { hint: true }), ROUND_MAX - 20);
  assert.equal(roundScore(2, 45, { hint: true }), roundScore(2, 45) - 20);
});

test('verdicts: only a perfect total is a perfect ear', () => {
  assert.equal(verdict(400, 400), 'Perfect ear! 🎉');
  assert.equal(verdict(399, 400), 'Great ear!');
  assert.equal(verdict(320, 400), 'Great ear!');
  assert.equal(verdict(240, 400), 'Good ear!');
  assert.equal(verdict(239, 400), 'Room for improvement.');
});
