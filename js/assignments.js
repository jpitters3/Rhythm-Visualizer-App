/**
 * js/assignments.js
 * Teacher-side assignment management UI.
 * Handles: create/edit assignments, add submission items, assign to students, review submissions.
 */

import { currentUser } from './state.js';
import { Modal } from './modal.js';
import { supabase } from './supabase-client.js';
import { alert, confirm } from './alert.js';
import { escapeHtml } from './utils.js';

// ===== DOM REFS =====
let modal = null;
let asgnPanel = null;

// ===== MODULE STATE =====
let activeTab = 'assignments';
let submissionsLoaded = false;

let assignmentsList = [];
let coursesList = [];
let studentsList = [];

let currentAssignment = null;   // null = new; object with .id = editing existing
let currentItems = [];          // ItemDraft[] — working copy before save
let savedItemIds = [];          // uuids loaded from DB (for delete-orphan diff on save)

let submissionsList = [];
let currentReview = null;
let reviewResponses = [];

// ===== ITEM TYPE META =====
const ITEM_TYPE_ICONS = {
  mark_complete: '✅',
  quiz: '📝',
  audio: '🎙️',
  video: '🎥',
  link: '🔗',
};

const ITEM_TYPE_LABELS = {
  mark_complete: 'Mark Complete',
  quiz: 'Quiz',
  audio: 'Audio Recording',
  video: 'Video Upload',
  link: 'URL / Link',
};

// ===== INIT =====

export function initAssignments() {
  modal = document.getElementById('assignmentsModal');
  asgnPanel = new Modal(modal, { onClose: () => { resetEditor(); submissionsLoaded = false; } });
  if (!modal) return;

  // Close
  document.getElementById('closeAssignmentsModal')
    ?.addEventListener('click', closeAssignments);
  modal.addEventListener('click', e => { if (e.target === modal) closeAssignments(); });

  // Tabs
  modal.querySelectorAll('.asgn-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // New assignment
  document.getElementById('asgnNewBtn')
    ?.addEventListener('click', openNewEditor);

  // Editor close
  document.getElementById('asgnEditorCloseBtn')
    ?.addEventListener('click', closeEditor);

  // Add item
  document.getElementById('asgnAddItemBtn')
    ?.addEventListener('click', () => {
      const sel = document.getElementById('asgnAddItemType');
      if (!sel || !sel.value) return;
      addItem(sel.value);
      sel.value = '';
    });

  // Save / Delete / Assign
  document.getElementById('asgnSaveBtn')
    ?.addEventListener('click', handleSave);
  document.getElementById('asgnDeleteBtn')
    ?.addEventListener('click', handleDelete);
  document.getElementById('asgnAssignBtn')
    ?.addEventListener('click', handleAssign);

  // Review panel
  document.getElementById('asgnMarkReviewedBtn')
    ?.addEventListener('click', handleMarkReviewed);
  document.getElementById('asgnReviewCloseBtn')
    ?.addEventListener('click', closeReviewPanel);

  // Event delegation — items list
  const itemsList = document.getElementById('asgnItemsList');
  itemsList?.addEventListener('click', handleItemsListClick);
  itemsList?.addEventListener('change', handleItemsListChange);
  itemsList?.addEventListener('input', handleItemsListChange);

  // Event delegation — assignment list
  document.getElementById('asgnList')
    ?.addEventListener('click', handleAssignmentListClick);

  // Event delegation — submissions list
  document.getElementById('asgnSubmissionList')
    ?.addEventListener('click', handleSubmissionListClick);
}

export function openAssignments() {
  if (!asgnPanel) return;
  asgnPanel.open();
  switchTab('assignments');
  loadInitialData();
}

function closeAssignments() {
  asgnPanel?.close();
}

function switchTab(tabName) {
  activeTab = tabName;
  modal.querySelectorAll('.asgn-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  modal.querySelectorAll('.asgn-tab-panel').forEach(panel => {
    const isActive = panel.id === `asgnTab-${tabName}`;
    panel.style.display = isActive ? '' : 'none';
  });
  if (tabName === 'submissions' && !submissionsLoaded) {
    submissionsLoaded = true;
    loadSubmissionsList();
  }
}

