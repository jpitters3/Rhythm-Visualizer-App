/**
 * The Panafide Method — full-page view
 *
 * Step 1: Choose a rhythm (carousel, audio preview per card)
 * Step 2: Explore chords + suggested progressions + AI chord suggestion
 * Step 3: Melody & fills → Open in Studio
 *
 * Admin: can set the audio preview phrase per rhythm card directly
 * from the studio via the admin bar on each card.
 */

import { supabase } from './supabase-client.js';
import { GridContext } from './grid-context.js';
import { applyPattern, serializePattern, dbListPatternsWithData } from './pattern-crud.js';
import { start, stop, ensureAudio, playNoteByLabel } from './noteplayer.js';
import { gridA } from './grid-context.js';
import { getScale } from './state.js';
import { ChordAnalyzer } from './chord-analyzer.js';
import { canAccess, FEATURE } from './gated-feature.js';
import { Bus, BUS_EVENT } from './bus.js';
import { navigate } from './router.js';
import { isAdminUser, currentUser } from './state.js';
import { setChordHighlight, getPitchPositionMap, isChordTestMode } from './handpanmap.js';
import { annotatePlayability } from './chord-playability.js';
import { HistoryManager } from './history.js';

// ── State ──────────────────────────────────────────────────
let rhythms = [];
let selectedRhythm = null;       // rhythm card OR library phrase
let selectedPatternJson = null;  // resolved pattern_json for Open in Studio
let previewCtx = null;
let playingCardId = null;
let showToughChords = false;
let allChords = [];
let selectedProgression = null;  // { name, mood, resolvedChords }

// Original parent of handpan DOM nodes so we can return them on leave
let handpanOriginalParent = null;
let handpanBottomOriginalParent = null;

// Progression preview state
let progressionPreviewTimer = null;
let progressionPreviewActive = false;

const PROGRESSIONS = [
  { name: 'i – VII – VI – VII', mood: 'Circular · meditative' },
  { name: 'i – v – VI – VII',   mood: 'Building · hopeful' },
  { name: 'i – VII – VI – v',   mood: 'Resolving · melancholic' },
  { name: 'VI – VII – i',       mood: 'Rising · triumphant' },
];

// ── Init ───────────────────────────────────────────────────
export function initMethod() {
  // The preview GridContext needs a real (hidden) DOM container so the scheduler
  // can count steps via ctx.cells.length — without it c.cells.length === 0 and
  // the loop wraps immediately without ever scheduling audio.
  let container = document.getElementById('method-preview-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'method-preview-container';
    container.style.cssText = 'display:none;position:absolute;pointer-events:none;';
    document.body.appendChild(container);
  }
  previewCtx = new GridContext('method-preview', 'method-preview-container');

  window.addEventListener('routeChanged', ({ detail }) => {
    if (detail.route === 'method') onEnter();
    else onLeave();
  });
}

function onEnter() {
  teleportHandpan(true);
  syncMethodScaleSelect();
  loadLibraryPhrases();
  updateProgressionSummary();

  if (rhythms.length === 0) {
    loadRhythms();
  } else {
    renderChordSection();
  }
}

function onLeave() {
  teleportHandpan(false);
  stopPreview();
  stopProgressionPreview();
}

// ── Handpan teleport ───────────────────────────────────────
function teleportHandpan(toMethod) {
  const wrap = document.getElementById('handpanWrap');
  const wrapBottom = document.getElementById('handpanWrapBottom');
  if (!wrap) return;

  if (toMethod) {
    const slot = document.getElementById('methodHandpanSlot');
    if (!slot || slot.contains(wrap)) return;
    handpanOriginalParent = wrap.parentElement;
    slot.appendChild(wrap);
    if (wrapBottom) slot.appendChild(wrapBottom);
  } else {
    if (!handpanOriginalParent) return;
    handpanOriginalParent.appendChild(wrap);
    if (wrapBottom) handpanOriginalParent.appendChild(wrapBottom);
    handpanOriginalParent = null;
  }
}

// ── Scale select sync ──────────────────────────────────────
function syncMethodScaleSelect() {
  const source = document.getElementById('scaleSelect');
  const target = document.getElementById('methodScaleSelect');
  if (!source || !target) return;

  // Mirror options
  target.innerHTML = source.innerHTML;
  target.value = source.value;
}

