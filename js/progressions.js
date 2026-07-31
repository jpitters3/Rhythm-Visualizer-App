// Progressions (admin, v1 placeholder)
//
// Bare-bones ordered phrase picker so real Progression / Mini-Course data
// exists to build and test the student-facing Patterns tab against. This
// module, its modal markup (#progressionsModal in index.html), and
// css/progressions.css are expected to be replaced wholesale once the full
// Progressions authoring UX (Library-integrated multi-select, dedicated
// Progressions tab, three-dot menu actions) is built.

import { alert, confirm } from './alert.js';
import { Modal } from './modal.js';
import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';
import { dbListPatternNames, dbLoadPatternByName } from './pattern-crud.js';
import { SCALES } from './config.js';
import { Bus, BUS_EVENT } from './bus.js';

let progressionsModal = null;
let allPhraseNames = [];
let editingProgressionId = null;
let selectedPhraseNames = []; // ordered
let previewPhraseName = null; // which selected phrase is the Patterns-modal card preview; null = first

export function initProgressions() {
  const modalEl = document.getElementById('progressionsModal');
  if (!modalEl || progressionsModal) return;

  progressionsModal = new Modal(modalEl);
  modalEl.querySelector('.close-modal-btn').onclick = () => progressionsModal.close();

  populateScaleSelect();

  document.getElementById('progressionsNewBtn').onclick = () => openEditor(null);
  document.getElementById('progressionsBackBtn').onclick = () => showListView();
  document.getElementById('progSaveBtn').onclick = saveProgression;
  document.getElementById('progDeleteBtn').onclick = deleteProgression;
  document.getElementById('progGenerateCourseBtn').onclick = generateMiniCourse;
  document.getElementById('progPhraseSearch').oninput = (e) => renderPhrasePicker(e.target.value);
}

export async function openProgressions() {
  if (!progressionsModal) return;
  progressionsModal.open();
  showListView();
  await refreshList();
}

// System scales only — custom scales aren't shareable yet (no is_public
// flag / RLS on user_handpans), so they're left out until that exists.
function populateScaleSelect() {
  const selectEl = document.getElementById('progScale');
  selectEl.innerHTML = '';
  for (const name of Object.keys(SCALES)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    selectEl.appendChild(opt);
  }
}

