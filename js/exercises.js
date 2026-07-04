import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';
import { currentProfile } from './profile.js';
import { extractYouTubeId, escapeHtml } from './utils.js';

let exercises = [];
let progressMap = {};
let phrasesList = [];        // { name, data } from patterns table
let activeExercise = null;
let editorExercise = null;   // null = new, object = editing
let editorPatternJson = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
let modal, modalTitle, modalVideo, modalDesc, modalStudioBtn, modalStatusBtns;
let editorModal, editorTitle, editorCategory, editorName, editorDesc,
    editorVideo, editorPhraseInput, editorPhraseDropdown, editorPhraseClearX,
    editorPatternStatus, editorClearPatternBtn, editorDeleteBtn, editorCategoryList;
let selectedPhraseName = null;

function isTeacher() {
  const role = currentProfile?.role;
  return role === 'teacher' || role === 'admin';
}

// ── Init ───────────────────────────────────────────────────────────────────
export function initExercises() {
  // Detail modal
  modal           = document.getElementById('exerciseModal');
  modalTitle      = document.getElementById('exerciseModalTitle');
  modalVideo      = document.getElementById('exerciseModalVideo');
  modalDesc       = document.getElementById('exerciseModalDesc');
  modalStudioBtn  = document.getElementById('exerciseModalStudioBtn');
  modalStatusBtns = document.querySelectorAll('.exercise-modal-status-btn');

  document.getElementById('exerciseModalClose')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  modalStatusBtns.forEach(btn => btn.addEventListener('click', () => handleModalStatusClick(btn.dataset.status)));
  modalStudioBtn?.addEventListener('click', openInStudio);

  // Editor modal
  editorModal           = document.getElementById('exerciseEditorModal');
  editorTitle           = document.getElementById('exerciseEditorTitle');
  editorCategory        = document.getElementById('exEdCategory');
  editorName            = document.getElementById('exEdName');
  editorDesc            = document.getElementById('exEdDesc');
  editorVideo           = document.getElementById('exEdVideo');
  editorPhraseInput     = document.getElementById('exEdPhraseInput');
  editorPhraseDropdown  = document.getElementById('exEdPhraseDropdown');
  editorPhraseClearX    = document.getElementById('exEdPhraseClear');
  editorPatternStatus   = document.getElementById('exEdPatternStatus');
  editorClearPatternBtn = document.getElementById('exEdClearPatternBtn');
  editorDeleteBtn       = document.getElementById('exEdDeleteBtn');
  editorCategoryList    = document.getElementById('exEdCategoryList');

  document.getElementById('exerciseEditorClose')?.addEventListener('click', closeEditor);
  document.getElementById('exEdCancelBtn')?.addEventListener('click', closeEditor);
  editorModal?.addEventListener('click', e => { if (e.target === editorModal) closeEditor(); });
  document.getElementById('exEdSaveBtn')?.addEventListener('click', saveExercise);
  document.getElementById('exEdUseCurrentBtn')?.addEventListener('click', useCurrentPattern);
  editorClearPatternBtn?.addEventListener('click', clearEditorPattern);
  editorDeleteBtn?.addEventListener('click', deleteExercise);

  // Searchable phrase picker
  editorPhraseInput?.addEventListener('input', onPhraseInputChange);
  editorPhraseInput?.addEventListener('focus', () => renderPhraseDropdown(editorPhraseInput.value));
  editorPhraseInput?.addEventListener('keydown', onPhraseKeydown);
  editorPhraseClearX?.addEventListener('click', clearPhraseSearch);
  document.addEventListener('click', e => {
    if (!e.target.closest('#exEdPhraseSearch')) hidePhraseDropdown();
  });

  document.getElementById('addExerciseBtn')?.addEventListener('click', () => openEditor(null));

  window.addEventListener('routeChanged', ({ detail }) => {
    if (detail.route === 'practice') loadPracticeView();
    else { closeModal(); closeEditor(); }
  });
}

// ── Practice view ──────────────────────────────────────────────────────────
async function loadPracticeView() {
  const list = document.getElementById('exercisesList');
  const addBtn = document.getElementById('addExerciseBtn');
  if (!list) return;

  if (addBtn) addBtn.style.display = isTeacher() ? '' : 'none';

  list.innerHTML = '<p class="exercises-loading">Loading…</p>';
  await Promise.all([fetchExercises(), fetchProgress()]);
  renderExercises(list);
}