function onMethodScaleChange(e) {
  const source = document.getElementById('scaleSelect');
  if (source && source.value !== e.target.value) {
    source.value = e.target.value;
    source.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// ── Library phrases ────────────────────────────────────────
async function loadLibraryPhrases() {
  const sel = document.getElementById('methodLibrarySelect');
  if (!sel) return;

  sel.innerHTML = '<option value="">Loading your library…</option>';
  sel.disabled = true;

  try {
    const patterns = await dbListPatternsWithData();
    if (!patterns?.length) {
      sel.innerHTML = '<option value="">No saved phrases found</option>';
      return;
    }

    sel.innerHTML = '<option value="">— Select a phrase from your library —</option>'
      + patterns.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('');
    sel.disabled = false;

    sel.onchange = () => {
      const idx = parseInt(sel.value, 10);
      if (isNaN(idx)) {
        // deselected — leave preview bar as-is (rhythm card may still be selected)
        return;
      }
      const p = patterns[idx];
      if (!p) return;
      selectedPatternJson = p.data ?? p.pattern_json ?? p;
      updateStudioBtn();
      // Deselect any rhythm card
      document.querySelectorAll('.method-rhythm-card').forEach(c => c.classList.remove('selected'));
      selectedRhythm = null;

      // Update preview bar for library phrase
      const nameEl = document.getElementById('methodSelectedName');
      const previewBtn = document.getElementById('methodPreviewSelectedBtn');
      if (nameEl) nameEl.textContent = p.name;
      if (previewBtn) previewBtn.disabled = false;

      // Reveal steps 2 & 3
      const step2 = document.getElementById('method-step-chords');
      const step3 = document.getElementById('method-step-melody');
      step2?.classList.remove('method-step-hidden');
      step3?.classList.remove('method-step-hidden');
      renderChordSection();
    };
  } catch (err) {
    sel.innerHTML = '<option value="">Could not load library</option>';
    console.error('[Method] loadLibraryPhrases error:', err);
  }
}

// ── Data ───────────────────────────────────────────────────
async function loadRhythms() {
  const container = document.getElementById('methodCarousel');
  if (!container) return;

  container.innerHTML = '<div class="method-carousel-loading">Loading rhythms…</div>';

  const { data, error } = await supabase
    .from('method_rhythms')
    .select('*')
    .eq('active', true)
    .order('order_index');

  if (error || !data?.length) {
    container.innerHTML = '<div class="method-carousel-loading">No rhythms available yet.</div>';
    return;
  }

  rhythms = data;
  renderCarousel();
  renderChordSection();
}

// ── Carousel ───────────────────────────────────────────────
function renderCarousel() {
  const container = document.getElementById('methodCarousel');
  if (!container) return;

  const isAdmin = isAdminUser(currentUser);

  container.innerHTML = rhythms.map(r => `
    <div class="method-rhythm-card" data-id="${r.id}">
      <div class="method-rhythm-subtitle">${esc(r.subtitle || '')}</div>
      <div class="method-rhythm-name">${esc(r.name)}</div>
      <div class="method-rhythm-desc">${esc(r.description || '')}</div>
      <div class="method-rhythm-footer">
        <span class="method-rhythm-badge">${esc(r.badge_emoji || '')} ${esc(r.badge_text || '')}</span>
        <button
          class="method-preview-btn ${r.pattern_json ? '' : 'disabled'}"
          data-id="${r.id}"
          title="${r.pattern_json ? 'Preview rhythm' : 'No preview set yet'}"
          ${r.pattern_json ? '' : 'disabled'}
        >▶</button>
      </div>
      ${isAdmin ? `
        <div class="method-admin-bar visible">
          <span>Admin:</span>
          <button data-admin-set="${r.id}">Set current pattern as preview</button>
        </div>
      ` : ''}
    </div>
  `).join('');

  // Card click → select
  container.querySelectorAll('.method-rhythm-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.method-preview-btn') || e.target.closest('[data-admin-set]')) return;
      const rhythm = rhythms.find(r => r.id === card.dataset.id);
      if (rhythm) selectRhythm(rhythm, card);
    });
  });

  // Preview button
  container.querySelectorAll('.method-preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rhythm = rhythms.find(r => r.id === btn.dataset.id);
      if (rhythm?.pattern_json) togglePreview(rhythm, btn);
    });
  });

  // Admin: set pattern
  if (isAdmin) {
    container.querySelectorAll('[data-admin-set]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setAdminPattern(btn.dataset.adminSet);
      });
    });
  }
}

