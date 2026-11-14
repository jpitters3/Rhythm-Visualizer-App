// @ts-check
// Chord listen (#listen, js/chord-listen.js): synthetic recordings play through
// Chromium's fake mic (tests/utils/synth-audio.js), and a stand-in speech
// recogniser takes the place of the browser's for voice commands.
const base = require('./fixtures');
const { recording, fakeMic } = require('./utils/synth-audio');
const { createTestUser, deleteTestUser, loginAsTestUser, supabaseAdmin } = require('./utils/auth-helper');

// A browser plays its fake-mic file once, and launch options can't change per
// group, so `listen` is a page in a browser of its own, with that group's
// recording as the mic. Device emulation (Mobile Chrome) carries over.
const test = base.test.extend({
  micFile: [null, { option: true }],
  listen: async ({ playwright, micFile, baseURL, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor }, use) => {
    const browser = await playwright.chromium.launch(fakeMic(micFile));
    const context = await browser.newContext({
      baseURL, viewport, isMobile, hasTouch, userAgent, deviceScaleFactor, ignoreHTTPSErrors: true, permissions: ['microphone'],
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.stack || err.message));
    await installSpeechStandIn(page);
    await skipTours(page);
    await use(page);
    await browser.close();
    expect(errors, 'errors the page threw').toEqual([]);
  },
});
const { expect } = base;

test.skip(({ browserName }) => browserName !== 'chromium', 'Fake mic recordings are Chromium-only');
test.describe.configure({ timeout: 120_000 });

let copies = 0;
function withRecording(name, options = {}) {
  test.use({ micFile: recording(name, { ...options, copy: ++copies }) });
}

// The first-visit tours would cover the page
async function skipTours(page) {
  await page.addInitScript(() => {
    ['dashboard', 'studio', 'library', 'composer', 'practice', 'courses', 'community']
      .forEach(k => localStorage.setItem(`panafide_tour_${k}`, '1'));
  });
}

// Stands in for SpeechRecognition: say(text) delivers a final result, and
// soundStart() fires speechstart the way Chrome does for any sound
async function installSpeechStandIn(page) {
  await page.addInitScript(() => {
    class FakeRecognition {
      constructor() { FakeRecognition.last = this; }
      start() {}
      stop() { this.onend?.(); }
      static say(text) {
        const result = Object.assign([{ transcript: text }], { isFinal: true });
        FakeRecognition.last?.onresult?.({ resultIndex: 0, results: [result] });
      }
      static soundStart() { FakeRecognition.last?.onspeechstart?.(); }
    }
    window.SpeechRecognition = FakeRecognition;
    window.webkitSpeechRecognition = FakeRecognition;
  });
}

async function openListen(page) {
  // networkidle: the saved scale has arrived (it redraws the pan)
  await page.goto('/#listen', { waitUntil: 'networkidle' });
  await expect(page.locator('.cl-mic')).toBeVisible({ timeout: 15000 });
}

async function startListening(page) {
  await page.locator('.cl-mic').click();
  await expect(page.locator('.cl-view')).toHaveAttribute('data-mode', 'capture');
}

const say = (page, text) => page.evaluate(t => window.SpeechRecognition.say(t), text);
const reply = page => page.locator('.cl-voice-reply');
const captured = page => page.locator('.cl-captured .cl-card-name');
const progression = page => page.locator('.cl-progression .cl-card-name');
const notesLine = page => page.locator('.cl-notes');
const panNote = (page, label) => page.locator(`.cl-big .note-dot[data-note="${label}"]`);

test.describe('capture, then live', () => {
  withRecording('session');

  test('claps lock chords, a double clap goes live and finds 4/4 at 90', async ({ listen: page }) => {
    await openListen(page);
    await startListening(page);
    await expect(captured(page)).toHaveText(['Dm', 'C', 'Bb'], { timeout: 20000 });
    await expect(page.locator('.cl-view')).toHaveAttribute('data-mode', 'live', { timeout: 10000 });
    await expect(progression(page)).toHaveText(['Dm', 'C', 'Bb', 'Dm', 'C', 'Bb'], { timeout: 30000 });
    await expect(page.locator('.cl-meter')).toHaveText('4/4');
    const bpm = Number(await page.locator('.cl-bpm').textContent());
    expect(Math.abs(bpm - 90)).toBeLessThanOrEqual(3);
  });
});