async function fetchExercises() {
  const { data, error } = await supabase
    .from('exercises')
    .select('id, category, name, description, sort_order, video_url, studio_pattern_json')
    .order('category')
    .order('sort_order');

  if (error) { console.error('[Exercises] fetch error:', error); return; }
  exercises = data || [];
}

async function fetchProgress() {
  if (!currentUser) { progressMap = {}; return; }

  const { data, error } = await supabase
    .from('student_exercise_progress')
    .select('exercise_id, status')
    .eq('user_id', currentUser.id);

  if (error) { console.error('[Exercises] progress fetch error:', error); return; }
  progressMap = Object.fromEntries((data || []).map(r => [r.exercise_id, r.status]));
}

function renderExercises(list) {
  if (!exercises.length) {
    list.innerHTML = '<p class="exercises-loading">No exercises yet.</p>';
    return;
  }

  const categories = [];
  const byCategory = {};
  for (const ex of exercises) {
    if (!byCategory[ex.category]) { byCategory[ex.category] = []; categories.push(ex.category); }
    byCategory[ex.category].push(ex);
  }

  const teacher = isTeacher();

  list.innerHTML = categories.map(cat => `
    <div class="exercises-category">
      <div class="exercises-category-label">${escapeHtml(cat)}</div>
      ${byCategory[cat].map(ex => exerciseCardHTML(ex, teacher)).join('')}
    </div>
  `).join('');

  list.querySelectorAll('.exercise-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.exercise-edit-btn')) return;
      const ex = exercises.find(e => e.id === card.dataset.id);
      if (ex) openModal(ex);
    });
  });

  if (teacher) {
    list.querySelectorAll('.exercise-edit-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const ex = exercises.find(e => e.id === btn.dataset.id);
        if (ex) openEditor(ex);
      });
    });
  }
}

function exerciseCardHTML(ex, teacher) {
  const status = progressMap[ex.id] || null;
  const cardClass = status ? `status-${status}` : '';
  const btnLabel = statusLabel(status);
  const btnClass = status ? `status-${status}` : 'status-none';

  return `
    <div class="exercise-card ${cardClass}" data-id="${ex.id}" role="button" tabindex="0">
      <div class="exercise-card-body">
        <div class="exercise-card-name">${escapeHtml(ex.name)}</div>
        ${ex.description ? `<p class="exercise-card-desc">${escapeHtml(ex.description)}</p>` : ''}
      </div>
      <span class="exercise-status-btn ${btnClass}">${btnLabel}</span>
      ${teacher ? `<button class="exercise-edit-btn" data-id="${ex.id}" title="Edit exercise" aria-label="Edit">✏️</button>` : ''}
    </div>
  `;
}

// ── Detail modal ───────────────────────────────────────────────────────────
function openModal(ex) {
  activeExercise = ex;
  modalTitle.textContent = ex.name;

  modalDesc.textContent = ex.description || '';
  modalDesc.style.display = ex.description ? '' : 'none';

  if (ex.video_url) {
    const ytId = extractYouTubeId(ex.video_url);
    modalVideo.style.display = '';
    modalVideo.innerHTML = ytId
      ? `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}?rel=0" frameborder="0" allowfullscreen></iframe>`
      : `<video src="${escapeHtml(ex.video_url)}" controls playsinline></video>`;
  } else {
    modalVideo.style.display = 'none';
    modalVideo.innerHTML = '';
  }

  modalStudioBtn.style.display = ex.studio_pattern_json ? '' : 'none';
  syncModalStatusButtons(progressMap[ex.id] || null);

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modalVideo.innerHTML = '';
  activeExercise = null;
}

function syncModalStatusButtons(status) {
  modalStatusBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.status === status));
}