function populateCategoryDatalist(categories) {
  const listEl = document.getElementById('progCategoryList');
  const unique = [...new Set(categories)].sort((a, b) => a.localeCompare(b));
  listEl.innerHTML = unique.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

function effectivePreviewName() {
  return (previewPhraseName && selectedPhraseNames.includes(previewPhraseName))
    ? previewPhraseName
    : (selectedPhraseNames[0] || null);
}

function readLevelField() {
  const raw = document.getElementById('progLevel').value;
  return raw ? parseInt(raw, 10) : null;
}

function showListView() {
  document.getElementById('progressionsListView').style.display = '';
  document.getElementById('progressionsEditorView').style.display = 'none';
}

function showEditorView() {
  document.getElementById('progressionsListView').style.display = 'none';
  document.getElementById('progressionsEditorView').style.display = '';
}

async function refreshList() {
  const listEl = document.getElementById('progressionsList');
  listEl.innerHTML = '<div style="padding:12px; color:var(--text-secondary);">Loading…</div>';

  const { data: progressions, error } = await supabase
    .from('progressions')
    .select('id, name, level, intended_scale, category')
    .eq('user_id', currentUser?.id)
    .order('created_at', { ascending: false });

  if (error) {
    listEl.innerHTML = `<div style="color:var(--error);">Error: ${error.message}</div>`;
    return;
  }

  populateCategoryDatalist(progressions.map(p => p.category).filter(Boolean));

  if (!progressions || progressions.length === 0) {
    listEl.innerHTML = '<div style="padding:12px; color:var(--text-secondary);">No progressions yet.</div>';
    return;
  }

  const { data: phraseCounts } = await supabase
    .from('progression_phrases')
    .select('progression_id')
    .in('progression_id', progressions.map(p => p.id));

  const countByProgression = {};
  for (const row of (phraseCounts || [])) {
    countByProgression[row.progression_id] = (countByProgression[row.progression_id] || 0) + 1;
  }

  listEl.innerHTML = '';
  for (const p of progressions) {
    const item = document.createElement('div');
    item.className = 'prog-list-item';
    const count = countByProgression[p.id] || 0;
    item.innerHTML = `
      <div>
        <div class="prog-list-item-name">${escapeHtml(p.name)}</div>
        <div class="prog-list-item-meta">${escapeHtml(p.level || 'No level')} · ${escapeHtml(p.category || 'No category')} · ${escapeHtml(p.intended_scale || 'No scale set')} · ${count} phrase${count === 1 ? '' : 's'}</div>
      </div>
    `;
    item.onclick = () => openEditor(p.id);
    listEl.appendChild(item);
  }
}

async function openEditor(progressionId) {
  editingProgressionId = progressionId;
  selectedPhraseNames = [];
  previewPhraseName = null;

  document.getElementById('progName').value = '';
  document.getElementById('progLevel').value = '';
  document.getElementById('progScale').selectedIndex = 0;
  document.getElementById('progCategory').value = '';
  document.getElementById('progTags').value = '';
  document.getElementById('progPhraseSearch').value = '';
  document.getElementById('progGenerateStatus').textContent = '';
  document.getElementById('progDeleteBtn').style.display = progressionId ? '' : 'none';
  document.getElementById('progGenerateCourseBtn').style.display = progressionId ? '' : 'none';

  if (allPhraseNames.length === 0) {
    try {
      allPhraseNames = await dbListPatternNames();
    } catch (err) {
      console.error('[Progressions] Failed to load phrase names:', err);
      allPhraseNames = [];
    }
  }

  if (progressionId) {
    const { data: progression, error: pErr } = await supabase
      .from('progressions')
      .select('name, level, intended_scale, category, tags, preview_phrase_name')
      .eq('id', progressionId)
      .single();

    if (pErr) {
      await alert('Failed to load progression: ' + pErr.message);
      return;
    }

    document.getElementById('progName').value = progression.name || '';
    document.getElementById('progLevel').value = progression.level ?? '';
    document.getElementById('progCategory').value = progression.category || '';
    document.getElementById('progTags').value = (progression.tags || []).join(', ');
    const scaleSelectEl = document.getElementById('progScale');
    // Falls back to the first option if the saved scale no longer exists
    // (e.g. it was a custom scale from before this was restricted to system scales).
    if (progression.intended_scale && Object.keys(SCALES).includes(progression.intended_scale)) {
      scaleSelectEl.value = progression.intended_scale;
    } else {
      scaleSelectEl.selectedIndex = 0;
    }

    const { data: phrases } = await supabase
      .from('progression_phrases')
      .select('phrase_name')
      .eq('progression_id', progressionId)
      .order('position', { ascending: true });

    selectedPhraseNames = (phrases || []).map(r => r.phrase_name);
    previewPhraseName = progression.preview_phrase_name && selectedPhraseNames.includes(progression.preview_phrase_name)
      ? progression.preview_phrase_name
      : null;
  }

  renderPhrasePicker('');
  showEditorView();
}

function renderPhrasePicker(searchQuery) {
  const pickerEl = document.getElementById('progPhrasePicker');
  const query = (searchQuery || '').toLowerCase();

  const names = allPhraseNames
    .filter(n => n.toLowerCase().includes(query))
    // Selected phrases first (in their progression order), unselected after.
    .sort((a, b) => {
      const aIdx = selectedPhraseNames.indexOf(a);
      const bIdx = selectedPhraseNames.indexOf(b);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return 0;
    });

  if (names.length === 0) {
    pickerEl.innerHTML = '<div style="padding:12px; color:var(--text-secondary);">No phrases found.</div>';
    return;
  }

  pickerEl.innerHTML = '';
  for (const name of names) {
    const selectedIdx = selectedPhraseNames.indexOf(name);
    const isSelected = selectedIdx >= 0;
    // Effective preview is previewPhraseName if set, else the first selected phrase.
    const isPreview = isSelected && (previewPhraseName ? name === previewPhraseName : selectedIdx === 0);
    const row = document.createElement('div');
    row.className = 'prog-phrase-row' + (isSelected ? ' selected' : '');
    row.innerHTML = `
      <div class="prog-phrase-badge">${isSelected ? selectedIdx + 1 : ''}</div>
      <div class="prog-phrase-name">${escapeHtml(name)}</div>
      ${isSelected ? `<button type="button" class="prog-phrase-preview-star${isPreview ? ' active' : ''}" title="${isPreview ? 'Preview phrase' : 'Use as preview phrase'}">${isPreview ? '★' : '☆'}</button>` : ''}
    `;
    row.onclick = () => togglePhrase(name);
    const starBtn = row.querySelector('.prog-phrase-preview-star');
    starBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      previewPhraseName = name;
      renderPhrasePicker(document.getElementById('progPhraseSearch').value);
    });
    pickerEl.appendChild(row);
  }
}

