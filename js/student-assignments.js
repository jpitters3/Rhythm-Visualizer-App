/**
 * js/student-assignments.js
 * Student-side assignment inbox and submission flow.
 * Handles: viewing assigned assignments, completing items, saving progress, and submitting.
 */

import { currentUser } from './state.js';
import { currentProfile } from './profile.js';
import { supabase } from './supabase-client.js';
import { Modal } from './modal.js';
import { alert, confirm } from './alert.js';
import { escapeHtml } from './utils.js';
import { Bus, BUS_EVENT } from './bus.js';

// ===== CONSTANTS =====

const ITEM_TYPE_ICONS = {
  mark_complete: '✅',
  quiz: '📝',
  audio: '🎙️',
  video: '🎥',
  link: '🔗',
};

// ===== STATE =====

let modal = null;
let inboxPanel = null;
let myAssignments = [];
let currentSA = null;         // active student_assignment row
let currentItems = [];        // assignment_items for currentSA
let currentSubmission = null; // assignment_submissions row (null if not yet started)
let currentResponses = new Map(); // item_id → response_data object

// ===== INIT =====

export function initStudentAssignments() {
  modal = document.getElementById('studentAssignmentsModal');
  if (!modal) return;

  inboxPanel = new Modal(modal, { onClose: resetState });

  document.getElementById('closeStudentAssignmentsModal')
    ?.addEventListener('click', () => inboxPanel?.close());
  modal.addEventListener('click', e => { if (e.target === modal) inboxPanel?.close(); });

  document.getElementById('studentInboxBackBtn')
    ?.addEventListener('click', closeDetail);

  document.getElementById('studentInboxSaveBtn')
    ?.addEventListener('click', () => saveResponses(false));

  document.getElementById('studentInboxSubmitBtn')
    ?.addEventListener('click', handleSubmit);

  document.getElementById('studentInboxList')
    ?.addEventListener('click', handleListClick);

  const itemsList = document.getElementById('studentInboxItemsList');
  itemsList?.addEventListener('click', handleItemsClick);
  itemsList?.addEventListener('change', handleItemsChange);
  itemsList?.addEventListener('input', handleItemsChange);

  Bus.on(BUS_EVENT.AUTH_LOGIN, () => {
    if (currentProfile?.role === 'student') {
      showStudentButton();
    }
  });

  Bus.on(BUS_EVENT.AUTH_LOGOUT, () => {
    myAssignments = [];
    resetState();
    hideStudentButton();
  });

  Bus.on(BUS_EVENT.OPEN_STUDENT_ASSIGNMENTS, () => {
    if (currentProfile?.role === 'student') openStudentAssignments();
  });

  // AUTH_LOGIN may have already fired before this module initialized
  if (currentProfile?.role === 'student') {
    showStudentButton();
  }
}

export function openStudentAssignments() {
  if (!inboxPanel) return;
  inboxPanel.open();
  loadAssignments();
  showListView();
}

// ===== DROPDOWN BUTTON =====

function showStudentButton() {
  const btn = document.getElementById('myAssignmentsBtn');
  if (!btn) return;
  btn.style.display = '';
  btn.onclick = openStudentAssignments;
}

function hideStudentButton() {
  const btn = document.getElementById('myAssignmentsBtn');
  if (btn) btn.style.display = 'none';
}

// ===== LOAD =====

async function loadAssignments() {
  const el = document.getElementById('studentInboxList');
  if (el) el.innerHTML = '<div class="student-inbox-loading">Loading…</div>';
  if (!currentUser) return;

  const { data, error } = await supabase
    .from('student_assignments')
    .select(`
      id, assignment_id, status, due_date, assigned_at, assigned_by,
      assignments(id, title, description, is_published),
      assignment_submissions(id, submitted_at, reviewed_at, feedback)
    `)
    .eq('student_id', currentUser.id)
    .order('assigned_at', { ascending: false });

  if (error) {
    console.error('[StudentAssignments] load error:', error);
    if (el) el.innerHTML = '<div class="student-inbox-empty">Failed to load assignments.</div>';
    return;
  }

  myAssignments = (data || [])
    .filter(row => row.assignments?.is_published)
    .map(row => ({
      id: row.id,
      assignment_id: row.assignment_id,
      status: row.status,
      due_date: row.due_date,
      assigned_at: row.assigned_at,
      assigned_by: row.assigned_by,
      title: row.assignments?.title ?? 'Untitled',
      description: row.assignments?.description ?? '',
      submission: row.assignment_submissions ?? null,
    }));

  renderList();
}