function selectRhythm(rhythm, cardEl) {
  selectedRhythm = rhythm;
  selectedPatternJson = rhythm.pattern_json ?? null;

  // Reset library select
  const libSel = document.getElementById('methodLibrarySelect');
  if (libSel) libSel.value = '';

  // Update selected state
  document.querySelectorAll('.method-rhythm-card').forEach(c => c.classList.remove('selected'));
  cardEl?.classList.add('selected');

  // Enable preview bar with selected rhythm name
  const nameEl = document.getElementById('methodSelectedName');
  const previewBtn = document.getElementById('methodPreviewSelectedBtn');
  if (nameEl) nameEl.textContent = rhythm.name;
  if (previewBtn) previewBtn.disabled = false;

  // Reveal steps 2 & 3 and scroll to them
  const step2 = document.getElementById('method-step-chords');
  const step3 = document.getElementById('method-step-melody');
  if (step2) {
    step2.classList.remove('method-step-hidden');
    step2.classList.add('revealed');
    setTimeout(() => step2.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
  if (step3) {
    step3.classList.remove('method-step-hidden');
    step3.classList.add('revealed');
  }

  renderChordSection();
  updateStudioBtn();
}

// ── Audio Preview ──────────────────────────────────────────
async function togglePreview(rhythm, btn) {
  if (playingCardId === rhythm.id) {
    stopPreview();
    return;
  }

  stopPreview();

  try {
    await ensureAudio();
    await applyPattern(rhythm.pattern_json, previewCtx);
    await start(previewCtx, false, true);
    playingCardId = rhythm.id;
    btn.textContent = '■';
    btn.classList.add('playing');
  } catch (err) {
    console.error('[Method] Preview error:', err);
  }
}

function stopPreview() {
  if (previewCtx?.playing) stop(previewCtx, false);
  playingCardId = null;

  document.querySelectorAll('.method-preview-btn').forEach(b => {
    b.textContent = '▶';
    b.classList.remove('playing');
  });

  const selBtn = document.getElementById('methodPreviewSelectedBtn');
  if (selBtn) { selBtn.textContent = '▶ Preview'; selBtn.classList.remove('playing'); }
}

// ── Chords ─────────────────────────────────────────────────
function renderChordSection() {
  const chipsEl   = document.getElementById('methodChordChips');
  const moreBtn   = document.getElementById('methodChordsMoreBtn');
  const progsEl   = document.getElementById('methodProgressions');
  if (!chipsEl) return;

  const notes = getScaleNotes();
  if (!notes.length) {
    chipsEl.innerHTML = '<span style="font-size:12px;color:var(--text-secondary)">Select a scale in the studio to see chords.</span>';
    return;
  }

  allChords = annotatePlayability(ChordAnalyzer.analyze(notes), getPitchPositionMap());
  showToughChords = false;

  renderChordChips(chipsEl, moreBtn);
  renderProgressions(progsEl);
}

function chordSortKey(c) {
  return `${c.root} ${c.quality}`;
}

function renderChordChips(chipsEl, moreBtn) {
  const playable = allChords.filter(c =>  c.playable).sort((a, b) => chordSortKey(a).localeCompare(chordSortKey(b)));
  const tough    = allChords.filter(c => !c.playable).sort((a, b) => chordSortKey(a).localeCompare(chordSortKey(b)));

  const toShow = showToughChords ? [...playable, ...tough] : playable;

  chipsEl.innerHTML = toShow.map(c => `
    <button class="method-chord-chip${c.playable ? '' : ' not-playable'}" data-chord-id="${esc(c.id)}" title="Play ${esc(c.root)} ${esc(c.quality)}">
      ${esc(c.root)}<span class="chord-quality">${esc(c.quality)}</span>
    </button>
  `).join('');

  chipsEl.querySelectorAll('.method-chord-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const chord = allChords.find(c => c.id === btn.dataset.chordId);
      if (!chord) return;
      stopProgressionPreview();
      setChordHighlight([], false);
      document.querySelectorAll('.method-chord-chip.active').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      highlightChordOnHandpan(chord, true);
      playChordNotes(chord);
      setTimeout(() => {
        btn.classList.remove('active');
        highlightChordOnHandpan(chord, false);
      }, 2000);
    });
  });

  if (moreBtn) {
    if (tough.length === 0) {
      moreBtn.style.display = 'none';
    } else {
      moreBtn.style.display = '';
      moreBtn.textContent = showToughChords
        ? 'Hide tough chords'
        : 'Show chords that may be tough to play';
    }
  }
}