function togglePhrase(name) {
  const idx = selectedPhraseNames.indexOf(name);
  if (idx >= 0) {
    selectedPhraseNames.splice(idx, 1);
    if (previewPhraseName === name) previewPhraseName = null; // falls back to new first phrase
  } else {
    selectedPhraseNames.push(name);
  }
  renderPhrasePicker(document.getElementById('progPhraseSearch').value);
}

// Keeps any course(s) already linked to this progression (via progression_id
// — either generated or manually linked from Course Creator) pointed at the
// right preview lesson whenever the preview choice or phrase list changes,
// without requiring a full "Generate Mini-Course" regeneration.
async function syncPreviewLessonForLinkedCourses(progressionId, previewPhraseName) {
  if (!previewPhraseName) return;

  const { data: linkedCourses } = await supabase
    .from('courses')
    .select('id')
    .eq('progression_id', progressionId);
  if (!linkedCourses || linkedCourses.length === 0) return;

  const { data: sections } = await supabase
    .from('sections')
    .select('id, course_id')
    .in('course_id', linkedCourses.map(c => c.id));
  if (!sections || sections.length === 0) return;

  const { data: matchingLessons } = await supabase
    .from('lessons')
    .select('id, section_id')
    .eq('pattern_name', previewPhraseName)
    .in('section_id', sections.map(s => s.id));
  if (!matchingLessons || matchingLessons.length === 0) return;

  const sectionToCourse = new Map(sections.map(s => [s.id, s.course_id]));
  for (const lesson of matchingLessons) {
    const courseId = sectionToCourse.get(lesson.section_id);
    if (!courseId) continue;
    await supabase.from('courses').update({ preview_lesson_id: lesson.id }).eq('id', courseId);
  }
}