// ===== DATA LOADING =====

async function loadInitialData() {
  await Promise.all([loadAssignmentsList(), loadCourses(), loadStudents()]);
}

async function loadAssignmentsList() {
  const el = document.getElementById('asgnList');
  if (el) el.innerHTML = '<div class="asgn-loading">Loading…</div>';

  const { data, error } = await supabase
    .from('assignments')
    .select('*, assignment_items(count)')
    .eq('created_by', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Assignments] loadAssignmentsList:', error);
    if (el) el.innerHTML = '<div class="asgn-list-empty">Failed to load assignments.</div>';
    return;
  }

  assignmentsList = (data || []).map(a => ({
    ...a,
    item_count: a.assignment_items?.[0]?.count ?? 0,
  }));
  renderAssignmentsList();
}

async function loadCourses() {
  const { data } = await supabase
    .from('courses')
    .select('id, title')
    .order('title');
  coursesList = data || [];
  populateCourseSelect();
}

async function loadStudents() {
  const { data } = await supabase
    .from('profiles')
    .select('user_id, first_name, last_name, username')
    .eq('role', 'student');
  studentsList = data || [];
}

async function loadItemsForAssignment(assignmentId) {
  const { data, error } = await supabase
    .from('assignment_items')
    .select('*')
    .eq('assignment_id', assignmentId)
    .order('sort_order');
  if (error) {
    console.error('[Assignments] loadItems:', error);
    return [];
  }
  return data || [];
}

async function loadSubmissionsList() {
  const el = document.getElementById('asgnSubmissionList');
  if (el) el.innerHTML = '<div class="asgn-loading">Loading…</div>';

  const { data, error } = await supabase
    .from('student_assignments')
    .select(`
      id, assignment_id, student_id, due_date, status,
      assignments!inner(title),
      profiles!student_id(first_name, last_name, username),
      assignment_submissions(id, submitted_at, reviewed_at, feedback)
    `)
    .eq('assigned_by', currentUser.id)
    .eq('status', 'submitted');

  if (error) {
    console.error('[Assignments] loadSubmissions:', error);
    if (el) el.innerHTML = '<div class="asgn-submission-empty">Failed to load submissions.</div>';
    return;
  }

  submissionsList = (data || []).map(row => ({
    id: row.id,
    assignment_id: row.assignment_id,
    assignment_title: row.assignments?.title ?? 'Untitled',
    student_id: row.student_id,
    student_name: buildName(row.profiles),
    due_date: row.due_date,
    status: row.status,
    submission_id: row.assignment_submissions?.[0]?.id ?? null,
    submitted_at: row.assignment_submissions?.[0]?.submitted_at ?? null,
    reviewed_at: row.assignment_submissions?.[0]?.reviewed_at ?? null,
    feedback: row.assignment_submissions?.[0]?.feedback ?? null,
  }));
  renderSubmissionsList();
}

async function loadExistingAssignees(assignmentId) {
  const { data } = await supabase
    .from('student_assignments')
    .select('student_id, status')
    .eq('assignment_id', assignmentId);
  const map = new Map();
  (data || []).forEach(row => map.set(row.student_id, row.status));
  return map;
}

// ===== RENDERING — ASSIGNMENTS TAB =====

function renderAssignmentsList() {
  const el = document.getElementById('asgnList');
  if (!el) return;

  if (assignmentsList.length === 0) {
    el.innerHTML = '<div class="asgn-list-empty">No assignments yet. Click "+ New Assignment" to create one.</div>';
    return;
  }

  el.innerHTML = '';
  assignmentsList.forEach(a => {
    const item = document.createElement('div');
    item.className = 'asgn-list-item';
    item.dataset.id = a.id;

    const pillClass = a.is_published ? 'published' : 'draft';
    const pillLabel = a.is_published ? 'Published' : 'Draft';
    const itemWord = a.item_count === 1 ? 'item' : 'items';

    item.innerHTML = `
      <span class="asgn-item-title">${escapeHtml(a.title)}</span>
      <span class="asgn-item-meta">${a.item_count} ${itemWord}</span>
      <span class="asgn-status-pill ${pillClass}">${pillLabel}</span>
    `;
    el.appendChild(item);
  });
}

