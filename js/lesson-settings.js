// Per-student lesson settings (BPM/phrase overrides) — the "Reset Lesson
// Settings" feature.
//
// Mirrors student_exercise_progress's precedent (js/exercises.js's saveBpm):
// a student-owned override of an admin-owned shared resource, upserted on
// (user_id, lesson_id), never mutating the shared lessons row. Nothing here
// ever writes to `lessons` — the admin/shared-content path
// (js/courses.js's updateLessonFromGrid) is completely untouched and has no
// dependency on this module.
//
// Deliberately imports nothing from js/courses.js or js/controls.js — both
// of those import from here instead (courses.js already imports from
// controls.js, so a back-import would be circular).

import { supabase } from './supabase-client.js';
import { gridA } from './grid-context.js';
import { currentUser, currentLesson } from './state.js';
import { TransportRegistry } from './transport-ui.js';
import {
  serializePattern, applyPattern, hasUnsavedChanges, snapshotCurrentState,
  dbSavePattern, dbLoadPatternByName, dbListPatternNames,
} from './pattern-crud.js';
import { canAccess, FEATURE } from './gated-feature.js';
import { Bus, BUS_EVENT } from './bus.js';
import { alert, confirm, prompt } from './alert.js';
import { Modal } from './modal.js';
import { escapeHtml } from './utils.js';

// ── Diffing ─────────────────────────────────────────────────────────────
// Fields that make two saved patterns genuinely different PHRASES, not just
// a BPM tweak — serializePattern()'s own field list minus bpm/version
// (steps/measures are derived from beats/subdivision × measures, so they
// never need checking on their own).
const PHRASE_FIELDS = ['beats', 'subdivision', 'handSplit', 'labels', 'hands', 'flams', 'tags', 'gridB'];

function fieldsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Compares two serializePattern()-shaped snapshots. Returns null if they're
// equivalent, otherwise { phraseChanged, bpmChanged, lines }, lines being
// [{ label, from, to }] ready to render in either the save-prompt modal or
// the Reset-strip's diff summary — same helper, two callers (see below).
function diffPatterns(current, baseline) {
  if (!current || !baseline) return null;
  const phraseChanged = PHRASE_FIELDS.some(f => !fieldsEqual(current[f], baseline[f]));
  const bpmChanged = current.bpm !== baseline.bpm;
  if (!phraseChanged && !bpmChanged) return null;

  const lines = [];
  if (bpmChanged) lines.push({ label: 'BPM', from: baseline.bpm, to: current.bpm });
  if (phraseChanged) lines.push({ label: 'Phrase', from: null, to: 'edited' });
  return { phraseChanged, bpmChanged, lines };
}

// ── Lesson baseline (separate from pattern-crud.js's own dirty-check
// baseline) — specifically "what this lesson looked like when it loaded,"
// so the guard can tell a phrase edit from a bare BPM tweak. Captured by
// courses.js right after applying whichever pattern loadLesson() decided to
// load (default or override).
let lessonBaseline = null;
export function captureLessonBaseline() {
  lessonBaseline = serializePattern();
}

// ── Override cache — avoids a second query for the Reset/Restore control
// right after loadLesson() already fetched it.
let cachedLessonId = null;
let cachedOverride = null;

export async function getLessonOverride(lessonId, { forceRefresh = false } = {}) {
  if (!currentUser) { cachedLessonId = lessonId; cachedOverride = null; return null; }
  if (!forceRefresh && cachedLessonId === lessonId) return cachedOverride;

  const { data, error } = await supabase
    .from('student_lesson_settings')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('lesson_id', lessonId)
    .maybeSingle();

  if (error) {
    console.error('[LessonSettings] Failed to fetch override:', error);
    cachedOverride = null;
  } else {
    cachedOverride = data;
  }
  cachedLessonId = lessonId;
  return cachedOverride;
}

// ── Applying an override on lesson load ─────────────────────────────────
// Called by courses.js's loadLesson() once it has both the lesson and its
// (possibly null) override row. Returns true if it applied something, so
// the caller can skip its own default-pattern branch.
export async function applyLessonOverride(lesson, override) {
  if (override?.custom_pattern_name) {
    const pattern = await dbLoadPatternByName(override.custom_pattern_name);
    if (pattern) {
      await applyPattern(pattern);
      return true;
    }
  } else if (override?.custom_bpm && lesson.pattern_json) {
    await applyPattern(lesson.pattern_json);
    gridA.bpm = override.custom_bpm;
    TransportRegistry.updateAll(gridA);
    return true;
  }
  return false;
}