async function handleModalStatusClick(targetStatus) {
  if (!currentUser || !activeExercise) return;

  const exerciseId = activeExercise.id;
  const current = progressMap[exerciseId] || null;
  const next = current === targetStatus ? null : targetStatus;

  progressMap[exerciseId] = next;
  syncModalStatusButtons(next);
  updateCardUI(exerciseId, next);

  if (next === null) {
    const { error } = await supabase
      .from('student_exercise_progress')
      .delete()
      .eq('user_id', currentUser.id)
      .eq('exercise_id', exerciseId);

    if (error) {
      console.error('[Exercises] delete error:', error);
      progressMap[exerciseId] = current;
      syncModalStatusButtons(current);
      updateCardUI(exerciseId, current);
    }
  } else {
    const { error } = await supabase
      .from('student_exercise_progress')
      .upsert(
        { user_id: currentUser.id, exercise_id: exerciseId, status: next },
        { onConflict: 'user_id,exercise_id' }
      );

    if (error) {
      console.error('[Exercises] upsert error:', error);
      progressMap[exerciseId] = current;
      syncModalStatusButtons(current);
      updateCardUI(exerciseId, current);
    }
  }
}

async function openInStudio() {
  if (!activeExercise?.studio_pattern_json) return;
  const { applyPattern } = await import('./pattern-crud.js');
  closeModal();
  window.location.hash = '#studio';
  await applyPattern(activeExercise.studio_pattern_json);
}

// ── Editor modal ───────────────────────────────────────────────────────────
async function openEditor(ex) {
  editorExercise = ex;
  editorPatternJson = ex?.studio_pattern_json ?? null;

  editorTitle.textContent = ex ? 'Edit Exercise' : 'Add Exercise';
  editorCategory.value = ex?.category ?? '';
  editorName.value      = ex?.name ?? '';
  editorDesc.value      = ex?.description ?? '';
  editorVideo.value     = ex?.video_url ?? '';

  editorDeleteBtn.style.display = ex ? '' : 'none';
  populateCategoryList();
  await initPhraseSearch(ex?.studio_pattern_json);
  syncEditorPatternUI();

  editorModal.classList.add('open');
  editorModal.setAttribute('aria-hidden', 'false');
  editorName.focus();
}

function closeEditor() {
  editorModal.classList.remove('open');
  editorModal.setAttribute('aria-hidden', 'true');
  editorExercise = null;
  editorPatternJson = null;
}

function populateCategoryList() {
  const cats = [...new Set(exercises.map(e => e.category))];
  editorCategoryList.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

async function loadPhrasesIfNeeded() {
  if (phrasesList.length || !currentUser) return;
  const { data } = await supabase
    .from('patterns')
    .select('name, data')
    .eq('user_id', currentUser.id)
    .not('archived', 'is', true)
    .order('updated_at', { ascending: false });
  phrasesList = data || [];
}

async function initPhraseSearch(currentPatternJson) {
  await loadPhrasesIfNeeded();

  selectedPhraseName = null;
  editorPhraseInput.value = '';
  editorPhraseClearX.style.display = 'none';
  hidePhraseDropdown();

  // Pre-select if pattern matches a library phrase
  if (currentPatternJson) {
    const match = phrasesList.find(p => JSON.stringify(p.data) === JSON.stringify(currentPatternJson));
    if (match) {
      selectedPhraseName = match.name;
      editorPhraseInput.value = match.name;
      editorPhraseClearX.style.display = '';
    }
  }
}

function onPhraseInputChange() {
  selectedPhraseName = null;
  editorPhraseClearX.style.display = editorPhraseInput.value ? '' : 'none';
  renderPhraseDropdown(editorPhraseInput.value);
}

function renderPhraseDropdown(query) {
  const q = query.toLowerCase().trim();
  const filtered = q
    ? phrasesList.filter(p => p.name.toLowerCase().includes(q))
    : phrasesList;

  if (!filtered.length) {
    editorPhraseDropdown.innerHTML = `<div class="ex-ed-phrase-empty">${q ? 'No matches' : 'No phrases in Library'}</div>`;
  } else {
    editorPhraseDropdown.innerHTML = filtered.map(p => `
      <div class="ex-ed-phrase-option${p.name === selectedPhraseName ? ' selected' : ''}"
           data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
    `).join('');

    editorPhraseDropdown.querySelectorAll('.ex-ed-phrase-option').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault(); // keep input focused
        selectPhrase(el.dataset.name);
      });
    });
  }

  editorPhraseDropdown.style.display = '';
}

function hidePhraseDropdown() {
  editorPhraseDropdown.style.display = 'none';
}

function selectPhrase(name) {
  const phrase = phrasesList.find(p => p.name === name);
  if (!phrase) return;

  selectedPhraseName = name;
  editorPhraseInput.value = name;
  editorPhraseClearX.style.display = '';
  hidePhraseDropdown();

  editorPatternJson = phrase.data;
  syncEditorPatternUI();
}