function handleAssignmentListClick(e) {
  const row = e.target.closest('.asgn-list-item');
  if (row?.dataset.id) openEditEditor(row.dataset.id);
}

function renderEditor() {
  const a = currentAssignment;

  document.getElementById('asgnEditorTitle').textContent = a?.id ? 'Edit Assignment' : 'New Assignment';
  document.getElementById('asgnTitle').value = a?.title ?? '';
  document.getElementById('asgnDesc').value = a?.description ?? '';
  document.getElementById('asgnDueDate').value = a?.default_due_date
    ? a.default_due_date.slice(0, 10) : '';
  document.getElementById('asgnPublished').checked = a?.is_published ?? false;

  // Course select
  const courseSelect = document.getElementById('asgnCourseSelect');
  if (courseSelect) courseSelect.value = a?.course_id ?? '';

  // Delete btn
  const deleteBtn = document.getElementById('asgnDeleteBtn');
  if (deleteBtn) deleteBtn.style.display = a?.id ? '' : 'none';

  // Student section
  const studentSection = document.getElementById('asgnStudentSection');
  if (studentSection) {
    if (a?.id) {
      studentSection.style.display = '';
      renderStudentSection(a.id);
    } else {
      studentSection.style.display = 'none';
    }
  }

  renderItemsList();
}

function populateCourseSelect() {
  const sel = document.getElementById('asgnCourseSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— None —</option>';
  coursesList.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.title;
    sel.appendChild(opt);
  });
  if (currentAssignment?.course_id) sel.value = currentAssignment.course_id;
}

function renderItemsList() {
  const el = document.getElementById('asgnItemsList');
  if (!el) return;
  el.innerHTML = '';

  currentItems.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'asgn-item-card';
    card.dataset.idx = idx;

    const icon = ITEM_TYPE_ICONS[item.item_type] ?? '📄';
    const label = ITEM_TYPE_LABELS[item.item_type] ?? item.item_type;
    const reqBadge = item.required
      ? '<span class="asgn-required-badge">Required</span>' : '';

    card.innerHTML = `
      <div class="asgn-item-card-header" data-action="item-toggle">
        <span class="asgn-item-type-icon">${icon}</span>
        <span class="asgn-item-header-title">${escapeHtml(item.title || label)}</span>
        ${reqBadge}
        <div class="asgn-item-actions">
          <button data-action="item-up" title="Move up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button data-action="item-down" title="Move down" ${idx === currentItems.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-action="item-delete" title="Remove">✕</button>
        </div>
      </div>
      <div class="asgn-item-card-body collapsed">
        <div>
          <label class="asgn-label">Title</label>
          <input type="text" data-field="item-title" value="${escapeHtml(item.title)}" placeholder="${label}" />
        </div>
        <div>
          <label class="asgn-label">Instructions (optional)</label>
          <textarea data-field="item-instructions" rows="2" placeholder="What should the student do?">${escapeHtml(item.instructions ?? '')}</textarea>
        </div>
        <label class="asgn-item-required-row">
          <input type="checkbox" data-field="item-required" ${item.required ? 'checked' : ''} />
          Required
        </label>
        ${item.item_type === 'quiz' ? renderQuizBuilderHTML(idx) : ''}
      </div>
    `;
    el.appendChild(card);
  });
}