async function saveProgression() {
  const name = document.getElementById('progName').value.trim();
  if (!name) {
    await alert('Give this progression a name first.');
    return;
  }

  const level = readLevelField();
  const intendedScale = document.getElementById('progScale').value.trim();
  const category = document.getElementById('progCategory').value.trim();
  const tags = document.getElementById('progTags').value.split(',').map(t => t.trim()).filter(Boolean);
  const previewPhrase = effectivePreviewName();

  try {
    let progressionId = editingProgressionId;

    if (progressionId) {
      const { error } = await supabase
        .from('progressions')
        .update({ name, level, intended_scale: intendedScale, category, tags, preview_phrase_name: previewPhrase, updated_at: new Date().toISOString() })
        .eq('id', progressionId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from('progressions')
        .insert([{ user_id: currentUser.id, name, level, intended_scale: intendedScale, category, tags, preview_phrase_name: previewPhrase }])
        .select().single();
      if (error) throw error;
      progressionId = data.id;
      editingProgressionId = progressionId;
    }

    // Replace phrase rows wholesale — simplest correct approach for a v1 picker.
    const { error: delErr } = await supabase
      .from('progression_phrases')
      .delete()
      .eq('progression_id', progressionId);
    if (delErr) throw delErr;

    if (selectedPhraseNames.length > 0) {
      const rows = selectedPhraseNames.map((phrase_name, position) => ({
        progression_id: progressionId,
        phrase_name,
        position,
      }));
      const { error: insErr } = await supabase.from('progression_phrases').insert(rows);
      if (insErr) throw insErr;
    }

    await syncPreviewLessonForLinkedCourses(progressionId, previewPhrase);

    document.getElementById('progDeleteBtn').style.display = '';
    document.getElementById('progGenerateCourseBtn').style.display = '';
    await refreshList();
    showListView();
  } catch (err) {
    console.error('[Progressions] Save failed:', err);
    await alert('Failed to save progression: ' + err.message);
  }
}

async function deleteProgression() {
  if (!editingProgressionId) return;
  const ok = await confirm('Delete this progression? Its phrase order will be lost (the phrases themselves are untouched).');
  if (!ok) return;

  try {
    const { error } = await supabase.from('progressions').delete().eq('id', editingProgressionId);
    if (error) throw error;
    await refreshList();
    showListView();
  } catch (err) {
    await alert('Failed to delete: ' + err.message);
  }
}

// Generates a single-section Mini-Course snapshotting the progression's
// phrases in order, per the locked reference-at-progression /
// snapshot-at-lesson decision. One lesson per phrase.
async function generateMiniCourse() {
  if (!editingProgressionId || selectedPhraseNames.length === 0) {
    await alert('Add at least one phrase before generating a Mini-Course.');
    return;
  }

  const statusEl = document.getElementById('progGenerateStatus');
  const name = document.getElementById('progName').value.trim() || 'Untitled Progression';
  const level = readLevelField();
  const intendedScale = document.getElementById('progScale').value.trim();
  const category = document.getElementById('progCategory').value.trim();
  const tags = document.getElementById('progTags').value.split(',').map(t => t.trim()).filter(Boolean);
  const previewPhrase = effectivePreviewName();
  statusEl.textContent = 'Generating…';

  try {
    const { data: course, error: cErr } = await supabase
      .from('courses')
      .insert([{
        title: name,
        description: `Generated from progression "${name}"`,
        owner_id: currentUser.id,
        is_published: false,
        progression_id: editingProgressionId,
        level,
        intended_scale: intendedScale,
        category,
        tags,
      }])
      .select().single();
    if (cErr) throw cErr;

    const { data: section, error: sErr } = await supabase
      .from('sections')
      .insert([{ course_id: course.id, title: name, order_index: 0, is_published: false }])
      .select().single();
    if (sErr) throw sErr;

    let previewLessonId = null;

    for (let i = 0; i < selectedPhraseNames.length; i++) {
      const phraseName = selectedPhraseNames[i];
      const patternData = await dbLoadPatternByName(phraseName);

      const { data: lesson, error: lErr } = await supabase.from('lessons').insert([{
        section_id: section.id,
        title: phraseName,
        description: '',
        video_url: '',
        pattern_json: patternData,
        pattern_name: phraseName,
        order_index: i,
      }]).select().single();
      if (lErr) throw lErr;

      if (phraseName === previewPhrase) previewLessonId = lesson.id;
    }

    if (previewLessonId) {
      const { error: pvErr } = await supabase
        .from('courses')
        .update({ preview_lesson_id: previewLessonId })
        .eq('id', course.id);
      if (pvErr) throw pvErr;
    }

    Bus.emit(BUS_EVENT.COURSE_DATA_CHANGED);

    statusEl.textContent = `Created course "${name}" with ${selectedPhraseNames.length} lesson(s). Publish it from Manage Courses when ready.`;
  } catch (err) {
    console.error('[Progressions] Mini-Course generation failed:', err);
    statusEl.textContent = '';
    await alert('Failed to generate Mini-Course: ' + err.message);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