// ===== RENDER LIST =====

function renderList() {
  const el = document.getElementById('studentInboxList');
  if (!el) return;

  if (myAssignments.length === 0) {
    el.innerHTML = '<div class="student-inbox-empty">No assignments yet. Your teacher will send assignments here.</div>';
    return;
  }

  el.innerHTML = '';
  myAssignments.forEach(sa => {
    const item = document.createElement('div');
    item.className = 'student-inbox-item';
    item.dataset.id = sa.id;

    const dueStr = sa.due_date
      ? `Due ${new Date(sa.due_date).toLocaleDateString()}` : '';

    const STATUS_LABELS = {
      pending: 'New',
      in_progress: 'In Progress',
      submitted: 'Submitted',
      sent_back: 'Sent back',
      reviewed: 'Complete',
    };
    const statusLabel = STATUS_LABELS[sa.status] ?? sa.status;

    item.innerHTML = `
      <div class="student-inbox-item-main">
        <span class="student-inbox-item-title">${escapeHtml(sa.title)}</span>
        ${dueStr ? `<span class="student-inbox-item-due">${dueStr}</span>` : ''}
      </div>
      <div class="student-inbox-item-right">
        ${sa.submission?.feedback ? '<span class="student-inbox-feedback-dot" title="Teacher left feedback">💬</span>' : ''}
        <span class="student-inbox-status-pill ${sa.status}">${statusLabel}</span>
        <span class="student-inbox-arrow">›</span>
      </div>
    `;
    el.appendChild(item);
  });
}

function handleListClick(e) {
  const item = e.target.closest('.student-inbox-item');
  if (!item?.dataset.id) return;
  const sa = myAssignments.find(x => x.id === item.dataset.id);
  if (sa) openDetail(sa);
}

// ===== DETAIL VIEW =====

async function openDetail(sa) {
  currentSA = sa;
  currentItems = [];
  currentResponses = new Map();
  currentSubmission = sa.submission ?? null;

  showDetailView();

  document.getElementById('studentInboxDetailTitle').textContent = sa.title;
  const descEl = document.getElementById('studentInboxDetailDesc');
  if (descEl) {
    descEl.textContent = sa.description || '';
    descEl.style.display = sa.description ? '' : 'none';
  }

  const itemsEl = document.getElementById('studentInboxItemsList');
  if (itemsEl) itemsEl.innerHTML = '<div class="student-inbox-loading">Loading…</div>';

  // Load items
  const { data: items, error: itemsErr } = await supabase
    .from('assignment_items')
    .select('*')
    .eq('assignment_id', sa.assignment_id)
    .order('sort_order');

  if (itemsErr) {
    if (itemsEl) itemsEl.innerHTML = '<div class="student-inbox-empty">Failed to load items.</div>';
    return;
  }

  currentItems = items || [];

  // Load existing responses
  if (currentSubmission?.id) {
    const { data: responses } = await supabase
      .from('submission_item_responses')
      .select('item_id, response_data')
      .eq('submission_id', currentSubmission.id);

    (responses || []).forEach(r => {
      currentResponses.set(r.item_id, r.response_data ?? {});
    });
  }

  renderDetail();
}