function renderProgressions(progsEl) {
  if (!progsEl) return;

  progsEl.innerHTML = PROGRESSIONS.map((p, pi) => {
    const resolved = resolveProgressionChords(p.name);
    const chordBtns = resolved.map(c => c
      ? `<button class="method-prog-chord-btn" data-chord-id="${esc(c.id)}" title="Play ${esc(c.root)} ${esc(c.quality)}">${esc(c.root)} <span class="chord-quality">${esc(c.quality)}</span></button>`
      : `<span class="method-prog-chord-unknown">?</span>`
    ).join('');

    return `
      <div class="method-prog-card" data-prog-idx="${pi}" role="button" tabindex="0" title="Select this progression">
        <div class="method-prog-header">
          <div class="method-prog-name">${esc(p.name)}</div>
          <div class="method-prog-mood">${esc(p.mood)}</div>
        </div>
        <div class="method-prog-chords">${chordBtns}</div>
        <button class="method-prog-preview-btn" data-prog-idx="${pi}" title="Preview this progression">▶</button>
      </div>
    `;
  }).join('');

  // Card click → select progression
  progsEl.querySelectorAll('.method-prog-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.method-prog-chord-btn') || e.target.closest('.method-prog-preview-btn')) return;
      const idx = parseInt(card.dataset.progIdx, 10);
      selectProgression(idx, card);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const idx = parseInt(card.dataset.progIdx, 10);
        selectProgression(idx, card);
      }
    });
  });

  // Wire individual chord buttons
  progsEl.querySelectorAll('.method-prog-chord-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const chord = allChords.find(c => c.id === btn.dataset.chordId);
      if (!chord) return;
      stopProgressionPreview();
      setChordHighlight([], false);
      document.querySelectorAll('.method-prog-chord-btn.active, .method-chord-chip.active').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      highlightChordOnHandpan(chord, true);
      playChordNotes(chord);
      setTimeout(() => {
        btn.classList.remove('active');
        highlightChordOnHandpan(chord, false);
      }, 2000);
    });
  });

  // Wire progression preview buttons
  progsEl.querySelectorAll('.method-prog-preview-btn').forEach(previewBtn => {
    previewBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(previewBtn.dataset.progIdx, 10);
      const prog = PROGRESSIONS[idx];
      if (!prog) return;

      const card = previewBtn.closest('.method-prog-card');
      const chordBtnEls = Array.from(card.querySelectorAll('.method-prog-chord-btn'));
      const resolved = resolveProgressionChords(prog.name);

      await previewProgression(resolved, previewBtn, chordBtnEls);
    });
  });

  // Restore selection highlight if a progression was already selected
  if (selectedProgression !== null) {
    const idx = PROGRESSIONS.findIndex(p => p.name === selectedProgression.name);
    if (idx >= 0) {
      progsEl.querySelector(`.method-prog-card[data-prog-idx="${idx}"]`)?.classList.add('selected');
    }
  }
}

function selectProgression(idx, cardEl) {
  const prog = PROGRESSIONS[idx];
  if (!prog) return;

  const resolved = resolveProgressionChords(prog.name);
  selectedProgression = { ...prog, resolvedChords: resolved };

  // Update visual selection
  document.querySelectorAll('.method-prog-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');

  // Update step 3 summary
  updateProgressionSummary();
}

function updateProgressionSummary() {
  const el = document.getElementById('methodSelectedProgression');
  if (!el) return;
  if (!selectedProgression) {
    el.textContent = 'No progression selected';
    el.classList.remove('has-selection');
    return;
  }
  const chordNames = (selectedProgression.resolvedChords || [])
    .filter(Boolean)
    .map(c => `${c.root} ${c.quality}`)
    .join(' → ');
  el.innerHTML = `<strong>${esc(selectedProgression.name)}</strong><span class="method-prog-summary-chords">${esc(chordNames)}</span>`;
  el.classList.add('has-selection');
}

function getScaleNotes() {
  const scale = getScale();
  if (!scale) return [];
  const notes = [];
  if (scale.ding) notes.push(scale.ding);
  if (scale.map) Object.values(scale.map).forEach(n => notes.push(n));
  return notes;
}

// ── Chord playback + handpan highlight ────────────────────
function pitchClass(noteStr) {
  return noteStr.replace(/\d+$/, '');
}

function highlightChordOnHandpan(chord, active) {
  if (!chord?.notes) return;
  const scale = getScale();
  if (!scale) return;

  const labels = [];
  if (chord.notes.includes(scale.ding)) { labels.push('D'); labels.push('Ding'); }
  if (scale.map) {
    for (const [lbl, pitch] of Object.entries(scale.map)) {
      if (chord.notes.includes(pitch)) labels.push(lbl);
    }
  }

  setChordHighlight(labels, active, chord.playable ?? true);
}

function playChordNotes(chord) {
  if (!chord?.notes) return;
  const scale = getScale();
  if (!scale) return;

  if (scale.ding && chord.notes.includes(scale.ding)) playNoteByLabel('D');
  if (scale.map) {
    for (const [lbl, pitch] of Object.entries(scale.map)) {
      if (chord.notes.includes(pitch)) playNoteByLabel(lbl);
    }
  }
}

// ── Progression resolution ─────────────────────────────────
const ROMAN_DEGREE = { I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6 };