function renderQuizBuilderHTML(idx) {
  const item = currentItems[idx];
  const questions = item.config?.questions ?? [];

  const questionsHTML = questions.map((q, qIdx) => {
    const optionsHTML = (q.options ?? []).map((opt, oIdx) => `
      <div class="asgn-quiz-option">
        <input type="radio" name="quiz-correct-${idx}-${qIdx}"
          data-field="quiz-option-correct"
          data-qidx="${qIdx}" data-oidx="${oIdx}"
          ${opt.correct ? 'checked' : ''} />
        <input type="text" data-field="quiz-option-text"
          data-qidx="${qIdx}" data-oidx="${oIdx}"
          value="${escapeHtml(opt.text ?? '')}" placeholder="Option ${oIdx + 1}" />
        <button class="asgn-quiz-option-del"
          data-action="quiz-delete-option"
          data-qidx="${qIdx}" data-oidx="${oIdx}" title="Remove option">✕</button>
      </div>
    `).join('');

    return `
      <div class="asgn-quiz-question" data-qidx="${qIdx}">
        <div class="asgn-quiz-question-header">
          <span class="asgn-quiz-question-num">Q${qIdx + 1}</span>
          <input type="text" data-field="quiz-question-text" data-qidx="${qIdx}"
            value="${escapeHtml(q.text ?? '')}" placeholder="Question text" />
          <button class="asgn-quiz-question-del"
            data-action="quiz-delete-question" data-qidx="${qIdx}" title="Remove question">✕</button>
        </div>
        <div class="asgn-quiz-options">${optionsHTML}</div>
        <div class="asgn-quiz-actions">
          <button class="asgn-quiz-add-btn" data-action="quiz-add-option" data-qidx="${qIdx}">+ Add Option</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="asgn-quiz-builder">
      <div class="asgn-section-heading" style="margin-top:0;">Questions</div>
      ${questionsHTML}
      <div class="asgn-quiz-add-question-row">
        <button class="asgn-quiz-add-btn" data-action="quiz-add-question">+ Add Question</button>
      </div>
    </div>
  `;
}

async function renderStudentSection(assignmentId) {
  const el = document.getElementById('asgnStudentList');
  if (!el) return;

  el.innerHTML = '<div class="asgn-loading">Loading students…</div>';
  const existingMap = await loadExistingAssignees(assignmentId);

  if (studentsList.length === 0) {
    el.innerHTML = '<div class="asgn-no-students">No students found. Make sure student profiles have role = \'student\'.</div>';
    return;
  }

  el.innerHTML = '';
  studentsList.forEach(s => {
    const name = buildName(s);
    const existingStatus = existingMap.get(s.user_id);
    const badgeHTML = existingStatus
      ? `<span class="asgn-already-badge asgn-status-pill ${existingStatus}">${existingStatus}</span>`
      : '';

    const row = document.createElement('label');
    row.className = 'asgn-student-row';
    row.innerHTML = `
      <input type="checkbox" data-student-id="${s.user_id}"
        ${existingStatus ? 'checked disabled' : ''} />
      <span class="asgn-student-name">${escapeHtml(name)}</span>
      ${badgeHTML}
    `;
    el.appendChild(row);
  });
}

// ===== RENDERING — SUBMISSIONS TAB =====

function renderSubmissionsList() {
  const el = document.getElementById('asgnSubmissionList');
  if (!el) return;

  if (submissionsList.length === 0) {
    el.innerHTML = '<div class="asgn-submission-empty">No submissions yet.</div>';
    return;
  }

  el.innerHTML = '';
  submissionsList.forEach(row => {
    const el2 = document.createElement('div');
    el2.className = 'asgn-submission-row';
    el2.dataset.id = row.id;

    const dateStr = row.submitted_at
      ? new Date(row.submitted_at).toLocaleDateString() : '—';

    el2.innerHTML = `
      <span class="asgn-sub-student">${escapeHtml(row.student_name)}</span>
      <span class="asgn-sub-assignment">${escapeHtml(row.assignment_title)}</span>
      <span class="asgn-sub-date">${dateStr}</span>
    `;
    el.appendChild(el2);
  });
}

function handleSubmissionListClick(e) {
  const row = e.target.closest('.asgn-submission-row');
  if (!row) return;
  const data = submissionsList.find(s => s.id === row.dataset.id);
  if (data) openReviewPanel(data);
}

async function openReviewPanel(submissionRow) {
  currentReview = submissionRow;

  const titleEl = document.getElementById('asgnReviewTitle');
  if (titleEl) titleEl.textContent = `Review: ${submissionRow.student_name}`;

  const feedbackEl = document.getElementById('asgnFeedback');
  if (feedbackEl) feedbackEl.value = submissionRow.feedback ?? '';

  const body = document.getElementById('asgnReviewBody');
  if (body) body.innerHTML = '<div class="asgn-loading">Loading responses…</div>';

  const panel = document.getElementById('asgnReviewPanel');
  if (panel) panel.style.display = '';

  if (!submissionRow.submission_id) {
    if (body) body.innerHTML = '<div class="asgn-loading">No submission data found.</div>';
    return;
  }

  const { data, error } = await supabase
    .from('submission_item_responses')
    .select('*, assignment_items(item_type, title, config)')
    .eq('submission_id', submissionRow.submission_id);

  if (error) {
    console.error('[Assignments] loadResponses:', error);
    if (body) body.innerHTML = '<div class="asgn-loading">Failed to load responses.</div>';
    return;
  }

  reviewResponses = data || [];
  renderReviewPanel();
}

function renderReviewPanel() {
  const body = document.getElementById('asgnReviewBody');
  if (!body) return;
  body.innerHTML = '';

  if (reviewResponses.length === 0) {
    body.innerHTML = '<div class="asgn-loading" style="opacity:0.5">No responses recorded yet.</div>';
    return;
  }

  reviewResponses.forEach(resp => {
    const itemType = resp.assignment_items?.item_type ?? 'mark_complete';
    const itemTitle = resp.assignment_items?.title ?? 'Item';
    const icon = ITEM_TYPE_ICONS[itemType] ?? '📄';
    const responseData = resp.response_data ?? {};

    let responseHTML = '';
    switch (itemType) {
      case 'mark_complete':
        responseHTML = '<span class="asgn-mark-complete-check">✅ Marked complete</span>';
        break;
      case 'audio': {
        if (responseData.storage_path) {
          responseHTML = `<audio controls src="${escapeHtml(responseData.public_url ?? '')}"></audio>
            <div style="font-size:11px;opacity:0.5;margin-top:4px;">${responseData.storage_path}</div>`;
        } else {
          responseHTML = '<em style="opacity:0.5">No audio uploaded.</em>';
        }
        break;
      }
      case 'video':
      case 'link': {
        const url = responseData.url ?? responseData.storage_path ?? '';
        const label = responseData.label ?? url;
        responseHTML = url
          ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`
          : '<em style="opacity:0.5">No link provided.</em>';
        break;
      }
      case 'quiz': {
        const score = responseData.score ?? null;
        const passed = responseData.passed;
        const answers = responseData.answers ?? {};
        const questions = resp.assignment_items?.config?.questions ?? [];

        const scoreHTML = score !== null
          ? `<div class="asgn-quiz-score">Score: ${score}% — ${passed ? '✅ Passed' : '❌ Did not pass'}</div>`
          : '';

        const answersHTML = questions.map(q => {
          const chosen = answers[q.id];
          const chosenOpt = (q.options ?? []).find(o => o.id === chosen);
          const correctOpt = (q.options ?? []).find(o => o.correct);
          const isCorrect = chosen === correctOpt?.id;
          const cls = isCorrect ? 'asgn-quiz-answer-correct' : 'asgn-quiz-answer-wrong';
          return `<div class="asgn-quiz-answer-row">
            <span>${escapeHtml(q.text ?? '')}</span>
            <span class="${cls}">${escapeHtml(chosenOpt?.label ?? chosen ?? '—')}</span>
          </div>`;
        }).join('');

        responseHTML = `${scoreHTML}<div class="asgn-quiz-answers">${answersHTML}</div>`;
        break;
      }
    }

    const block = document.createElement('div');
    block.className = 'asgn-review-item';
    block.innerHTML = `
      <div class="asgn-review-item-header">
        <span class="asgn-review-item-type-icon">${icon}</span>
        <span class="asgn-review-item-title">${escapeHtml(itemTitle)}</span>
      </div>
      <div class="asgn-review-response">${responseHTML}</div>
    `;
    body.appendChild(block);
  });
}

function closeReviewPanel() {
  const panel = document.getElementById('asgnReviewPanel');
  if (panel) panel.style.display = 'none';
  currentReview = null;
  reviewResponses = [];
}

// ===== EDITOR ACTIONS =====

function openNewEditor() {
  currentAssignment = null;
  currentItems = [];
  savedItemIds = [];
  resetEditor();
  renderEditor();
  document.getElementById('asgnEditor').style.display = '';
}

async function openEditEditor(assignmentId) {
  const a = assignmentsList.find(x => x.id === assignmentId);
  if (!a) return;
  currentAssignment = { ...a };
  const items = await loadItemsForAssignment(assignmentId);
  currentItems = items.map(it => ({ ...it }));
  savedItemIds = items.map(it => it.id);
  renderEditor();
  document.getElementById('asgnEditor').style.display = '';
  document.getElementById('asgnEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetEditor() {
  const editor = document.getElementById('asgnEditor');
  if (editor) editor.style.display = 'none';
  currentAssignment = null;
  currentItems = [];
  savedItemIds = [];
  closeReviewPanel();
}

function closeEditor() {
  resetEditor();
}

function addItem(itemType) {
  currentItems.push({
    id: null,
    item_type: itemType,
    title: '',
    instructions: '',
    sort_order: currentItems.length,
    required: true,
    config: itemType === 'quiz' ? { questions: [] } : {},
  });
  renderItemsList();
}

function removeItem(idx) {
  currentItems.splice(idx, 1);
  currentItems.forEach((it, i) => { it.sort_order = i; });
  renderItemsList();
}

function moveItem(idx, dir) {
  const target = idx + dir;
  if (target < 0 || target >= currentItems.length) return;
  [currentItems[idx], currentItems[target]] = [currentItems[target], currentItems[idx]];
  currentItems.forEach((it, i) => { it.sort_order = i; });
  renderItemsList();
}

// ===== QUIZ HELPERS =====

function addQuizQuestion(itemIdx) {
  const item = currentItems[itemIdx];
  if (!item.config) item.config = { questions: [] };
  if (!item.config.questions) item.config.questions = [];
  item.config.questions.push({ id: `q${Date.now()}`, text: '', options: [] });
  renderItemsList();
}

function removeQuizQuestion(itemIdx, qIdx) {
  currentItems[itemIdx].config.questions.splice(qIdx, 1);
  renderItemsList();
}

function addQuizOption(itemIdx, qIdx) {
  const q = currentItems[itemIdx].config.questions[qIdx];
  if (!q.options) q.options = [];
  q.options.push({ id: `o${Date.now()}`, label: '', correct: false });
  renderItemsList();
}

function removeQuizOption(itemIdx, qIdx, oIdx) {
  currentItems[itemIdx].config.questions[qIdx].options.splice(oIdx, 1);
  renderItemsList();
}

// ===== EVENT DELEGATION — ITEMS LIST =====

function handleItemsListClick(e) {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  const card = e.target.closest('.asgn-item-card');
  const idx = card ? parseInt(card.dataset.idx, 10) : -1;

  switch (action) {
    case 'item-toggle': {
      const body = card.querySelector('.asgn-item-card-body');
      if (body) body.classList.toggle('collapsed');
      break;
    }
    case 'item-up':     moveItem(idx, -1); break;
    case 'item-down':   moveItem(idx, +1); break;
    case 'item-delete': removeItem(idx);   break;
    case 'quiz-add-question': addQuizQuestion(idx); break;
    case 'quiz-delete-question': {
      const qIdx = parseInt(e.target.closest('[data-action]').dataset.qidx, 10);
      removeQuizQuestion(idx, qIdx);
      break;
    }
    case 'quiz-add-option': {
      const qIdx = parseInt(e.target.closest('[data-action]').dataset.qidx, 10);
      addQuizOption(idx, qIdx);
      break;
    }
    case 'quiz-delete-option': {
      const el = e.target.closest('[data-action]');
      const qIdx = parseInt(el.dataset.qidx, 10);
      const oIdx = parseInt(el.dataset.oidx, 10);
      removeQuizOption(idx, qIdx, oIdx);
      break;
    }
  }
}

function handleItemsListChange(e) {
  const field = e.target.dataset.field;
  if (!field) return;

  const card = e.target.closest('.asgn-item-card');
  if (!card) return;
  const idx = parseInt(card.dataset.idx, 10);
  const item = currentItems[idx];
  if (!item) return;

  switch (field) {
    case 'item-title':
      item.title = e.target.value;
      // Update header preview
      const headerTitle = card.querySelector('.asgn-item-header-title');
      if (headerTitle) headerTitle.textContent = e.target.value || ITEM_TYPE_LABELS[item.item_type];
      break;
    case 'item-instructions':
      item.instructions = e.target.value;
      break;
    case 'item-required':
      item.required = e.target.checked;
      break;
    case 'quiz-question-text': {
      const qIdx = parseInt(e.target.dataset.qidx, 10);
      item.config.questions[qIdx].text = e.target.value;
      break;
    }
    case 'quiz-option-text': {
      const qIdx = parseInt(e.target.dataset.qidx, 10);
      const oIdx = parseInt(e.target.dataset.oidx, 10);
      item.config.questions[qIdx].options[oIdx].label = e.target.value;
      break;
    }
    case 'quiz-option-correct': {
      const qIdx = parseInt(e.target.dataset.qidx, 10);
      const oIdx = parseInt(e.target.dataset.oidx, 10);
      // Only one option can be correct per question
      item.config.questions[qIdx].options.forEach((o, i) => {
        o.correct = i === oIdx;
      });
      break;
    }
  }
}

// ===== SAVE =====

async function handleSave() {
  const title = document.getElementById('asgnTitle')?.value.trim();
  if (!title) {
    await alert('Please enter a title for the assignment.');
    return;
  }

  const saveBtn = document.getElementById('asgnSaveBtn');
  if (saveBtn) saveBtn.disabled = true;

  // Validate quiz items
  for (const item of currentItems) {
    if (item.item_type === 'quiz') {
      const qs = item.config?.questions ?? [];
      if (qs.length === 0) {
        await alert(`Quiz item "${item.title || 'Quiz'}" needs at least one question.`);
        if (saveBtn) saveBtn.disabled = false;
        return;
      }
      for (const q of qs) {
        if (!q.options?.some(o => o.correct)) {
          await alert(`Question "${q.text || '(untitled)'}" needs a correct answer marked.`);
          if (saveBtn) saveBtn.disabled = false;
          return;
        }
      }
    }
  }

  const payload = {
    title,
    description: document.getElementById('asgnDesc')?.value.trim() ?? '',
    course_id: document.getElementById('asgnCourseSelect')?.value || null,
    default_due_date: document.getElementById('asgnDueDate')?.value || null,
    is_published: document.getElementById('asgnPublished')?.checked ?? false,
    created_by: currentUser.id,
  };
  if (currentAssignment?.id) payload.id = currentAssignment.id;

  const { data: saved, error: saveErr } = await supabase
    .from('assignments')
    .upsert(payload)
    .select()
    .single();

  if (saveErr) {
    console.error('[Assignments] save error:', saveErr);
    await alert('Failed to save assignment: ' + saveErr.message);
    if (saveBtn) saveBtn.disabled = false;
    return;
  }

  currentAssignment = { ...saved, item_count: currentItems.length };

  // Sync items
  const assignmentId = saved.id;

  // Delete removed items
  const currentIds = currentItems.filter(it => it.id).map(it => it.id);
  const removedIds = savedItemIds.filter(id => !currentIds.includes(id));
  if (removedIds.length) {
    await supabase.from('assignment_items').delete().in('id', removedIds);
  }

  // Upsert all items
  if (currentItems.length > 0) {
    const itemsPayload = currentItems.map((item, i) => {
      const row = {
        assignment_id: assignmentId,
        item_type: item.item_type,
        title: item.title,
        instructions: item.instructions,
        sort_order: i,
        required: item.required,
        config: item.config,
      };
      if (item.id) row.id = item.id;
      return row;
    });

    const { data: savedItems, error: itemsErr } = await supabase
      .from('assignment_items')
      .upsert(itemsPayload)
      .select('id');

    if (itemsErr) {
      console.error('[Assignments] items save error:', itemsErr);
    } else {
      // Update local ids
      savedItems?.forEach((si, i) => {
        if (currentItems[i]) currentItems[i].id = si.id;
      });
      savedItemIds = currentItems.map(it => it.id).filter(Boolean);
    }
  } else {
    savedItemIds = [];
  }

  // Update list
  const existingIdx = assignmentsList.findIndex(a => a.id === assignmentId);
  if (existingIdx >= 0) {
    assignmentsList[existingIdx] = currentAssignment;
  } else {
    assignmentsList.unshift(currentAssignment);
  }
  renderAssignmentsList();
  renderEditor();

  // Flash save status
  const statusEl = document.getElementById('asgnSaveStatus');
  if (statusEl) {
    statusEl.textContent = 'Saved!';
    statusEl.style.opacity = '1';
    setTimeout(() => { statusEl.style.opacity = '0'; }, 2500);
  }

  if (saveBtn) saveBtn.disabled = false;
}

// ===== DELETE =====

async function handleDelete() {
  if (!currentAssignment?.id) return;
  const confirmed = await confirm(`Delete assignment "${currentAssignment.title}"? This cannot be undone.`);
  if (!confirmed) return;

  const { error } = await supabase
    .from('assignments')
    .delete()
    .eq('id', currentAssignment.id);

  if (error) {
    console.error('[Assignments] delete error:', error);
    await alert('Failed to delete: ' + error.message);
    return;
  }

  assignmentsList = assignmentsList.filter(a => a.id !== currentAssignment.id);
  renderAssignmentsList();
  resetEditor();
}

// ===== ASSIGN TO STUDENTS =====

async function handleAssign() {
  if (!currentAssignment?.id) return;

  const checked = [...document.querySelectorAll('#asgnStudentList [data-student-id]:checked:not(:disabled)')];
  if (checked.length === 0) {
    await alert('Select at least one student to assign.');
    return;
  }

  const rows = checked.map(cb => ({
    assignment_id: currentAssignment.id,
    student_id: cb.dataset.studentId,
    assigned_by: currentUser.id,
    due_date: currentAssignment.default_due_date || null,
    status: 'pending',
  }));

  const { error } = await supabase
    .from('student_assignments')
    .upsert(rows, { onConflict: 'assignment_id,student_id', ignoreDuplicates: true });

  if (error) {
    console.error('[Assignments] assign error:', error);
    await alert('Failed to assign: ' + error.message);
    return;
  }

  const assignBtn = document.getElementById('asgnAssignBtn');
  if (assignBtn) {
    const orig = assignBtn.textContent;
    assignBtn.textContent = '✅ Assigned!';
    setTimeout(() => { assignBtn.textContent = orig; }, 2000);
  }

  // Refresh student section to show updated badges
  renderStudentSection(currentAssignment.id);
}

// ===== MARK REVIEWED =====

async function handleMarkReviewed() {
  if (!currentReview) return;

  const feedback = document.getElementById('asgnFeedback')?.value.trim() ?? '';

  if (!currentReview.submission_id) {
    await alert('No submission record found for this student assignment.');
    return;
  }

  const now = new Date().toISOString();

  const [subRes, saRes] = await Promise.all([
    supabase.from('assignment_submissions')
      .update({ reviewed_at: now, reviewed_by: currentUser.id, feedback })
      .eq('id', currentReview.submission_id),
    supabase.from('student_assignments')
      .update({ status: 'reviewed' })
      .eq('id', currentReview.id),
  ]);

  if (subRes.error || saRes.error) {
    console.error('[Assignments] markReviewed error:', subRes.error || saRes.error);
    await alert('Failed to mark as reviewed.');
    return;
  }

  closeReviewPanel();
  submissionsLoaded = false;
  loadSubmissionsList();
}

// ===== UTILITIES =====

function buildName(profile) {
  if (!profile) return 'Unknown';
  const full = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
  return full || profile.username || 'Unknown';
}