function renderDetail() {
  const itemsEl = document.getElementById('studentInboxItemsList');
  if (!itemsEl) return;

  const isLocked = currentSA?.status === 'submitted' || currentSA?.status === 'reviewed';

  itemsEl.innerHTML = '';
  currentItems.forEach(item => {
    const icon = ITEM_TYPE_ICONS[item.item_type] ?? '📄';
    const responseData = currentResponses.get(item.id) ?? {};

    const block = document.createElement('div');
    block.className = 'student-inbox-item-block';
    block.dataset.itemId = item.id;
    block.dataset.itemType = item.item_type;

    block.innerHTML = `
      <div class="student-inbox-item-block-header">
        <span class="student-inbox-item-type-icon">${icon}</span>
        <span class="student-inbox-item-block-title">${escapeHtml(item.title)}</span>
        ${item.required ? '<span class="student-inbox-required">Required</span>' : ''}
      </div>
      ${item.instructions
        ? `<div class="student-inbox-item-instructions">${escapeHtml(item.instructions)}</div>`
        : ''}
      <div class="student-inbox-item-response-area" data-item-id="${item.id}">
        ${renderItemResponse(item, responseData, isLocked)}
      </div>
    `;
    itemsEl.appendChild(block);
  });

  // Teacher feedback
  const feedbackSection = document.getElementById('studentInboxFeedbackSection');
  const feedback = currentSA?.submission?.feedback;
  if (feedbackSection) {
    feedbackSection.style.display = feedback ? '' : 'none';
    const feedbackText = document.getElementById('studentInboxFeedbackText');
    if (feedbackText) feedbackText.textContent = feedback ?? '';
  }

  // Footer buttons
  const saveBtn = document.getElementById('studentInboxSaveBtn');
  const submitBtn = document.getElementById('studentInboxSubmitBtn');
  if (saveBtn) saveBtn.style.display = isLocked ? 'none' : '';
  if (submitBtn) {
    submitBtn.style.display = isLocked ? 'none' : '';
    if (!isLocked) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Assignment'; }
  }
  const statusEl = document.getElementById('studentInboxSaveStatus');
  if (statusEl) { statusEl.textContent = ''; statusEl.style.opacity = '0'; }
}

function renderItemResponse(item, responseData, isLocked) {
  const disabled = isLocked ? 'disabled' : '';

  switch (item.item_type) {
    case 'mark_complete': {
      const checked = responseData.completed ? 'checked' : '';
      return `
        <label class="student-inbox-mark-complete-label">
          <input type="checkbox" data-field="mark_complete" ${checked} ${disabled} />
          <span>${responseData.completed ? '✅ Marked as done' : 'Mark as completed'}</span>
        </label>
      `;
    }

    case 'quiz': {
      const questions = item.config?.questions ?? [];
      if (questions.length === 0) return '<em class="student-inbox-empty-note">No questions configured.</em>';
      return questions.map((q, qi) => {
        const opts = (q.options ?? []).map(opt => {
          const selected = responseData.answers?.[q.id] === opt.id ? 'checked' : '';
          return `
            <label class="student-inbox-quiz-option">
              <input type="radio" name="quiz-${item.id}-${qi}" value="${escapeHtml(opt.id)}"
                data-field="quiz-answer" data-question-id="${escapeHtml(q.id)}"
                ${selected} ${disabled} />
              <span>${escapeHtml(opt.label ?? opt.text ?? '')}</span>
            </label>
          `;
        }).join('');
        return `
          <div class="student-inbox-quiz-question">
            <div class="student-inbox-quiz-q-text">${escapeHtml(q.text ?? q.prompt ?? '')}</div>
            <div class="student-inbox-quiz-options">${opts}</div>
          </div>
        `;
      }).join('');
    }

    case 'audio':
    case 'video': {
      const existingPath = responseData.storage_path;
      const accept = item.item_type === 'audio' ? 'audio/*' : 'video/*';
      const existingHTML = existingPath
        ? `<div class="student-inbox-existing-file">📎 ${escapeHtml(existingPath.split('/').pop())}</div>`
        : '';
      const uploadHTML = !isLocked
        ? `<input type="file" class="student-inbox-file-input" data-field="file" accept="${accept}" />
           <div class="student-inbox-file-hint">Upload a ${item.item_type} file${existingPath ? ' to replace' : ''}</div>`
        : '';
      return existingHTML + uploadHTML;
    }

    case 'link': {
      const value = escapeHtml(responseData.url ?? '');
      return `
        <input type="url" class="student-inbox-url-input" data-field="link-url"
          value="${value}" placeholder="https://…" ${disabled} />
      `;
    }

    default:
      return '';
  }
}

// ===== ITEM RESPONSE EVENTS =====

