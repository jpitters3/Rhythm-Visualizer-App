// Turns what the player says into Chord listen actions. Forgiving on purpose:
// speech-to-text spells notes many ways ("F sharp", "f#", "eff"), mishears
// numbers ("chord to"), and people phrase things loosely ("get rid of the low D").
// No DOM here, so it can be tested on its own.
//
// parseVoiceCommand(text) -> [action]
//   { type: 'add' | 'remove', notes: [note], chord? }   note: { pc, octave?, qual? }
//   { type: 'removeOctave', qual, chord? }               "remove the lower octave"
//   { type: 'set', notes, chord? }                       "make it D F A"
//   { type: 'swap', from: [note], to: [note], chord? }   "change the G to an A"
//   { type: 'shift', notes, dir: 'up' | 'down', chord? } "move the D up an octave"
//   { type: 'deleteChord' | 'replaceChord' | 'editChord', chord }
//   { type: 'clearChord', chord? }  { type: 'clearAll' }  { type: 'next' }
//   { type: 'live' }  { type: 'stop' }  { type: 'micOff' }  { type: 'undo' }
//   { type: 'play', chord? }  { type: 'resolve', qual }  { type: 'help' }
//   { type: 'correct', notes }  "that was a G": the last sound heard is that note
//   { type: 'teach', notes? }   "teach G": listen for that note being played
//   { type: 'forget', notes? }  "forget the G": drop what was taught
//   { type: 'record' } { type: 'recordStop' }  a Clip of the raw audio
// chord refs: { index } (0-based) | { last: true } | { current: true } | { previous: true }

const LETTER_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
// Spoken spellings of note letters; the risky ones only count in a note context
const SAFE_LETTERS = { c: 'c', d: 'd', dee: 'd', e: 'e', f: 'f', ef: 'f', eff: 'f', g: 'g', gee: 'g', b: 'b', bee: 'b' };
const CONTEXT_LETTERS = { a: 'a', see: 'c', sea: 'c', be: 'b', jee: 'g' };

const ORDINALS = {
  first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, forth: 4,
  fifth: 5, '5th': 5, sixth: 6, '6th': 6, seventh: 7, '7th': 7, eighth: 8, '8th': 8,
  ninth: 9, '9th': 9, tenth: 10, '10th': 10, eleventh: 11, twelfth: 12,
};
const NUMBERS = {
  one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, tree: 3, four: 4, for: 4, fore: 4,
  five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const OCTAVE_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6 };

const LOW = new Set(['low', 'lower', 'lowest', 'bottom', 'deeper', 'deepest', 'down']);
const HIGH = new Set(['high', 'higher', 'highest', 'top', 'upper', 'up']);