// ── Save guard ──────────────────────────────────────────────────────────
// Drop-in replacement for the old `if (hasUnsavedChanges()) { confirm(...) }`
// pairs. Returns true when it's fine to proceed with whatever's about to
// replace the grid (nothing changed, or the user chose Discard); false when
// the caller should abort (Cancel).
//
// discardMessage is each call site's own original confirm text (e.g. "Discard
// and start a new phrase?") — used verbatim, unchanged, whenever there's no
// lesson loaded, so plain Studio use keeps today's exact behavior. Only once
// a lesson is actually active does this branch into the new 3-button
// Save/Discard/Cancel flow instead.
export async function guardBeforeReplacingGrid(discardMessage = 'You have unsaved changes. Discard them?') {
  if (!hasUnsavedChanges()) return true;
  if (!currentLesson) return await confirm(discardMessage);

  const current = serializePattern();
  const diff = diffPatterns(current, lessonBaseline);
  if (!diff) return true; // baseline missing or nothing meaningful changed

  const choice = await showLessonSaveModal(currentLesson.title, diff.lines);
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;

  // choice === 'save'
  if (diff.bpmChanged && !diff.phraseChanged) {
    await upsertOverride(currentLesson.id, { custom_bpm: Math.round(current.bpm) });
  } else {
    const saved = await savePhraseForLesson(currentLesson);
    if (!saved) return false; // quota block or save error — don't lose the edit, stay put
  }

  snapshotCurrentState();
  return true;
}

// Saves the current grid as a named phrase in the student's own library
// (same dbSavePattern() helper the admin's updateLessonFromGrid uses — never
// touches the shared lessons row) and links it to the lesson. Returns false
// on cancel/quota-block without writing anything.
async function savePhraseForLesson(lesson) {
  const existingNames = await dbListPatternNames();
  const defaultName = lesson.title || 'My Version';
  const name = await prompt('Save this version as:', defaultName);
  if (!name?.trim()) return false;
  const trimmed = name.trim();

  const isNew = !existingNames.includes(trimmed);
  if (isNew && !canAccess(FEATURE.UNLIMITED_PATTERNS, { count: existingNames.length })) {
    Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, { feature: FEATURE.UNLIMITED_PATTERNS, featureId: 'feat-storage' });
    return false;
  }

  const ok = await dbSavePattern(trimmed, serializePattern());
  if (!ok) return false; // user declined an overwrite-confirm, or save failed

  await upsertOverride(lesson.id, { custom_pattern_name: trimmed, custom_bpm: null });
  return true;
}

async function upsertOverride(lessonId, fields) {
  if (!currentUser) return;
  const row = {
    user_id: currentUser.id,
    lesson_id: lessonId,
    // A fresh save supersedes whatever was in the one-level redo slot.
    previous_bpm: null,
    previous_pattern_name: null,
    updated_at: new Date().toISOString(),
    ...fields,
  };
  const { error } = await supabase
    .from('student_lesson_settings')
    .upsert(row, { onConflict: 'user_id,lesson_id' });
  if (error) console.error('[LessonSettings] Failed to save override:', error);
  cachedLessonId = null; // force a refetch next time it's read
}

// ── The 3-button save-prompt modal ─────────────────────────────────────
let modalInstance = null;
let resolveModal = null;

function getModalEls() {
  return {
    overlay: document.getElementById('lessonSaveChangesModal'),
    subtitle: document.getElementById('lessonSaveModalSubtitle'),
    diffList: document.getElementById('lessonSaveDiffList'),
    saveBtn: document.getElementById('lessonSaveConfirmBtn'),
    discardBtn: document.getElementById('lessonSaveDiscardBtn'),
    cancelBtn: document.getElementById('lessonSaveCancelBtn'),
    closeBtn: document.getElementById('closeLessonSaveModal'),
  };
}

function renderDiffLine(line) {
  const fromHtml = line.from != null
    ? `<span class="from">${escapeHtml(String(line.from))}</span><span class="arrow">→</span>`
    : '';
  return `<div class="lesson-save-diff-row"><span class="field">${escapeHtml(line.label)}</span>${fromHtml}<span class="to">${escapeHtml(String(line.to))}</span></div>`;
}

function showLessonSaveModal(lessonTitle, lines) {
  const els = getModalEls();
  if (!els.overlay) return Promise.resolve('discard'); // markup missing — fail open rather than block navigation entirely

  if (!modalInstance) {
    modalInstance = new Modal(els.overlay);
    els.saveBtn.addEventListener('click', () => finishModal('save'));
    els.discardBtn.addEventListener('click', () => finishModal('discard'));
    els.cancelBtn.addEventListener('click', () => finishModal('cancel'));
    els.closeBtn?.addEventListener('click', () => finishModal('cancel'));
  }

  els.subtitle.textContent = `You've changed the pattern for "${lessonTitle}."`;
  els.diffList.innerHTML = lines.map(renderDiffLine).join('');

  modalInstance.open();
  return new Promise((resolve) => { resolveModal = resolve; });
}