function parseRomanNumeral(token) {
  const isMinor = token === token.toLowerCase();
  const upper = token.toUpperCase();
  const degree = ROMAN_DEGREE[upper] ?? -1;
  return { degree, quality: isMinor ? 'Minor' : 'Major' };
}

function resolveProgressionChords(notation) {
  if (!allChords.length) return [];
  const chords = allChords.filter(c => c.playable);
  const scaleNotes = getScaleNotes();
  const uniqueRoots = [];
  const seen = new Set();
  scaleNotes.forEach(n => {
    const pc = pitchClass(n);
    if (!seen.has(pc)) { seen.add(pc); uniqueRoots.push(pc); }
  });

  // Among candidates, pick the inversion whose root note is at the lowest octave.
  function lowestRootOctave(candidates) {
    if (!candidates.length) return null;
    return candidates.reduce((best, c) => {
      const rootNoteOf = ch => ch.notes.find(n => pitchClass(n) === ch.root);
      const octaveOf   = n  => { const m = n?.match(/(\d+)$/); return m ? parseInt(m[1]) : Infinity; };
      return octaveOf(rootNoteOf(c)) < octaveOf(rootNoteOf(best)) ? c : best;
    });
  }

  const parts = notation.split(/\s*[–-]\s*/).map(p => p.trim());
  return parts.map(part => {
    const { degree, quality } = parseRomanNumeral(part);
    if (degree < 0 || degree >= uniqueRoots.length) return null;
    const root = uniqueRoots[degree];
    return lowestRootOctave(chords.filter(c => c.root === root && c.quality === quality))
      || lowestRootOctave(chords.filter(c => c.root === root))
      || null;
  });
}

// ── Progression preview ────────────────────────────────────
function stopProgressionPreview() {
  if (progressionPreviewTimer) {
    clearTimeout(progressionPreviewTimer);
    progressionPreviewTimer = null;
  }
  progressionPreviewActive = false;
  setChordHighlight([], false);
  document.querySelectorAll('.method-prog-chord-btn.playing').forEach(b => b.classList.remove('playing'));
  document.querySelectorAll('.method-prog-preview-btn.playing').forEach(b => {
    b.classList.remove('playing');
    b.textContent = '▶';
  });
}

async function previewProgression(resolvedChords, previewBtn, chordBtns) {
  if (progressionPreviewActive) {
    stopProgressionPreview();
    return;
  }

  if (!resolvedChords.some(Boolean)) return;

  try {
    await ensureAudio();
  } catch { return; }

  stopProgressionPreview();
  progressionPreviewActive = true;
  previewBtn.classList.add('playing');
  previewBtn.textContent = '■';

  const playStep = (i) => {
    if (!progressionPreviewActive || i >= resolvedChords.length) {
      stopProgressionPreview();
      return;
    }

    setChordHighlight([], false);
    document.querySelectorAll('.method-prog-chord-btn.playing').forEach(b => b.classList.remove('playing'));

    const chord = resolvedChords[i];
    const btn = chordBtns[i];

    if (chord) {
      if (btn) btn.classList.add('playing');
      highlightChordOnHandpan(chord, true);
      playChordNotes(chord);
    }

    progressionPreviewTimer = setTimeout(() => playStep(i + 1), 1100);
  };

  playStep(0);
}