test.describe('waltz time', () => {
  withRecording('session', { bpm: 100, beatsPerChord: 3, reps: 3, capture: 0 });

  test('chords three beats long read as 3/4', async ({ listen: page }) => {
    await openListen(page);
    await startListening(page);
    await page.locator('.cl-live').click();
    await expect(progression(page)).toHaveText(['Dm', 'C', 'Bb', 'Dm', 'C', 'Bb', 'Dm', 'C', 'Bb'], { timeout: 30000 });
    await expect(page.locator('.cl-meter')).toHaveText('3/4', { timeout: 30000 });
    const bpm = Number(await page.locator('.cl-bpm').textContent());
    expect(Math.abs(bpm - 100)).toBeLessThanOrEqual(3);
  });
});

test.describe('notes are not lost to sound that Chrome calls speech', () => {
  withRecording('session');

  // Chrome fires speechstart for any sound; only recognised words mean talking
  test('speechstart on every note still captures the chords', async ({ listen: page }) => {
    await openListen(page);
    await startListening(page);
    await page.evaluate(() => setInterval(() => window.SpeechRecognition.soundStart(), 1000));
    await expect(captured(page)).toHaveText(['Dm', 'C', 'Bb'], { timeout: 20000 });
  });
});

test.describe('one note per strike', () => {
  withRecording('bloom');

  test('an octave swelling in after the strike is not a second note', async ({ listen: page }) => {
    await openListen(page);
    await startListening(page);
    await expect(notesLine(page)).toHaveText('D · A · F', { timeout: 15000 });
    await page.waitForTimeout(2000);
    await expect(notesLine(page)).toHaveText('D · A · F');
  });
});

test.describe('Multi-note (beta)', () => {
  withRecording('bloom');

  test('counts the octaves too', async ({ listen: page }) => {
    await page.addInitScript(() => localStorage.setItem('gp_listenMultiNote', '1'));
    await openListen(page);
    await expect(page.locator('.cl-multi-btn')).toHaveAttribute('aria-pressed', 'true');
    await startListening(page);
    await expect(notesLine(page)).toContainText('D4', { timeout: 15000 });
    await expect(notesLine(page)).toContainText('A4');
  });
});

test.describe('teaching a misheard note', () => {
  withRecording('session');

  test('"that was a B flat" relabels the sound just heard and remembers it', async ({ listen: page }) => {
    await openListen(page);
    await startListening(page);
    // Said the moment A3 alone has been heard (D follows 0.7 s later)
    await page.evaluate(() => new Promise((resolve) => {
      const check = () => {
        if (document.querySelector('.cl-notes').textContent === 'A') {
          window.SpeechRecognition.say('that was a B flat');
          resolve();
        } else requestAnimationFrame(check);
      };
      check();
    }));
    await expect(reply(page)).toContainText('Learned: that sound is Bb3 (I heard A3)');
    await expect(notesLine(page)).toContainText('Bb');
    const taught = await page.evaluate(() => Object.keys(localStorage)
      .filter(k => k.startsWith('gp_pitch_cal_'))
      .flatMap(k => JSON.parse(localStorage.getItem(k)).taughtSounds || []));
    expect(taught).toEqual([expect.objectContaining({ label: '2' })]);
  });
});

test.describe('Teach a note', () => {
  withRecording('threeStrikes');

  test('three strikes of the tapped note teach it', async ({ listen: page }) => {
    await openListen(page);
    await startListening(page);
    await page.locator('.cl-teach-btn').click();
    await expect(page.locator('.cl-teach-text')).toHaveText('Tap the note you want to teach');
    await panNote(page, '5').click({ force: true });
    await expect(reply(page)).toHaveText("Learned E4. I'll recognise it on this scale from now on.", { timeout: 15000 });
  });
});

