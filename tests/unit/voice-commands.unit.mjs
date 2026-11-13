// Chord listen's spoken commands (js/voice-commands.js). Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceCommand, parseNoteName, pcName } from '../../js/voice-commands.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const note = n => NAMES[n.pc] + (n.octave ?? '') + (n.qual ? `(${n.qual})` : '');
const chord = c => (c ? (c.index != null ? `#${c.index + 1}` : Object.keys(c)[0]) : '');

// One readable line per action, e.g. "remove G #2", "swap G→A", "shift D up"
function summary(text) {
  return parseVoiceCommand(text).map(a => [
    a.type,
    a.notes?.map(note).join('+'),
    a.from && `${a.from.map(note).join('+')}→${a.to.map(note).join('+')}`,
    a.qual, a.dir, a.both && 'both', chord(a.chord),
  ].filter(Boolean).join(' ')).join(' | ');
}

const cases = {
  'removing notes': {
    'remove the G': 'remove G',
    'Remove G.': 'remove G',
    'delete the G': 'remove G',
    'get rid of the G': 'remove G',
    'take out the G': 'remove G',
    'take the G out': 'remove G',
    'take the F sharp out': 'remove F#',
    "I don't want the G": 'remove G',
    'no G': 'remove G',
    'remove E': 'remove E',
    'Remove the e': 'remove E',
    'remove the E and the G': 'remove E+G',
  },
  'adding notes': {
    'add F#': 'add F#',
    'add F sharp': 'add F#',
    'Add an F sharp': 'add F#',
    'give me an F sharp': 'add F#',
    'I want a D': 'add D',
    'add a': 'add A',
    'add a G': 'add G',
    'add an a': 'add A',
    'put in a B flat': 'add A#',
    'add Bb': 'add A#',
    'add the E flat': 'add D#',
    'add D and F': 'add D+F',
    'plus E': 'add E',
    'add see': 'add C',
    'add a C3': 'add C3',
    'add D four': 'add D4',
  },
  'octaves': {
    'remove the lower octave': 'removeOctave low',
    'remove the lower D': 'remove D(low)',
    'remove the low D': 'remove D(low)',
    'remove the higher A': 'remove A(high)',
    'get rid of the A on top': 'remove A(high)',
    'remove the D, the lower one': 'remove D(low)',
    'remove D3': 'remove D3',
    'add the high D': 'add D(high)',
    'the lower one': 'resolve low',
    'higher': 'resolve high',
    'high one': 'resolve high',
    'both': 'resolve both',
    'move the D up an octave': 'shift D up',
    'move the A down': 'shift A down',
    'bump the D up': 'shift D up',
    'lower the D an octave': 'shift D down',
  },
  'whole chords': {
    'start over': 'clearAll',
    'clear': 'clearAll',
    'clear everything': 'clearAll',
    "let's start again": 'clearAll',
    'clear this chord': 'clearChord',
    'clear the notes': 'clearChord',
    'next chord': 'next',
    'next': 'next',
    'go to the next chord': 'next',
    "that's it": 'next',
    "that's the one": 'next',
    'lock it in': 'next',
    'done': 'next',
    'clear the second chord': 'deleteChord #2',
    'delete chord 2': 'deleteChord #2',
    'remove chord two': 'deleteChord #2',
    'remove chord to': 'deleteChord #2',
    'delete the last chord': 'deleteChord last',
    'replace the third chord': 'replaceChord #3',
    'redo chord 3': 'replaceChord #3',
    're-record the first chord': 'replaceChord #1',
    'do over the 2nd chord': 'replaceChord #2',
    'replace the last one': 'replaceChord last',
    'edit the second chord': 'editChord #2',
    'go back to chord one': 'editChord #1',
    'change chord 2': 'editChord #2',
  },
  'a named chord': {
    'remove the G from the second chord': 'remove G #2',
    'add F sharp to chord 3': 'add F# #3',
    'add E to the third chord': 'add E #3',
    'play the second chord': 'play #2',
    'play chord 3': 'play #3',
  },
  'swapping and setting': {
    'change the G to an A': 'swap G→A',
    'replace G with A': 'swap G→A',
    'swap the C for a D': 'swap C→D',
    'make it D F A': 'set D+F+A',
    'set it to A C E': 'set A+C+E',
  },
  'several at once': {
    'remove the G and add F sharp': 'remove G | add F#',
    'remove G add A': 'remove G | add A',
  },
  'modes and the rest': {
    'go live': 'live',
    "let's play": 'live',
    'stop': 'stop',
    'stop listening': 'micOff',
    'undo': 'undo',
    'never mind': 'undo',
    'oops': 'undo',
    'play it': 'play',
    'what can I say': 'help',
    'start recording': 'record',
    'record this': 'record',
    "let's record": 'record',
    'stop recording': 'recordStop',
    "that's a wrap": 'recordStop',
  },
  'teaching': {
    'that was a G': 'correct G',
    "that's a B flat": 'correct A#',
    "no, that's G4": 'correct G4',
    'it was an A': 'correct A',
    'that should be a C': 'correct C',
    'teach G': 'teach G',
    'teach me the B flat': 'teach A#',
    'teach': 'teach',
    "that's wrong": 'teach',
    'forget the G': 'forget G',
    'forget everything': 'forget',
  },
  'not a command': {
    'banana': '',
    'see': '',
    'what chord is this': '',
  },
};

for (const [group, phrases] of Object.entries(cases)) {
  test(group, () => {
    for (const [said, expected] of Object.entries(phrases)) {
      assert.equal(summary(said), expected, `"${said}"`);
    }
  });
}

test('a bare note is marked bare, so it can answer "which note?"', () => {
  assert.equal(parseVoiceCommand('D F A')[0].bare, true);
  assert.equal(parseVoiceCommand('add D')[0].bare, undefined);
});

test('the spoken accidental is kept, to say it back the same way', () => {
  assert.equal(parseVoiceCommand('add F sharp')[0].notes[0].acc, 1);
  assert.equal(parseVoiceCommand('add G flat')[0].notes[0].acc, -1);
});

test('pan note names, including the scales\' "s" for sharp', () => {
  assert.deepEqual(parseNoteName('Bb3'), { pc: 10, octave: 3, midi: 58 });
  assert.deepEqual(parseNoteName('Cs4'), { pc: 1, octave: 4, midi: 61 });
  assert.deepEqual(parseNoteName('F#4'), { pc: 6, octave: 4, midi: 66 });
  assert.equal(parseNoteName('nonsense'), null);
  assert.equal(pcName(10), 'A#');
  assert.equal(pcName(10, true), 'Bb');
});