function clearPhraseSearch() {
  selectedPhraseName = null;
  editorPhraseInput.value = '';
  editorPhraseClearX.style.display = 'none';
  hidePhraseDropdown();
}

function onPhraseKeydown(e) {
  if (editorPhraseDropdown.style.display === 'none') return;
  const options = [...editorPhraseDropdown.querySelectorAll('.ex-ed-phrase-option')];
  const focused = editorPhraseDropdown.querySelector('.focused');
  let idx = options.indexOf(focused);

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focused?.classList.remove('focused');
    options[Math.min(idx + 1, options.length - 1)]?.classList.add('focused');
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focused?.classList.remove('focused');
    options[Math.max(idx - 1, 0)]?.classList.add('focused');
  } else if (e.key === 'Enter' && focused) {
    e.preventDefault();
    selectPhrase(focused.dataset.name);
  } else if (e.key === 'Escape') {
    hidePhraseDropdown();
  }
}

function syncEditorPatternUI() {
  if (editorPatternJson) {
    editorPatternStatus.textContent = selectedPhraseName ?? 'Custom pattern';
    editorPatternStatus.style.opacity = '1';
    editorClearPatternBtn.style.display = '';
  } else {
    editorPatternStatus.textContent = 'None';
    editorPatternStatus.style.opacity = '';
    editorClearPatternBtn.style.display = 'none';
  }
}

async function useCurrentPattern() {
  try {
    const { serializePattern } = await import('./pattern-crud.js');
    editorPatternJson = serializePattern();
    syncEditorPatternUI();
  } catch (err) {
    console.error('[Exercises] useCurrentPattern error:', err);
    alert('Could not read current studio pattern.');
  }
}

function clearEditorPattern() {
  editorPatternJson = null;
  clearPhraseSearch();
  syncEditorPatternUI();
}

async function saveExercise() {
  const category = editorCategory.value.trim();
  const name     = editorName.value.trim();
  const desc     = editorDesc.value.trim();
  const videoUrl = editorVideo.value.trim() || null;

  if (!category || !name) {
    alert('Category and Name are required.');
    return;
  }

  const payload = {
    category,
    name,
    description: desc || null,
    video_url: videoUrl,
    studio_pattern_json: editorPatternJson,
  };

  const saveBtn = document.getElementById('exEdSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  let error;
  if (editorExercise) {
    ({ error } = await supabase.from('exercises').update(payload).eq('id', editorExercise.id));
  } else {
    const maxOrder = exercises.filter(e => e.category === category).reduce((m, e) => Math.max(m, e.sort_order), 0);
    ({ error } = await supabase.from('exercises').insert({ ...payload, sort_order: maxOrder + 10 }));
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save';

  if (error) {
    console.error('[Exercises] save error:', error);
    alert('Failed to save. Check the console for details.');
    return;
  }

  closeEditor();
  await fetchExercises();
  const list = document.getElementById('exercisesList');
  if (list) renderExercises(list);
}

async function deleteExercise() {
  if (!editorExercise) return;
  if (!confirm(`Delete "${editorExercise.name}"? This cannot be undone.`)) return;

  const { error } = await supabase.from('exercises').delete().eq('id', editorExercise.id);

  if (error) {
    console.error('[Exercises] delete error:', error);
    alert('Failed to delete.');
    return;
  }

  closeEditor();
  await fetchExercises();
  const list = document.getElementById('exercisesList');
  if (list) renderExercises(list);
}

// ── Card UI sync ───────────────────────────────────────────────────────────
function statusLabel(status) {
  if (status === 'working_on_it') return 'Working on it';
  if (status === 'completed')     return 'Completed ✓';
  return 'Start';
}

function updateCardUI(exerciseId, status) {
  const card  = document.querySelector(`.exercise-card[data-id="${exerciseId}"]`);
  const badge = card?.querySelector('.exercise-status-btn');
  if (!card || !badge) return;

  card.className = `exercise-card${status ? ` status-${status}` : ''}`;
  card.dataset.id = exerciseId;
  badge.className = `exercise-status-btn ${status ? `status-${status}` : 'status-none'}`;
  badge.textContent = statusLabel(status);
}