function handleItemsClick(e) {
  if (!e.target.matches('[data-field="mark_complete"]')) return;
  const area = e.target.closest('[data-item-id]');
  if (!area) return;
  const itemId = area.dataset.itemId;
  const existing = currentResponses.get(itemId) ?? {};
  const checked = e.target.checked;
  currentResponses.set(itemId, { ...existing, completed: checked });
  const span = e.target.nextElementSibling;
  if (span) span.textContent = checked ? '✅ Marked as done' : 'Mark as completed';
}

function handleItemsChange(e) {
  const field = e.target.dataset.field;
  if (!field) return;
  const area = e.target.closest('[data-item-id]');
  if (!area) return;
  const itemId = area.dataset.itemId;
  const existing = currentResponses.get(itemId) ?? {};

  if (field === 'quiz-answer') {
    const questionId = e.target.dataset.questionId;
    const answers = { ...(existing.answers ?? {}), [questionId]: e.target.value };
    currentResponses.set(itemId, { ...existing, answers });
  } else if (field === 'link-url') {
    currentResponses.set(itemId, { ...existing, url: e.target.value });
  } else if (field === 'file') {
    const file = e.target.files?.[0];
    if (!file) return;
    const itemType = currentItems.find(i => i.id === itemId)?.item_type;
    const maxBytes = itemType === 'video' ? 50 * 1024 * 1024 : 25 * 1024 * 1024;
    const maxLabel = itemType === 'video' ? '50 MB' : '25 MB';
    if (file.size > maxBytes) {
      alert(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size for ${itemType} is ${maxLabel}.`);
      e.target.value = '';
      return;
    }
    currentResponses.set(itemId, { ...existing, _pendingFile: file });
  }
}

// ===== SUBMIT =====

async function handleSubmit() {
  // Validate required items
  for (const item of currentItems) {
    if (!item.required) continue;
    const resp = currentResponses.get(item.id) ?? {};

    let missing = false;
    switch (item.item_type) {
      case 'mark_complete':
        missing = !resp.completed;
        break;
      case 'quiz': {
        const questions = item.config?.questions ?? [];
        missing = questions.some(q => !resp.answers?.[q.id]);
        break;
      }
      case 'link':
        missing = !resp.url?.trim();
        break;
      case 'audio':
      case 'video':
        missing = !resp.storage_path && !resp._pendingFile;
        break;
    }

    if (missing) {
      await alert(`Please complete "${item.title}" before submitting.`);
      return;
    }
  }

  const ok = await confirm('Submit this assignment? You won\'t be able to make changes after submitting.');
  if (!ok) return;

  await saveResponses(true);
}

// ===== SAVE / SUBMIT =====

async function saveResponses(isSubmit) {
  const saveBtn = document.getElementById('studentInboxSaveBtn');
  const submitBtn = document.getElementById('studentInboxSubmitBtn');
  const statusEl = document.getElementById('studentInboxSaveStatus');

  if (saveBtn) saveBtn.disabled = true;
  if (submitBtn) submitBtn.disabled = true;
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.opacity = '1'; }

  // 1. Ensure assignment_submissions record exists.
  //    Use select-then-insert so we never need an UPDATE policy for students —
  //    the row may already exist if the list was loaded before the first save.
  if (!currentSubmission?.id) {
    const { data: existing } = await supabase
      .from('assignment_submissions')
      .select()
      .eq('student_assignment_id', currentSA.id)
      .maybeSingle();

    if (existing) {
      currentSubmission = existing;
      currentSA.submission = existing;
    } else {
      const { data: sub, error: subErr } = await supabase
        .from('assignment_submissions')
        .insert({ student_assignment_id: currentSA.id })
        .select()
        .single();

      if (subErr) {
        console.error('[StudentAssignments] create submission:', subErr);
        await alert('Failed to save: ' + subErr.message);
        if (saveBtn) saveBtn.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
        return;
      }
      currentSubmission = sub;
      currentSA.submission = sub;
    }
  }

  // 2. Upload pending files to storage
  for (const [itemId, resp] of currentResponses) {
    if (!resp._pendingFile) continue;
    const file = resp._pendingFile;
    const ext = file.name.split('.').pop();
    const path = `${currentUser.id}/${currentSA.id}/${itemId}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('assignment-submissions')
      .upload(path, file, { upsert: true });

    if (uploadErr) {
      console.error('[StudentAssignments] upload:', uploadErr);
      await alert(`Failed to upload file: ${uploadErr.message}`);
      if (saveBtn) saveBtn.disabled = false;
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    const { _pendingFile, ...rest } = resp;
    currentResponses.set(itemId, { ...rest, storage_path: path, file_size_bytes: file.size });
  }

  // 3. Score any quiz items
  for (const item of currentItems) {
    if (item.item_type !== 'quiz') continue;
    const resp = currentResponses.get(item.id);
    if (!resp?.answers) continue;

    const questions = item.config?.questions ?? [];
    const passingScore = item.config?.passing_score ?? 70;
    let correct = 0;
    questions.forEach(q => {
      const correctOpt = (q.options ?? []).find(o => o.correct);
      if (correctOpt && resp.answers[q.id] === correctOpt.id) correct++;
    });
    const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
    currentResponses.set(item.id, { ...resp, score, passed: score >= passingScore });
  }

  // 4. Upsert submission_item_responses
  const rows = [];
  for (const [itemId, responseData] of currentResponses) {
    const { _pendingFile, ...cleanData } = responseData;
    if (Object.keys(cleanData).length === 0) continue;
    rows.push({ submission_id: currentSubmission.id, item_id: itemId, response_data: cleanData });
  }

  if (rows.length > 0) {
    const { error: respErr } = await supabase
      .from('submission_item_responses')
      .upsert(rows, { onConflict: 'submission_id,item_id' });

    if (respErr) {
      console.error('[StudentAssignments] save responses:', respErr);
      await alert('Failed to save responses: ' + respErr.message);
      if (saveBtn) saveBtn.disabled = false;
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
  }

  // 5. Update student_assignments status
  const newStatus = isSubmit ? 'submitted' : 'in_progress';
  const { error: saErr } = await supabase
    .from('student_assignments')
    .update({ status: newStatus })
    .eq('id', currentSA.id);

  if (saErr) {
    console.error('[StudentAssignments] update status:', saErr);
  } else {
    currentSA.status = newStatus;
    const idx = myAssignments.findIndex(a => a.id === currentSA.id);
    if (idx >= 0) myAssignments[idx].status = newStatus;
  }

  if (statusEl) {
    statusEl.textContent = isSubmit ? '✅ Submitted!' : 'Saved!';
    statusEl.style.opacity = '1';
    if (!isSubmit) setTimeout(() => { statusEl.style.opacity = '0'; }, 2500);
  }

  if (isSubmit) {
    await notifyTeacherSubmitted();
    setTimeout(() => renderDetail(), 1500); // let "✅ Submitted!" show before re-render
  } else {
    if (saveBtn) saveBtn.disabled = false;
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function notifyTeacherSubmitted() {
  if (!currentSA?.assigned_by) return;
  const name = [currentProfile?.first_name, currentProfile?.last_name].filter(Boolean).join(' ').trim()
    || currentProfile?.username || 'A student';
  const { error } = await supabase.from('notifications').insert({
    user_id: currentSA.assigned_by,
    type: 'assignment_submitted',
    title: 'Assignment submitted',
    body: `${name} submitted "${currentSA.title}".`,
    data: { assignment_id: currentSA.assignment_id, student_assignment_id: currentSA.id },
  });
  if (error) console.error('[StudentAssignments] notifyTeacher:', error);
}

// ===== VIEW SWITCHING =====

function showListView() {
  document.getElementById('studentInboxListView').style.display = '';
  document.getElementById('studentInboxDetailView').style.display = 'none';
}

function showDetailView() {
  document.getElementById('studentInboxListView').style.display = 'none';
  document.getElementById('studentInboxDetailView').style.display = '';
}

function closeDetail() {
  currentSA = null;
  currentItems = [];
  currentResponses = new Map();
  currentSubmission = null;
  showListView();
}

function resetState() {
  closeDetail();
  myAssignments = [];
}