function finishModal(choice) {
  modalInstance?.close();
  resolveModal?.(choice);
  resolveModal = null;
}

// ── Reset / Restore control ─────────────────────────────────────────────
// Rendered into a fixed anchor (#lessonSettingsControl, positioned by
// courses.js right after the pattern preview) so this module never needs to
// know about DOM layout beyond that one id.
export async function renderLessonSettingsControl(lesson) {
  const el = document.getElementById('lessonSettingsControl');
  if (!el) return;

  const row = await getLessonOverride(lesson.id);
  const hasOverride = row && (row.custom_bpm != null || row.custom_pattern_name);
  const hasRedo = row && (row.previous_bpm != null || row.previous_pattern_name);

  if (!hasOverride && !hasRedo) {
    el.innerHTML = '';
    return;
  }

  if (hasOverride) {
    const overridePattern = await effectivePatternFor(lesson, row.custom_bpm, row.custom_pattern_name);
    const defaultPattern = lesson.pattern_json || null;
    const diff = defaultPattern ? diffPatterns(overridePattern, defaultPattern) : null;
    let lines = diff?.lines || [{ label: 'Phrase', from: null, to: row.custom_pattern_name ? `saved as "${row.custom_pattern_name}"` : 'custom BPM' }];
  
    if (row.custom_pattern_name) {
      lines = lines.map(line => line.label === 'Phrase'
        ? { ...line, to: `saved as "${row.custom_pattern_name}"` }
        : line);
    }

    el.innerHTML = `
      <div class="lesson-settings-strip">
        <div class="lesson-settings-label">✎ You've customized this lesson</div>
        <div class="lesson-settings-diff">${lines.map(renderDiffLine).join('')}</div>
        <button type="button" class="lesson-settings-btn reset" id="lessonResetBtn">↺ Reset Lesson Settings</button>
      </div>`;
    document.getElementById('lessonResetBtn')?.addEventListener('click', () => resetLessonSettings(lesson));
  } else {
    el.innerHTML = `
      <div class="lesson-settings-strip">
        <div class="lesson-settings-label">↺ Reset to the lesson's default</div>
        <div class="lesson-settings-diff">
          <div class="lesson-save-diff-row"><span class="field">Your version had</span><span class="to">${escapeHtml(row.previous_pattern_name ? `"${row.previous_pattern_name}"` : `BPM ${row.previous_bpm}`)}</span></div>
        </div>
        <button type="button" class="lesson-settings-btn restore" id="lessonRestoreBtn">↩ Restore My Changes</button>
      </div>`;
    document.getElementById('lessonRestoreBtn')?.addEventListener('click', () => restoreLessonSettings(lesson));
  }
}

// Builds the full serializePattern()-shaped pattern an override represents,
// for diffing against the lesson's default. A BPM-only override is the
// lesson's own pattern with just the bpm field swapped.
async function effectivePatternFor(lesson, customBpm, customPatternName) {
  if (customPatternName) {
    return await dbLoadPatternByName(customPatternName);
  }
  if (lesson.pattern_json) {
    return { ...lesson.pattern_json, bpm: customBpm };
  }
  return null;
}

export async function resetLessonSettings(lesson) {
  const row = await getLessonOverride(lesson.id);
  if (!row) return;

  const { error } = await supabase
    .from('student_lesson_settings')
    .upsert({
      user_id: currentUser.id,
      lesson_id: lesson.id,
      custom_bpm: null,
      custom_pattern_name: null,
      previous_bpm: row.custom_bpm ?? null,
      previous_pattern_name: row.custom_pattern_name ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,lesson_id' });

  if (error) { await alert('Could not reset this lesson: ' + error.message); return; }

  cachedLessonId = null;
  await loadDefaultIntoGrid(lesson);
  await renderLessonSettingsControl(lesson);
}

export async function restoreLessonSettings(lesson) {
  const row = await getLessonOverride(lesson.id);
  if (!row) return;

  const { error } = await supabase
    .from('student_lesson_settings')
    .upsert({
      user_id: currentUser.id,
      lesson_id: lesson.id,
      custom_bpm: row.previous_bpm ?? null,
      custom_pattern_name: row.previous_pattern_name ?? null,
      previous_bpm: null,
      previous_pattern_name: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,lesson_id' });

  if (error) { await alert('Could not restore your changes: ' + error.message); return; }

  cachedLessonId = null;
  const refreshed = await getLessonOverride(lesson.id, { forceRefresh: true });
  await applyLessonOverride(lesson, refreshed);
  captureLessonBaseline();
  snapshotCurrentState();
  await renderLessonSettingsControl(lesson);
}

async function loadDefaultIntoGrid(lesson) {
  if (lesson.pattern_json) {
    await applyPattern(lesson.pattern_json);
  }
  captureLessonBaseline();
  snapshotCurrentState();
}