// Phrases folded into one keyword before tokenising (longest first)
const PHRASES = [
  [/\b(stop recording|end (the )?recording|finish (the )?recording|save (the )?recording|that'?s a wrap)\b/g, ' recordstop '],
  [/\b(start recording|start a recording|begin recording|record (this|it|me|a clip|a flow)|hit record|let'?s record)\b/g, ' recordstart '],
  [/\b(start (it )?(all )?over|start again|from scratch|clear (it )?all|clear everything|reset (it )?all|reset everything|wipe (it|everything)( out)?|scrap (it|everything)|new song|begin again)\b/g, ' startover '],
  [/\b(stop listening|mic off|turn off the mic|turn the mic off|stop the mic)\b/g, ' micoff '],
  [/\b(go live|play live|live mode|play along|let'?s play|play it in time|time mode)\b/g, ' golive '],
  [/\b(never ?mind|take that back|undo that|go back(?! to)|oops|scratch that|my bad|revert)\b/g, ' undo '],
  [/\btake (the |that |this )?(\S+( sharp| flat)?) (out|away|off)\b/g, ' remove $2 '],
  [/\b(i )?(don'?t want|do not want|don'?t need|no need for)\b/g, ' remove '],
  [/\b(i )?(want|need)\b|\bgive me\b|\bthrow in\b/g, ' add '],
  [/\blower (the|that|this) (\S+( sharp| flat)?)/g, ' shift $2 down '],
  [/\braise (the|that|this) (\S+( sharp| flat)?)/g, ' shift $2 up '],
  [/\b(an? )?octave (up|higher)\b/g, ' up '],
  [/\b(an? )?octave (down|lower)\b/g, ' down '],
  [/\b(get rid of|take (it )?out|take away|take off|knock out|leave out|cut out)\b/g, ' remove '],
  [/\b(re ?record|re ?do|do over|record again|overwrite|redo)\b/g, ' replace '],
  [/\b(next chord|next one|move on|lock it in|lock it|lock that|lock in|that'?s it|thats it|got it|keep it|save it|that'?s the one|sounds good|perfect|go to the next|on to the next)\b/g, ' next '],
  [/\b(let me hear( it)?|play (it|that|this)( back)?|what does it sound like)\b/g, ' play '],
  [/\b(what can i say|help me|help)\b/g, ' help '],
  [/\b(go to|go back to|open|switch to|jump to)\b/g, ' edit '],
  [/\b(the )?(lower|low|bottom|lowest) (octave|one|version)\b/g, ' low '],
  [/\b(the )?(higher|high|top|upper|highest) (octave|one|version)\b/g, ' high '],
  [/\bon (the )?(bottom|top)\b/g, ' $2 '],
  [/\b(that'?s|that is|that was) (not right|wrong|not it)\b/g, ' teach '],
  [/\b(no,? |wrong,? |actually,? )?(that|this|it)('s| is| was| one is| one was| note is| note was| sound is| sound was| should be| should have been| was meant to be)\b/g, ' correct '],
];

const VERBS = {
  remove: 'remove', delete: 'remove', drop: 'remove', lose: 'remove', minus: 'remove',
  without: 'remove', kill: 'remove', erase: 'remove', cut: 'remove', no: 'remove', mute: 'remove',
  add: 'add', put: 'add', include: 'add', plus: 'add', insert: 'add', also: 'add',
  replace: 'replace', swap: 'swap', switch: 'swap', change: 'change', edit: 'edit', fix: 'edit', modify: 'edit',
  make: 'set', set: 'set', move: 'shift', shift: 'shift', bump: 'shift',
  clear: 'clear', empty: 'clear', reset: 'clear',
  startover: 'startover', next: 'next', done: 'next', lock: 'next', golive: 'live', live: 'live',
  stop: 'stop', pause: 'stop', finish: 'stop', micoff: 'micoff', undo: 'undo', play: 'play', hear: 'play',
  help: 'help', recordstart: 'record', recordstop: 'recordstop',
  correct: 'correct', teach: 'teach', learn: 'teach', calibrate: 'teach', forget: 'forget', unlearn: 'forget',
};

function normalise(text) {
  let s = ` ${String(text || '').toLowerCase()} `
    .replace(/♯/g, '#').replace(/♭/g, 'b')
    .replace(/[.,!?;:"()]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1$2'); // keep "2nd" whole
  for (const [re, rep] of PHRASES) s = s.replace(re, rep);
  // "f #" / "f sharp" / "b flat" glue onto the letter where speech split them
  s = s.replace(/\b([a-g]) ?(#|sharp)\b/g, '$1#').replace(/\b([a-g]) ?flat\b/g, '$1b');
  return s.split(/\s+/).filter(Boolean);
}

// A token as a note, or null. ctx: the token before it allows risky spellings.
function noteToken(tokens, i, inNoteContext) {
  const t = tokens[i];
  const m = /^([a-g])(#|b|s)?(\d)?$/.exec(t);
  let letter = null;
  let acc = 0;
  let octave = null;
  let used = 1;
  if (m) {
    // Lone "a" is usually the article: "add a G", "a note"
    if (t === 'a' && !isNoteAfterArticle(tokens, i, inNoteContext)) return null;
    letter = m[1];
    acc = m[2] === '#' || m[2] === 's' ? 1 : m[2] === 'b' ? -1 : 0;
    if (m[3]) octave = Number(m[3]);
  } else if (SAFE_LETTERS[t]) {
    letter = SAFE_LETTERS[t];
  } else if (CONTEXT_LETTERS[t] && inNoteContext) {
    letter = CONTEXT_LETTERS[t];
  } else {
    return null;
  }
  const next = tokens[i + 1];
  if (!acc && (next === 'sharp' || next === '#')) { acc = 1; used++; }
  else if (!acc && next === 'flat') { acc = -1; used++; }
  const after = tokens[i + used];
  if (octave == null && /^\d$/.test(after || '') && Number(after) >= 1 && Number(after) <= 6) { octave = Number(after); used++; }
  else if (octave == null && OCTAVE_WORDS[after] && tokens[i + used + 1] !== 'chord') { octave = OCTAVE_WORDS[after]; used++; }
  return { note: { pc: (LETTER_PC[letter] + acc + 12) % 12, octave, acc }, used };
}

const noteLike = t => !!t && (/^[a-g](#|b|s)?\d?$/.test(t) || !!SAFE_LETTERS[t]);

function isNoteAfterArticle(tokens, i, inNoteContext) {
  const next = tokens[i + 1];
  if (next == null) return true; // "add a" at the end: the note A
  if (tokens[i - 1] === 'the') return true; // "the A"
  // A list of notes: "A C E"
  if (noteLike(next) && noteLike(tokens[i + 2])) return true;
  if (next === '#' || next === 'sharp' || next === 'flat' || /^\d$/.test(next)) return true;
  if (['and', 'too', 'also', 'from', 'to', 'in', 'on', 'with', 'for', 'instead', 'please'].includes(next)) return true;
  // "a G", "a note", "a chord", "a lower D": an article
  return inNoteContext && !/^[a-g](#|b)?\d?$/.test(next) && !SAFE_LETTERS[next] && !LOW.has(next) && !HIGH.has(next)
    && !['note', 'chord', 'new', 'different', 'another'].includes(next);
}

// "the second chord", "chord two", "chord number 3", "the last chord", "this chord"
function chordRefAt(tokens, i) {
  if (tokens[i] !== 'chord' && tokens[i] !== 'chords') return null;
  const prev = tokens[i - 1];
  const prev2 = tokens[i - 2];
  const next = tokens[i + 1] === 'number' ? tokens[i + 2] : tokens[i + 1];
  if (ORDINALS[prev]) return { index: ORDINALS[prev] - 1 };
  if (prev === 'last' || prev === 'final') return prev2 === 'the' || prev2 !== 'second' ? { last: true } : null;
  if (prev === 'previous' || (prev === 'one' && prev2 === 'last')) return { previous: true };
  if (['this', 'current', 'that', 'the', 'my'].includes(prev) && !(next && (/^\d+$/.test(next) || NUMBERS[next]))) return { current: true };
  if (next && /^\d+$/.test(next)) return { index: Number(next) - 1 };
  if (next && NUMBERS[next]) return { index: NUMBERS[next] - 1 };
  return { current: true };
}

// "the second one" / "number three" when a chord verb leaves out "chord"
function looseChordRef(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (ORDINALS[tokens[i]] && (tokens[i + 1] === 'one' || i === tokens.length - 1)) return { index: ORDINALS[tokens[i]] - 1 };
    if (tokens[i] === 'number' && tokens[i + 1]) {
      const n = /^\d+$/.test(tokens[i + 1]) ? Number(tokens[i + 1]) : NUMBERS[tokens[i + 1]];
      if (n) return { index: n - 1 };
    }
    if (tokens[i] === 'last' && (tokens[i + 1] === 'one' || i === tokens.length - 1)) return { last: true };
  }
  return null;
}

function qualOf(token) {
  if (LOW.has(token)) return 'low';
  if (HIGH.has(token)) return 'high';
  return null;
}

// Notes, chord ref and octave words in one clause
function readClause(tokens, verb) {
  const notes = [];
  const connectorAt = [];
  let chord = null;
  let qual = null;
  let pendingQual = null;
  const noteVerb = ['add', 'remove', 'set', 'swap', 'change', 'replace', 'correct', 'teach', 'forget'].includes(verb);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const ref = chordRefAt(tokens, i);
    if (ref) { chord = ref; continue; }
    const q = qualOf(t);
    if (q) { pendingQual = q; qual = q; continue; }
    if (['with', 'to', 'for', 'into', 'instead'].includes(t) && notes.length) connectorAt.push(notes.length);
    const prev = tokens[i - 1];
    const ctx = noteVerb || notes.length > 0 || ['the', 'an', 'and', 'with', 'to', 'for', 'low', 'high'].includes(prev) || qualOf(prev);
    // "for"/"to" right after "chord" was a number, handled by chordRefAt
    if ((t === 'to' || t === 'for') && tokens[i - 1] === 'chord') continue;
    const hit = noteToken(tokens, i, ctx);
    if (hit) {
      // Skip a letter that's really part of a chord name heard as "chord" context, e.g. "the a chord"
      notes.push({ ...hit.note, qual: pendingQual || undefined });
      pendingQual = null;
      i += hit.used - 1;
    }
  }
  // An octave word after the note ("the D on the bottom", "D, the lower one")
  if (notes.length === 1 && !notes[0].qual && qual) notes[0].qual = qual;
  if (!chord) {
    const loose = ['replace', 'edit', 'clear', 'remove', 'play', 'change'].includes(verb) && !notes.length ? looseChordRef(tokens) : null;
    if (loose) chord = loose;
  }
  return { notes, chord, qual, connectorAt };
}

function clauseToActions(verb, tokens) {
  const { notes, chord, qual, connectorAt } = readClause(tokens, verb);
  const target = chord && !chord.current ? { chord } : {};
  switch (verb) {
    case 'add':
      return notes.length ? [{ type: 'add', notes, ...target }] : [];
    case 'remove':
      if (notes.length) return [{ type: 'remove', notes, ...target }];
      if (qual) return [{ type: 'removeOctave', qual, ...target }];
      if (tokens.includes('both')) return [{ type: 'resolve', both: true }];
      if (chord && !chord.current) return [{ type: 'deleteChord', chord }];
      if (chord?.current) return [{ type: 'clearChord' }];
      return [];
    case 'clear':
      if (notes.length) return [{ type: 'remove', notes, ...target }];
      if (chord && !chord.current) return [{ type: 'deleteChord', chord }];
      if (chord?.current || tokens.some(t => ['notes', 'this', 'it'].includes(t))) return [{ type: 'clearChord' }];
      return [{ type: 'clearAll' }];
    case 'replace':
    case 'swap':
    case 'change': {
      if (notes.length >= 2) {
        const cut = connectorAt[0] ?? 1;
        return [{ type: 'swap', from: notes.slice(0, cut), to: notes.slice(cut), ...target }];
      }
      if (chord && !chord.current) return [{ type: verb === 'change' ? 'editChord' : 'replaceChord', chord }];
      if (notes.length === 1 && verb !== 'change') return [{ type: 'set', notes, ...target }];
      if (chord?.current) return [{ type: verb === 'change' ? 'clearChord' : 'clearChord' }];
      return [];
    }
    case 'edit':
      if (chord && !chord.current) return [{ type: 'editChord', chord }];
      if (tokens.includes('next') || tokens.includes('new')) return [{ type: 'next' }];
      return notes.length ? [{ type: 'set', notes, ...target }] : [];
    case 'set':
      return notes.length ? [{ type: 'set', notes, ...target }] : [];
    case 'shift': {
      const dir = tokens.some(t => t === 'up' || t === 'higher' || t === 'high') ? 'up'
        : tokens.some(t => t === 'down' || t === 'lower' || t === 'low') ? 'down' : null;
      return notes.length && dir ? [{ type: 'shift', notes: notes.map(n => ({ ...n, qual: undefined })), dir, ...target }] : [];
    }
    case 'startover': return [{ type: 'clearAll' }];
    case 'next': return [{ type: 'next' }];
    case 'live': return [{ type: 'live' }];
    case 'stop': return tokens.includes('listening') || tokens.includes('mic') ? [{ type: 'micOff' }] : [{ type: 'stop' }];
    case 'micoff': return [{ type: 'micOff' }];
    case 'undo': return [{ type: 'undo' }];
    case 'play': return [{ type: 'play', ...(chord && !chord.current ? { chord } : {}) }];
    case 'help': return [{ type: 'help' }];
    case 'correct': return notes.length ? [{ type: 'correct', notes }] : [];
    case 'teach': return [{ type: 'teach', notes }];
    case 'forget': return [{ type: 'forget', notes }];
    case 'record': return [{ type: 'record' }];
    case 'recordstop': return [{ type: 'recordStop' }];
    default: return [];
  }
}

export function parseVoiceCommand(text) {
  const tokens = normalise(text);
  if (!tokens.length) return [];

  // Split into clauses at each verb: "remove the G and add F sharp"
  const clauses = [];
  let cur = { verb: null, tokens: [] };
  tokens.forEach((t, i) => {
    let verb = VERBS[t];
    // "no" only means remove before a note ("no G"), "live" only on its own-ish
    if (t === 'no' && !/^[a-g]/.test(tokens[i + 1] || '')) verb = null;
    if (t === 'play' && tokens[i + 1] === 'golive') verb = null;
    // "change it to"/"replace it with": the verb carries on, it's not a new clause
    if (verb && cur.verb && ['with', 'to', 'for'].includes(tokens[i - 1])) verb = null;
    if (verb) {
      if (cur.verb || cur.tokens.length) clauses.push(cur);
      cur = { verb, tokens: [] };
    } else {
      cur.tokens.push(t);
    }
  });
  clauses.push(cur);

  const actions = [];
  let lastVerb = null;
  for (const clause of clauses) {
    if (clause.verb) {
      lastVerb = clause.verb;
      actions.push(...clauseToActions(clause.verb, clause.tokens));
      continue;
    }
    // No verb: a bare follow-up ("the lower one", "high"), or bare notes ("D F A")
    const { notes, qual } = readClause(clause.tokens, null);
    if (notes.length && !lastVerb) actions.push({ type: 'add', notes, bare: true });
    else if (qual && !notes.length) actions.push({ type: 'resolve', qual });
    else if (clause.tokens.includes('both') || clause.tokens.includes('all')) actions.push({ type: 'resolve', both: true });
  }
  return actions;
}

// Pitch class and octave of a pan note name ("Bb3", "Cs4", "F#4")
export function parseNoteName(name) {
  const m = /^([A-Ga-g])(#|s|b)?(-?\d)$/.exec(name || '');
  if (!m) return null;
  const acc = m[2] === '#' || m[2] === 's' ? 1 : m[2] === 'b' ? -1 : 0;
  const pc = (LETTER_PC[m[1].toLowerCase()] + acc + 12) % 12;
  const octave = Number(m[3]);
  // B#3 is C4, Cb4 is B3: midi from the letter's own octave
  const midi = (octave + 1) * 12 + LETTER_PC[m[1].toLowerCase()] + acc;
  return { pc, octave, midi };
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// How to say a pitch class back to the player, matching the pan's own spelling
export function pcName(pc, preferFlats = false) {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[pc];
}