// ── AI Chord Suggestion ────────────────────────────────────
async function submitAIChordPrompt(userText) {
  const resultEl = document.getElementById('methodAiResult');
  const submitBtn = document.getElementById('methodAiSubmit');
  if (!resultEl || !submitBtn) return;

  if (!canAccess(FEATURE.AI_ASSISTANT)) {
    Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, { feature: FEATURE.AI_ASSISTANT });
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Thinking…';
  resultEl.classList.remove('visible');

  const scaleName = document.getElementById('scaleSelect')?.options[document.getElementById('scaleSelect')?.selectedIndex]?.text || 'your scale';
  const chordList = allChords.map(c => `${c.root} ${c.quality}`).join(', ') || 'unknown chords';

  const systemPrompt = `
You are a handpan music teacher helping a student choose a chord progression.

The student's handpan scale is: ${scaleName}
Available chords in this scale: ${chordList}

The student wants to evoke: "${userText}"

Suggest 2–3 chord progressions using only the available chords above.
For each progression:
- List the chord names in order (e.g. D Minor → C Major → Bb Major)
- Give it a short descriptive name (e.g. "The Resolution")
- One sentence on why it evokes the requested feeling

Keep your response concise and practical. Plain text only, no markdown.
`.trim();

  try {
    const { data, error } = await supabase.functions.invoke('ai-assistant', {
      body: { systemPrompt }
    });

    if (error) throw error;

    const text = data?.reply || data?.content || data?.text
      || (typeof data === 'string' ? data : JSON.stringify(data));

    resultEl.textContent = text;
    resultEl.classList.add('visible');
  } catch (err) {
    resultEl.textContent = 'Something went wrong. Please try again.';
    resultEl.classList.add('visible');
    console.error('[Method] AI error:', err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Suggest progressions';
  }
}

// ── Open in Studio ─────────────────────────────────────────
async function openInStudio() {
  if (!selectedPatternJson) return;

  const btn = document.getElementById('methodStudioBtn');
  const originalText = btn?.textContent ?? 'Open in Studio →';
  if (btn) btn.disabled = true;

  try {
    if (HistoryManager) HistoryManager.pushState();

    // Clear the grid before applying so no stale content bleeds through
    // (setSubdivision inside applyPattern triggers an intermediate renderAllMeasures
    // with the old labels still present if we don't wipe first)
    gridA.innerLabels = [];
    gridA.innerHands  = [];
    gridA.innerFlams  = [];

    const hasProgression = selectedProgression?.resolvedChords?.some(Boolean);

    if (hasProgression && canAccess(FEATURE.AI_ASSISTANT)) {
      if (btn) btn.textContent = 'Building composition…';
      const aiPattern = await generateCompositionPattern();
      await applyPattern(aiPattern ?? buildCompositionPhrase(selectedPatternJson, selectedProgression.resolvedChords), gridA);
    } else if (hasProgression) {
      await applyPattern(buildCompositionPhrase(selectedPatternJson, selectedProgression.resolvedChords), gridA);
    } else {
      await applyPattern(selectedPatternJson, gridA);
    }

    navigate('studio');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

// ── Compound phrase builder ────────────────────────────────
function labelsToChordSlots(labels) {
  const slots = ['', '', '', ''];
  const numericLabels = [];
  const otherLabels = [];

  labels.forEach(l => {
    const n = parseInt(l);
    if (!isNaN(n)) numericLabels.push(n);
    else otherLabels.push(String(l));
  });

  numericLabels.sort((a, b) => a - b);
  const rightNotes = numericLabels.filter(n => n % 2 !== 0);
  const leftNotes  = numericLabels.filter(n => n % 2 === 0);
  const usedNotes  = new Set();
  let rightPairFound = false;
  let leftPairFound  = false;

  if (rightNotes.length >= 2) {
    slots[3] = String(rightNotes[0]);
    slots[2] = String(rightNotes[1]);
    usedNotes.add(rightNotes[0]);
    usedNotes.add(rightNotes[1]);
    rightPairFound = true;
  }

  if (leftNotes.length >= 2) {
    if (!slots[0] && !slots[1]) {
      slots[0] = String(leftNotes[1]);
      slots[1] = String(leftNotes[0]);
      usedNotes.add(leftNotes[0]);
      usedNotes.add(leftNotes[1]);
      leftPairFound = true;
    }
  }

  const remainder = [...numericLabels.filter(n => !usedNotes.has(n)).map(String), ...otherLabels];

  remainder.forEach(note => {
    if (rightPairFound && !leftPairFound) {
      if (!slots[0]) slots[0] = note;
      else if (!slots[1]) slots[1] = note;
      else if (!slots[2]) slots[2] = note;
      else if (!slots[3]) slots[3] = note;
    } else if (leftPairFound && !rightPairFound) {
      if (!slots[2]) slots[2] = note;
      else if (!slots[3]) slots[3] = note;
      else if (!slots[0]) slots[0] = note;
      else if (!slots[1]) slots[1] = note;
    } else {
      if (!slots[0]) slots[0] = note;
      else if (!slots[2]) slots[2] = note;
      else if (!slots[1]) slots[1] = note;
      else if (!slots[3]) slots[3] = note;
    }
  });

  return slots;
}

function buildCompositionPhrase(basePattern, resolvedChords) {
  const scale = getScale();
  if (!scale || !basePattern?.labels) return basePattern;

  // Pitch → handpan label lookup
  const pitchToLabel = { [scale.ding]: 'D' };
  if (scale.map) {
    for (const [lbl, pitch] of Object.entries(scale.map)) {
      pitchToLabel[pitch] = lbl;
    }
  }

  const baseLabels = basePattern.labels;
  const baseHands  = Array.isArray(basePattern.hands)  ? basePattern.hands  : Array(baseLabels.length).fill(null);
  const baseFlams  = Array.isArray(basePattern.flams)  ? basePattern.flams  : Array(baseLabels.length).fill('');

  const newLabels = [];
  const newHands  = [];
  const newFlams  = [];

  resolvedChords.forEach(chord => {
    // Deep-copy the base measure labels so we don't mutate the original
    const copyLabels = baseLabels.map(l => Array.isArray(l) ? [...l] : l);
    const copyHands  = [...baseHands];
    const copyFlams  = [...baseFlams];

    if (chord?.notes?.length) {
      const chordLabels = chord.notes.map(p => pitchToLabel[p]).filter(Boolean);
      if (chordLabels.length === 1) {
        copyLabels[0] = chordLabels[0];
      } else if (chordLabels.length > 1) {
        copyLabels[0] = labelsToChordSlots(chordLabels);
      }
      copyHands[0] = null;
    }

    newLabels.push(...copyLabels);
    newHands.push(...copyHands);
    newFlams.push(...copyFlams);
  });

  // Strip gridB — this is a fresh composition pattern
  const { gridB: _ignored, ...rest } = basePattern;
  return { ...rest, labels: newLabels, hands: newHands, flams: newFlams };
}

// ── Background AI composition generator ───────────────────
async function generateCompositionPattern() {
  const scale = getScale();
  if (!scale || !selectedPatternJson?.labels) return null;

  const chords = (selectedProgression?.resolvedChords ?? []).filter(Boolean);
  if (!chords.length) return null;

  // Use the full rhythm as the repeating template — not just one measure.
  // A saved phrase may span multiple measures (e.g. 16 steps with subdivision 2).
  const beats          = selectedPatternJson.beats ?? 4;
  const subdivision    = selectedPatternJson.subdivision ?? 2;
  const baseTemplate   = selectedPatternJson.labels;          // full rhythm
  const templateLength = baseTemplate.length;                 // e.g. 16

  // Serialize to human-readable: "D - - - T - D - D - - - T - - -"
  const serializeLabel = (l) => {
    if (!l || l === '') return '-';
    if (Array.isArray(l)) {
      const notes = l.filter(Boolean);
      return notes.length ? notes.join('+') : '-';
    }
    return String(l);
  };
  const rhythmStr = baseTemplate.map(serializeLabel).join(' ');

  const numMeasures = chords.length;
  const totalSteps  = numMeasures * templateLength;

  // Pitch → label lookup
  const pitchToLabel = { [scale.ding]: 'D' };
  if (scale.map) {
    for (const [lbl, pitch] of Object.entries(scale.map)) pitchToLabel[pitch] = lbl;
  }

  const scaleEl    = document.getElementById('scaleSelect');
  const scaleName  = scaleEl?.options[scaleEl?.selectedIndex]?.text ?? 'Unknown scale';

  // Build per-chord lines with the chord array pre-computed
  const chordLines = chords.map((chord, i) => {
    const noteLabels = chord.notes.map(p => pitchToLabel[p]).filter(Boolean);
    const slots      = labelsToChordSlots(noteLabels);
    const slotsStr   = JSON.stringify(slots); // e.g. ["3","1","5",""]
    return `  Measure ${i + 1}: ${chord.root} ${chord.quality} → use ${slotsStr} at step 0`;
  }).join('\n');

  const chordStepOffsets = chords.map((_, i) => i * templateLength).join(', ');

  const systemPrompt = `You are an expert handpan composer.
Scale: ${scaleName}
Valid note labels: "D" (Ding), "T" (Tak), "S" (Slap), "1"–"8" (tone field numbers). Rest = "".

Output format — a JSON object with NO markdown:
{
  "measures": ${numMeasures},
  "labels": [ /* exactly ${totalSteps} items */ ]
}

Each item is a string ("D", "1", "T", "") or a 4-element chord array [LH-Index, LH-Thumb, RH-Index, RH-Thumb].

THE BASE RHYTHM (${templateLength} steps):
[ ${rhythmStr} ]

TASK: Repeat this exact rhythm ${numMeasures} times — once for each chord. The full output is ${totalSteps} steps.
For each repetition, copy every step from the base rhythm exactly AS-IS, but replace only step 0 of that repetition with the chord array for that chord.

CHORDS (replace step 0 of each repetition only — steps ${chordStepOffsets}):
${chordLines}

Rules:
- Each repetition is exactly ${templateLength} steps
- Steps 1–${templateLength - 1} of every repetition = copied verbatim from the base rhythm, unchanged
- Step 0 of repetition N = chord array for chord N (replace the first note only)
- Output ONLY the JSON object. No explanation, no markdown fences.`;

  try {
    const { data, error } = await supabase.functions.invoke('ai-assistant', {
      body: { systemPrompt }
    });

    if (error) throw error;

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return null;

    const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed  = JSON.parse(jsonStr);

    if (!Array.isArray(parsed?.labels) || parsed.labels.length !== totalSteps) {
      console.warn('[Method] AI label count mismatch — expected', totalSteps, 'got', parsed?.labels?.length);
      return null;
    }

    return {
      beats,
      subdivision,
      bpm:    selectedPatternJson?.bpm ?? 90,
      labels: parsed.labels,
      hands:  Array(totalSteps).fill(null),
      flams:  Array(totalSteps).fill(''),
    };
  } catch (err) {
    console.error('[Method] generateCompositionPattern error:', err);
    return null;
  }
}

function updateStudioBtn() {
  const btn = document.getElementById('methodStudioBtn');
  if (!btn) return;
  btn.disabled = !selectedPatternJson;
  const label = selectedRhythm?.name || 'this phrase';
  btn.title = selectedPatternJson
    ? `Load "${label}" into the studio`
    : 'Select a rhythm or library phrase first';
}

// ── Admin: set preview pattern ─────────────────────────────
async function setAdminPattern(rhythmId) {
  // Prefer the phrase selected from the library dropdown; fall back to studio grid
  const pattern = selectedPatternJson ?? serializePattern(gridA);
  if (!pattern) {
    alert('No phrase selected. Pick one from the library dropdown or load one in the studio first.');
    return;
  }

  const { error, count } = await supabase
    .from('method_rhythms')
    .update({ pattern_json: pattern })
    .eq('id', rhythmId)
    .select('id', { count: 'exact', head: true });

  if (error) {
    alert(`Failed to save: ${error.message}`);
    return;
  }

  if (count === 0) {
    alert('Save blocked — no rows updated. Check that you are logged in as an admin and the RLS update policy exists.');
    return;
  }

  // Update local cache
  const r = rhythms.find(r => r.id === rhythmId);
  if (r) r.pattern_json = pattern;

  // Enable the preview button on this card
  const btn = document.querySelector(`.method-preview-btn[data-id="${rhythmId}"]`);
  if (btn) {
    btn.disabled = false;
    btn.classList.remove('disabled');
  }

  alert('Preview pattern saved!');
}

// ── Event wiring (called after view HTML is in DOM) ────────
export function wireMethodEvents() {
  // Chords expand/collapse
  document.getElementById('methodChordsMoreBtn')?.addEventListener('click', () => {
    showToughChords = !showToughChords;
    renderChordChips(
      document.getElementById('methodChordChips'),
      document.getElementById('methodChordsMoreBtn')
    );
  });

  // AI submit
  document.getElementById('methodAiSubmit')?.addEventListener('click', () => {
    const input = document.getElementById('methodAiInput');
    const text = input?.value?.trim();
    if (text) submitAIChordPrompt(text);
  });

  document.getElementById('methodAiInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = e.target.value.trim();
      if (text) submitAIChordPrompt(text);
    }
  });

  // AI gate: clicking the disabled input shows upgrade modal
  const aiBlock = document.getElementById('methodAiBlock');
  if (aiBlock && !canAccess(FEATURE.AI_ASSISTANT)) {
    aiBlock.classList.add('locked');
    document.getElementById('methodAiInput').disabled = true;
    document.getElementById('methodAiSubmit').disabled = true;

    aiBlock.addEventListener('click', () => {
      Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, { feature: FEATURE.AI_ASSISTANT });
    });
  }

  // Preview selected rhythm button
  document.getElementById('methodPreviewSelectedBtn')?.addEventListener('click', async () => {
    if (!selectedPatternJson) return;
    const btn = document.getElementById('methodPreviewSelectedBtn');
    const id = selectedRhythm?.id ?? '__library__';

    if (playingCardId === id) {
      stopPreview();
      return;
    }

    stopPreview();
    try {
      await ensureAudio();
      await applyPattern(selectedPatternJson, previewCtx);
      await start(previewCtx, false, true);
      playingCardId = id;
      btn.textContent = '■ Stop';
      btn.classList.add('playing');
    } catch (err) {
      console.error('[Method] Selected preview error:', err);
    }
  });

  // Open in Studio
  document.getElementById('methodStudioBtn')?.addEventListener('click', openInStudio);

  // Method-view scale dropdown → propagate to studio, re-render chords
  document.getElementById('methodScaleSelect')?.addEventListener('change', onMethodScaleChange);

  // Re-render chord chips when test mode toggles (show all vs playable-only)
  window.addEventListener('chord-test-mode-changed', () => renderChordSection());

  // Re-render chords when scale changes (from either dropdown or handpan-loaded)
  window.addEventListener('handpan-loaded', () => {
    syncMethodScaleSelect();
    stopProgressionPreview();
    renderChordSection();
  });
  document.getElementById('scaleSelect')?.addEventListener('change', () => {
    setTimeout(() => {
      syncMethodScaleSelect();
      stopProgressionPreview();
      renderChordSection();
    }, 100);
  });
}

// ── Utility ────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