test.describe('voice, taps and editing', () => {
  withRecording('silence');

  test('voice commands build and fix chords', async ({ listen: page }) => {
    await openListen(page);
    await startListening(page);
    const steps = [
      ['add D F A', 'Added D3, A3 and F4.'],
      ['next chord', 'Locked Dm as chord 1.'],
      ['add C E G', 'Added C4, E4 and G4.'],
      ["that's it", 'Locked C as chord 2.'],
      ['make it B flat D F', 'Set to Bb3, D4 and F4.'],
      ['add the high D', 'D4 is already in.'],
      ['add the low D', 'Added D3.'],
      ['remove the D', 'There are two Ds. The low one or the high one?'],
      ['the lower one', 'Removed D3.'],
      ['next', 'Locked Bb as chord 3.'],
      ['remove the G from the second chord', 'Removed G4 from chord 2.'],
      ['add G to chord 2', 'Added G4 to chord 2.'],
      ['replace the second chord', 'Play the new chord 2, then say “next” or clap.'],
      ['add A C E', 'Added A3, C4 and E4.'],
      ['next', 'Chord 2 is now Am.'],
      ['add F sharp', "There's no F# on your D Kurd."],
      ['clear the third chord', 'Removed chord 3 (Bb).'],
      // Nothing being played: a fix goes to the last chord
      ['move the A up an octave', 'Moved A3 → A4 in chord 2.'],
      ['undo', 'Undone.'],
      ['start over', 'Started over. Say “undo” to bring it all back.'],
      ['undo', 'Undone.'],
      ['banana', 'Didn’t catch a command. Say “help” for ideas.'],
    ];
    for (const [said, answer] of steps) {
      await say(page, said);
      await expect(reply(page), `after "${said}"`).toHaveText(answer);
    }
    await expect(captured(page)).toHaveText(['Dm', 'Am']);
  });

  test('tapping a note toggles it; ✎ opens a chord; Undo works', async ({ listen: page }) => {
    await openListen(page);
    await panNote(page, '3').click({ force: true });
    await expect(reply(page)).toHaveText('Added C4.');
    await panNote(page, '5').click({ force: true });
    await panNote(page, '7').click({ force: true });
    await expect(page.locator('.cl-name')).toHaveText('C');
    await page.locator('.cl-big .note-label[data-note="7"]').click({ force: true }); // the name works too
    await expect(reply(page)).toHaveText('Removed G4.');
    await page.locator('.cl-undo').click();
    await expect(page.locator('.cl-name')).toHaveText('C');
    await page.locator('.cl-lock').click();
    await expect(captured(page)).toHaveText(['C']);

    await page.locator('.cl-card-edit').first().click();
    await expect(page.locator('.cl-card.is-editing')).toHaveCount(1);
    await expect(page.locator('.cl-slot')).toContainText('Chord 1');
    await panNote(page, '7').click({ force: true });
    await page.locator('.cl-lock').click();
    await expect(captured(page)).toHaveText(['C E']);
  });

  test('Back leaves the page without an error', async ({ listen: page }) => {
    await page.goto('/#studio');
    await openListen(page);
    await page.locator('.cl-back').click();
    await expect(page).not.toHaveURL(/#listen/);
  });
});

test.describe('the selected scale', () => {
  withRecording('silence');

  test('a reload keeps the saved scale, and the page can switch it', async ({ listen: page }) => {
    await page.addInitScript(() => { if (!localStorage.getItem('gp_scale')) localStorage.setItem('gp_scale', 'D Major'); });
    await openListen(page);
    const names = page.locator('.cl-big .note-label');
    await expect(names).toContainText(['C#4']);
    await page.reload();
    await expect(names).toContainText(['C#4'], { timeout: 15000 });
    await page.locator('.cl-scale-select').selectOption('D Kurd');
    await expect(names).toContainText(['Bb3']);
    await expect(page.locator('#scaleSelect')).toHaveValue('D Kurd');
  });

  // No built-in scale has bottom notes, so the test stands in a layout with three
  // (as a custom handpan's would report) through the page's own modules
  test('bottom notes are named pucks outside the pan', async ({ listen: page }) => {
    await openListen(page);
    await page.evaluate(async () => {
      const url = name => performance.getEntriesByType('resource').map(e => e.name).find(u => u.includes(`/js/${name}.js`));
      const diagram = await import(url('chord-shape-diagram'));
      const state = await import(url('state'));
      diagram.setChordShapeLayout({
        Ding: { x: 48, y: 46 }, 1: { x: 59, y: 76 }, 2: { x: 34, y: 75 }, 3: { x: 78, y: 59 }, 4: { x: 18, y: 56 },
        5: { x: 77, y: 35 }, 6: { x: 21, y: 33 }, 7: { x: 60, y: 19 }, 8: { x: 38, y: 19 },
        9: { x: 20, y: 80, r: 9, side: 'bottom' }, 10: { x: 80, y: 80, r: 9, side: 'bottom' },
      });
      state.setCurrentScale({ ding: 'D3', map: { 1: 'A3', 2: 'Bb3', 3: 'C4', 4: 'D4', 5: 'E4', 6: 'F4', 7: 'G4', 8: 'A4', 9: 'C3', 10: 'E3' } });
    });
    await expect(page.locator('.cl-big .note-puck')).toHaveCount(2);
    await expect(page.locator('.cl-big .note-label-arc')).toHaveText(['C3', 'E3']);
    // Outside the pan's outline (radius 48 around the centre)
    const radius = await page.locator('.cl-big .note-label-arc').first().evaluate(el => Math.hypot(Number(el.getAttribute('x')) - 50, Number(el.getAttribute('y')) - 50));
    expect(radius).toBeGreaterThan(48);
    // A click at the middle of an arc's box misses the arc itself
    await page.locator('.cl-big .note-puck[data-note="9"]').dispatchEvent('click');
    await expect(page.locator('.cl-big .note-puck[data-note="9"]')).toHaveClass(/active/);
  });
});

test.describe('Transcribe', () => {
  withRecording('melody', { bpm: 80, startMs: 2000 });

  test('a count-in, then quarter notes, triplets and a chord onto a Studio phrase', async ({ listen: page }) => {
    // When the mic opens, the fake mic's recording starts: note it
    await page.addInitScript(() => {
      const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => {
        const stream = await open(c);
        window.micOpenedAt ??= performance.now();
        return stream;
      };
    });
    await openListen(page);
    await startListening(page); // opens the mic: the recording starts now
    await page.locator('[data-m="transcribe"]').click();
    await expect(page.locator('.cl-view')).toHaveAttribute('data-tab', 'transcribe');
    await expect(page.locator('.cl-multi-btn')).toHaveAttribute('aria-pressed', 'true'); // on by default here
    await page.locator('.cl-tx-bpm-input').fill('80');
    await page.locator('.cl-tx-bpm-input').dispatchEvent('change');
    await page.locator('.cl-tx-metro').check(); // the click carries on while playing
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gp_listenTranscribe')).metro)).toBe(true);
    // Start exactly 2 s into the recording, where its count-in silence begins
    await page.evaluate(() => new Promise((resolve) => {
      setTimeout(() => {
        document.querySelector('.cl-tx-go').click();
        resolve();
      }, Math.max(0, 2000 - (performance.now() - window.micOpenedAt)));
    }));
    await expect(page.locator('.cl-slot')).toHaveText('Count-in');
    await expect(page.locator('.cl-slot')).toHaveText(/Bar 2/, { timeout: 15000 });
    await page.waitForTimeout(5000); // to the end of bar 2
    await page.locator('.cl-tx-go').click();

    await expect(page.locator('.cl-tx-summary')).toContainText('2 bars in triplets');
    const bar = n => page.locator('.cl-tx-bar').nth(n).locator('.cl-tx-cell');
    await expect(bar(0)).toHaveText(['D3', '', '', 'A3', '', '', 'C4', '', '', 'D4', '', '']);
    await expect(bar(1).nth(0)).toHaveText('C4');
    await expect(bar(1).nth(1)).toHaveText('E4');
    await expect(bar(1).nth(2)).toHaveText('G4');
    await expect(bar(1).nth(3)).toHaveText('A4');
    await expect(bar(1).nth(9)).toHaveText('D4');
    // The chord: both notes, found in the spectrum (not a pitch in between)
    await expect(bar(1).nth(6)).toContainText('F4');
    await expect(bar(1).nth(6)).toContainText('A4');

    // Every note moved one step later, then back
    const shiftText = page.locator('.cl-tx-shift-text');
    await expect(shiftText).toHaveText('Move all notes');
    await page.locator('[data-shift="1"]').click();
    await expect(shiftText).toHaveText('⅓ beat later');
    await expect(bar(0).nth(1)).toHaveText('D3');
    await page.locator('[data-shift="-1"]').click();
    await expect(shiftText).toHaveText('Move all notes');
    await expect(bar(0).nth(0)).toHaveText('D3');

    // Dragging a note to another cell, then back
    const dragCell = async (from, to) => {
      const a = await from.boundingBox();
      const b = await to.boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
      await page.mouse.up();
    };
    await dragCell(bar(0).nth(0), bar(0).nth(2));
    await expect(bar(0).nth(2)).toHaveText('D3');
    await expect(bar(0).nth(0)).toHaveText('');
    await dragCell(bar(0).nth(2), bar(0).nth(0));
    const bar0 = ['D3', '', '', 'A3', '', '', 'C4', '', '', 'D4', '', ''];
    await expect(bar(0)).toHaveText(bar0);

    // Selecting: a click, then Shift-click for a range
    const selText = page.locator('.cl-tx-sel');
    await expect(selText).toHaveText('1 cell · 1 note'); // a moved note stays selected
    await bar(0).nth(0).click(); // again: none
    await expect(selText).toHaveText('Tap a note to select it');
    await bar(0).nth(0).click();
    await expect(selText).toHaveText('1 cell · 1 note');
    await bar(0).nth(6).click({ modifiers: ['Shift'] });
    await expect(selText).toHaveText('7 cells · 3 notes');
    // Copy, paste at the last cell (the phrase grows a bar), delete it again
    await page.locator('[data-ed="copy"]').click();
    await bar(1).nth(11).click();
    await page.locator('[data-ed="paste"]').click();
    await expect(page.locator('.cl-tx-bar')).toHaveCount(3);
    await expect(bar(1).nth(11)).toHaveText('D3');
    await expect(bar(2).nth(2)).toHaveText('A3');
    await expect(bar(2).nth(5)).toHaveText('C4');
    await page.keyboard.press('Backspace'); // the pasted notes are still selected
    await expect(page.locator('.cl-tx-bar')).toHaveCount(2);
    // ⌘/Ctrl-click adds a cell; Delete, then Undo
    await bar(0).nth(3).click();
    await bar(0).nth(9).click({ modifiers: ['ControlOrMeta'] });
    await expect(selText).toHaveText('2 cells · 2 notes');
    await page.locator('[data-ed="delete"]').click();
    await expect(bar(0).nth(3)).toHaveText('');
    await expect(bar(0).nth(9)).toHaveText('');
    await page.locator('[data-ed="undo"]').click();
    await expect(bar(0)).toHaveText(bar0);
    // A drag from an empty cell selects a range; Escape clears it
    await dragCell(bar(0).nth(1), bar(0).nth(5));
    await expect(selText).toHaveText('5 cells · 1 note');
    await page.keyboard.press('Escape');
    await expect(selText).toHaveText('Tap a note to select it');

    // Played back right here: each cell in turn, then it stops on its own
    const play = page.locator('.cl-tx-play');
    await play.click();
    await expect(play).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.cl-tx-cell.playing')).toHaveCount(1);
    await expect(bar(1).nth(0)).toHaveClass(/playing/, { timeout: 8000 });
    await expect(play).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
    await expect(page.locator('.cl-tx-cell.playing')).toHaveCount(0);

    await page.locator('.cl-tx-send').click();
    await expect(page).toHaveURL(/#studio/);
    // 2 bars × 12 triplet steps (a phone's Studio shows them as quarter-note bars)
    await expect(page.locator('.measure-row .grid > *')).toHaveCount(24, { timeout: 10000 });
  });
});

// --- Signed in: Clips and the handpan's own note sounds (staging) ---

async function signIn(page, user) {
  await page.goto('/#studio');
  await loginAsTestUser(page, user);
}

test.describe('Transcribe, signed in', () => {
  withRecording('melody', { bpm: 80, startMs: 2000 });

  test('Send to Studio saves a new phrase, never over the open one', async ({ listen: page }) => {
    const user = await createTestUser();
    try {
      const keep = { version: 'v1.0', beats: 4, subdivision: 2, bpm: 90, steps: 8, measures: 1, labels: ['1', '', '', '', '', '', '', ''], hands: Array(8).fill(null) };
      const { error } = await supabaseAdmin.from('patterns').insert({ user_id: user.user.id, name: 'Keep', data: keep, source: 'manual' });
      if (error) throw error;
      await page.addInitScript(() => localStorage.setItem('groovepan_last_pattern', 'Keep'));
      await signIn(page, user);
      await expect(page.locator('#patternSelect')).toHaveValue('Keep', { timeout: 15000 });

      await openListen(page);
      await startListening(page);
      await page.locator('[data-m="transcribe"]').click();
      await page.locator('.cl-tx-go').click();
      await expect(page.locator('.cl-slot')).toHaveText(/Bar 2/, { timeout: 20000 });
      await page.waitForTimeout(4000);
      await page.locator('.cl-tx-go').click();
      await expect(page.locator('.cl-tx-send')).toBeVisible();
      await page.locator('.cl-tx-send').click();
      await expect(page).toHaveURL(/#studio/);
      await expect(page.locator('.measure-row').first()).toBeVisible();
      await page.waitForTimeout(1000);
      // A Studio edit, then past the auto-save delay: it goes to the new phrase
      await page.locator('.measure-row .cell').first().click();
      await page.keyboard.press('7');
      await page.waitForTimeout(3500);

      const { data: rows } = await supabaseAdmin.from('patterns').select('name, data').eq('user_id', user.user.id);
      expect(rows.find(r => r.name === 'Keep').data).toEqual(keep); // untouched
      const sent = rows.filter(r => r.name !== 'Keep');
      expect(sent).toHaveLength(1);
      expect(sent[0].name).toMatch(/^Transcribed /);
      await expect(page.locator('#patternSelect')).toHaveValue(sent[0].name);
      expect(sent[0].data.labels[0]).toBe('7'); // the edit was auto-saved there
    } finally {
      await deleteTestUser(user.user.id);
    }
  });
});

test.describe('record a flow as a Clip', () => {
  withRecording('session');

  test('records, saves to Clips, and builds the notation from it', async ({ listen: page }) => {
    const user = await createTestUser();
    try {
      await signIn(page, user);
      await openListen(page);
      await page.locator('.cl-rec').click();
      await expect(page.locator('.cl-view')).toHaveAttribute('data-mode', 'record');
      await page.waitForTimeout(31000); // the whole recording
      await page.locator('.cl-rec').click();
      await expect(page.locator('.cl-saved-text')).toContainText('D Kurd flow', { timeout: 30000 });

      await page.locator('.cl-saved-build').click();
      await expect(page.locator('.cl-clip')).toBeVisible({ timeout: 15000 });
      await page.locator('.cl-clip-play').click();
      await expect(reply(page)).toContainText('Done:', { timeout: 45000 });
      await expect(progression(page)).toHaveText(['Dm', 'C', 'Bb', 'Dm', 'C', 'Bb', 'Dm', 'C', 'Bb']);
      await expect(page.locator('.cl-meter')).toHaveText('4/4');

      // And from the Library
      await page.locator('.cl-clip-close').click();
      await page.goto('/#library');
      await page.locator('.library-tab[data-tab="clips"]').click();
      await page.locator('.clip-menu-btn').first().click();
      await page.getByText('Build notation in Listen').click();
      await expect(page.locator('.cl-clip-title')).toContainText('D Kurd flow', { timeout: 15000 });
    } finally {
      const { data } = await supabaseAdmin.from('clips').select('audio_url').eq('user_id', user.user.id);
      if (data?.length) await supabaseAdmin.storage.from('user-clips').remove(data.map(c => c.audio_url));
      await deleteTestUser(user.user.id);
    }
  });
});

test.describe('Note sounds', () => {
  withRecording('threeStrikes');

  test('records a note\'s own sound on the player\'s handpan', async ({ listen: page }) => {
    const user = await createTestUser();
    let saved = null;
    try {
      const pos = [[48, 46], [59, 76], [34, 75], [78, 59], [18, 56], [77, 35], [21, 33], [60, 19], [38, 19]];
      const notes = [['D', 3, 'Ding'], ['A', 3, '1'], ['A#', 3, '2'], ['C', 4, '3'], ['D', 4, '4'], ['E', 4, '5'], ['F', 4, '6'], ['G', 4, '7'], ['B', 5, '8']];
      // Own recordings on all but E4 (library sample) and B5 (none in the library).
      // Paths needn't exist: only E4 is played back.
      const noteMap = notes.map(([n, o, a], i) => ({
        id: i + 1, note: n, octave: o, assignedNumber: a, x: pos[i][0], y: pos[i][1], width: 11, height: 11, side: 'top',
        ...(a === '5' || a === '8' ? {} : { audio_url: `test-placeholder-${a}.wav` }),
      }));
      const { data: hp, error } = await supabaseAdmin.from('user_handpans').insert({
        user_id: user.user.id, name: 'Test Kurd', scale_name: 'D Kurd', top_image_url: 'https://example.com/pan.png', note_map: noteMap,
      }).select().single();
      if (error) throw error;
      await page.addInitScript(id => localStorage.setItem('gp_scale', `custom:${id}`), hp.id);
      await supabaseAdmin.from('profiles').upsert({ user_id: user.user.id, handpan_scale: `custom:${hp.id}` }, { onConflict: 'user_id' });

      await signIn(page, user);
      await openListen(page);
      await expect(page.locator('.cl-scale-select')).toHaveValue(`custom:${hp.id}`, { timeout: 15000 });
      await page.locator('.cl-sounds-btn').click();
      await expect(page.locator('.cl-sounds-text')).toContainText('8 of 9 notes have a sound (7 your own, 1 from the sample library). No sound yet for B5');
      await expect(page.locator('.cl-big .note-dot.cl-no-audio')).toHaveCount(1);
      await expect(page.locator('.cl-big .note-dot[data-note="D"]')).toHaveCount(0); // the Ding is drawn once, as 'Ding'

      await panNote(page, '5').click({ force: true });
      await expect(page.locator('.cl-sounds-text')).toContainText('Recording E4', { timeout: 10000 });
      await page.locator('[data-take="save"]').click({ timeout: 20000 });
      await expect(reply(page)).toHaveText("Saved E4's sound. It plays your own pan now.", { timeout: 30000 });
      await expect(page.locator('.cl-sounds-text')).toContainText('8 of 9 notes have a sound (8 your own). No sound yet for B5');

      const { data: row } = await supabaseAdmin.from('user_handpans').select('note_map').eq('id', hp.id).single();
      saved = row.note_map.find(t => t.assignedNumber === '5').audio_url;
      expect(saved).toMatch(/^E4_dkurd_[0-9a-f]{8}_\d{5}\.wav$/);
      expect(row.note_map.filter(t => t.audio_url?.startsWith('test-placeholder'))).toHaveLength(7);
    } finally {
      if (saved) await supabaseAdmin.storage.from('handpan-audio').remove([saved]);
      await deleteTestUser(user.user.id);
    }
  });
});
