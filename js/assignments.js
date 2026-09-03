/**
 * js/assignments.js
 * Teacher-side assignment management UI.
 * Handles: create/edit assignments, add submission items, assign to students, review submissions.
 */

import { currentUser } from './state.js';
import { currentProfile } from './profile.js';
import { Modal } from './modal.js';
import { supabase } from './supabase-client.js';
import { alert, confirm, prompt } from './alert.js';
import { escapeHtml } from './utils.js';
import { Bus, BUS_EVENT } from './bus.js';
import { copyCompositionAsSnapshot } from './song-composer.js';
import { makeSortableGroup } from './sortable.js';
import { show, hide, setVisible } from './dom.js';

// ===== DOM REFS =====
let modal = null;
let asgnPanel = null;

// ===== MODULE STATE =====
let activeTab = 'assignments';
let submissionsLoaded = false;

let assignmentsList = [];   // active (non-archived)
let archivedList = [];      // archived assignments
let foldersList = [];
let coursesList = [];
let studentsList = [];
let compositionsList = [];
let phrasesList = [];
let cachedAssigneeMap = null; // Map<student_id, status> — cleared when editor opens

let selectedIds = new Set(); // currently checked assignment IDs
let archivedLoaded = false;  // lazy-load archive tab

let sortableGroup = null; // makeSortableGroup instance, recreated on each render

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
  composition_reference: '🎵',
  phrase: '🥁',
};

const ITEM_TYPE_LABELS = {
  mark_complete: 'Mark Complete',
  quiz: 'Quiz',
  audio: 'Audio Recording',
  video: 'Video Upload',
  link: 'URL / Link',
  composition_reference: 'Study Composition',
  phrase: 'Phrase',
};

// ===== INIT =====

// Called at login to warm the Supabase connection and pre-load stable data
// so the modal opens instantly instead of waiting for a cold-start round-trip.
export function prefetchAssignmentsData() {
  if (coursesList.length === 0) loadCourses();
  if (studentsList.length === 0) loadStudents();
}

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

  // New folder / new assignment
  document.getElementById('asgnNewFolderBtn')
    ?.addEventListener('click', createFolder);
  document.getElementById('asgnNewBtn')
    ?.addEventListener('click', openNewEditor);

  // Bulk bar
  document.getElementById('asgnBulkFolderSelect')
    ?.addEventListener('change', handleBulkMove);
  document.getElementById('asgnBulkArchiveBtn')
    ?.addEventListener('click', handleBulkArchive);
  document.getElementById('asgnBulkClearBtn')
    ?.addEventListener('click', () => { selectedIds.clear(); renderAssignmentsList(); updateBulkBar(); });

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
  document.getElementById('asgnSendBackBtn')
    ?.addEventListener('click', handleSendBack);
  document.getElementById('asgnMarkCompleteBtn')
    ?.addEventListener('click', handleMarkComplete);
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

  Bus.on(BUS_EVENT.OPEN_ASSIGNMENTS, () => openAssignmentsSubmissions());
}

export function openAssignments() {
  if (!asgnPanel) return;
  asgnPanel.open();
  switchTab('assignments');
  loadInitialData();
}

function openAssignmentsSubmissions() {
  if (!asgnPanel) return;
  asgnPanel.open();
  switchTab('submissions');
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
    setVisible(panel, panel.id === `asgnTab-${tabName}`);
  });
  if (tabName === 'submissions' && !submissionsLoaded) {
    submissionsLoaded = true;
    loadSubmissionsList();
  }
  if (tabName === 'archive' && !archivedLoaded) {
    archivedLoaded = true;
    loadArchivedList();
  }
}

// ===== DATA LOADING =====

async function loadInitialData() {
  // Fetch folders and assignments in parallel, then render once both are ready.
  // Rendering inside loadAssignmentsList would race against loadFolders completing.
  const tasks = [];
  tasks.push(loadAssignmentsList({ renderWhenDone: false }));
  if (foldersList.length === 0) tasks.push(loadFolders({ renderWhenDone: false }));
  if (coursesList.length === 0) tasks.push(loadCourses());
  if (studentsList.length === 0) tasks.push(loadStudents());
  if (compositionsList.length === 0) tasks.push(loadCompositions());
  if (phrasesList.length === 0) tasks.push(loadPhrases());
  await Promise.all(tasks);
  populateFolderSelect();
  populateCourseSelect();
  renderAssignmentsList();
}

async function loadFolders({ renderWhenDone = true } = {}) {
  const { data } = await supabase
    .from('assignment_folders')
    .select('id, name')
    .eq('created_by', currentUser.id)
    .order('name');
  foldersList = data || [];
  if (renderWhenDone) { populateFolderSelect(); renderAssignmentsList(); }
}

async function loadArchivedList() {
  const el = document.getElementById('asgnArchiveList');
  if (el) el.innerHTML = '<div class="asgn-loading">Loading…</div>';
  const { data, error } = await supabase
    .from('assignments')
    .select('*, assignment_items(count)')
    .eq('created_by', currentUser.id)
    .eq('is_archived', true)
    .order('created_at', { ascending: false });
  if (error) {
    if (el) el.innerHTML = '<div class="asgn-list-empty">Failed to load archive.</div>';
    return;
  }
  archivedList = (data || []).map(a => ({ ...a, item_count: a.assignment_items?.[0]?.count ?? 0 }));
  renderArchivedList();
}

function renderArchivedList() {
  const el = document.getElementById('asgnArchiveList');
  if (!el) return;
  if (archivedList.length === 0) {
    el.innerHTML = '<div class="asgn-list-empty">No archived assignments.</div>';
    return;
  }
  el.innerHTML = '';
  archivedList.forEach(a => {
    const item = document.createElement('div');
    item.className = 'asgn-list-item asgn-list-item-archived';
    item.dataset.id = a.id;
    const itemWord = a.item_count === 1 ? 'item' : 'items';
    item.innerHTML = `
      <span class="asgn-item-title">${escapeHtml(a.title)}</span>
      <span class="asgn-item-meta">${a.item_count} ${itemWord}</span>
      <button class="asgn-unarchive-btn" data-id="${a.id}">Unarchive</button>
    `;
    el.appendChild(item);
  });
}

async function loadAssignmentsList({ renderWhenDone = true } = {}) {
  const el = document.getElementById('asgnList');
  if (el) el.innerHTML = '<div class="asgn-loading">Loading…</div>';

  const { data, error } = await supabase
    .from('assignments')
    .select('*, assignment_items(count)')
    .eq('created_by', currentUser.id)
    .neq('is_archived', true)
    .order('sort_order', { ascending: true, nullsFirst: false })
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
  if (renderWhenDone) renderAssignmentsList();
}

function populateFolderSelect() {
  const sel = document.getElementById('asgnFolderSelect');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— None —</option>';
  foldersList.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function updateBulkBar() {
  const bar = document.getElementById('asgnBulkBar');
  const count = document.getElementById('asgnBulkCount');
  if (!bar) return;
  const n = selectedIds.size;
  setVisible(bar, n > 0);
  if (count) count.textContent = `${n} selected`;

  // Repopulate folder select with current folders
  const sel = document.getElementById('asgnBulkFolderSelect');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">Move to folder…</option><option value="__none__">— Remove from folder —</option>';
    foldersList.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      sel.appendChild(opt);
    });
    sel.value = prev || '';
  }
}

async function handleBulkMove(e) {
  const folderId = e.target.value;
  if (!folderId) return;
  e.target.value = ''; // reset select

  const ids = [...selectedIds];
  const newFolderId = folderId === '__none__' ? null : folderId;

  const { error } = await supabase
    .from('assignments')
    .update({ folder_id: newFolderId })
    .in('id', ids);
  if (error) { await alert('Failed to move assignments: ' + error.message); return; }

  ids.forEach(id => {
    const a = assignmentsList.find(x => x.id === id);
    if (a) a.folder_id = newFolderId;
  });
  selectedIds.clear();
  updateBulkBar();
  renderAssignmentsList();
}

async function handleBulkArchive() {
  const ids = [...selectedIds];
  if (!ids.length) return;
  if (!await confirm(`Archive ${ids.length} assignment${ids.length > 1 ? 's' : ''}?`)) return;

  const { error } = await supabase
    .from('assignments')
    .update({ is_archived: true })
    .in('id', ids);
  if (error) { await alert('Failed to archive: ' + error.message); return; }

  assignmentsList = assignmentsList.filter(a => !ids.includes(a.id));
  selectedIds.clear();
  archivedLoaded = false; // force reload next time archive tab opens
  updateBulkBar();
  renderAssignmentsList();
}

async function unarchiveAssignment(id) {
  const { error } = await supabase
    .from('assignments')
    .update({ is_archived: false })
    .eq('id', id);
  if (error) { await alert('Failed to unarchive: ' + error.message); return; }
  archivedList = archivedList.filter(a => a.id !== id);
  renderArchivedList();
  // Reload active list to pick up the restored assignment
  await loadAssignmentsList();
}

async function createFolder() {
  const name = await prompt('Folder name:', '');
  if (!name?.trim()) return;
  const { data, error } = await supabase
    .from('assignment_folders')
    .insert({ name: name.trim(), created_by: currentUser.id })
    .select('id, name')
    .single();
  if (error) { await alert('Could not create folder: ' + error.message); return; }
  foldersList.push(data);
  foldersList.sort((a, b) => a.name.localeCompare(b.name));
  populateFolderSelect();
  renderAssignmentsList();
}

async function renameFolder(id) {
  const folder = foldersList.find(f => f.id === id);
  if (!folder) return;
  const name = await prompt('Rename folder:', folder.name);
  if (!name?.trim() || name.trim() === folder.name) return;
  const { error } = await supabase
    .from('assignment_folders')
    .update({ name: name.trim() })
    .eq('id', id);
  if (error) { await alert('Could not rename folder: ' + error.message); return; }
  folder.name = name.trim();
  foldersList.sort((a, b) => a.name.localeCompare(b.name));
  populateFolderSelect();
  renderAssignmentsList();
}

async function deleteFolder(id) {
  const folder = foldersList.find(f => f.id === id);
  if (!folder) return;
  const inFolder = assignmentsList.filter(a => a.folder_id === id).length;
  const msg = inFolder
    ? `Delete "${folder.name}"? The ${inFolder} assignment${inFolder > 1 ? 's' : ''} inside will become uncategorized.`
    : `Delete folder "${folder.name}"?`;
  if (!await confirm(msg)) return;
  const { error } = await supabase.from('assignment_folders').delete().eq('id', id);
  if (error) { await alert('Could not delete folder: ' + error.message); return; }
  // folder_id set null by DB cascade (on delete set null)
  assignmentsList.forEach(a => { if (a.folder_id === id) a.folder_id = null; });
  foldersList = foldersList.filter(f => f.id !== id);
  populateFolderSelect();
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

async function loadCompositions() {
  const { data } = await supabase
    .from('compositions')
    .select('id, title')
    .eq('user_id', currentUser.id)
    .eq('is_snapshot', false)
    .order('created_at', { ascending: false });
  compositionsList = data || [];
}

async function loadPhrases() {
  const { data } = await supabase
    .from('patterns')
    .select('name, data')
    .eq('user_id', currentUser.id)
    .not('archived', 'is', true)
    .order('updated_at', { ascending: false });
  phrasesList = data || [];
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
      assignment_submissions(id, submitted_at, reviewed_at, feedback)
    `)
    .eq('assigned_by', currentUser.id)
    .in('status', ['submitted', 'sent_back', 'reviewed']);

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
    student_name: buildName(studentsList.find(s => s.user_id === row.student_id)),
    due_date: row.due_date,
    status: row.status,
    submission_id: row.assignment_submissions?.id ?? null,
    submitted_at: row.assignment_submissions?.submitted_at ?? null,
    reviewed_at: row.assignment_submissions?.reviewed_at ?? null,
    feedback: row.assignment_submissions?.feedback ?? null,
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

// ===== DRAG-AND-DROP =====

function sortAssignmentsList() {
  assignmentsList.sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
}

// Insert draggedId into toFolderId before beforeId (null = append to end).
// Handles both same-folder reorder and cross-folder moves.
function reorderAssignment(draggedId, toFolderId, beforeId) {
  const dragged = assignmentsList.find(x => x.id === draggedId);
  if (!dragged) return;

  const prevFolderId = dragged.folder_id ?? null;
  dragged.folder_id = toFolderId;

  const destItems = assignmentsList
    .filter(a => (a.folder_id ?? null) === toFolderId && a.id !== draggedId)
    .sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));

  const insertIdx = beforeId ? destItems.findIndex(a => a.id === beforeId) : -1;
  destItems.splice(insertIdx === -1 ? destItems.length : insertIdx, 0, dragged);
  destItems.forEach((a, i) => { a.sort_order = i; });

  const updates = destItems.map(a => ({ id: a.id, sort_order: a.sort_order, folder_id: a.folder_id ?? null }));

  if (prevFolderId !== toFolderId) {
    const srcItems = assignmentsList
      .filter(a => (a.folder_id ?? null) === prevFolderId)
      .sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
    srcItems.forEach((a, i) => { a.sort_order = i; });
    updates.push(...srcItems.map(a => ({ id: a.id, sort_order: a.sort_order, folder_id: a.folder_id ?? null })));
  }

  sortAssignmentsList();
  renderAssignmentsList();

  Promise.all(updates.map(u =>
    supabase.from('assignments').update({ sort_order: u.sort_order, folder_id: u.folder_id }).eq('id', u.id)
  )).catch(err => console.error('[Assignments] reorder persist failed:', err));
}

function handleAssignmentSort({ draggedId, toEl, beforeId }) {
  reorderAssignment(draggedId, toEl.dataset.folderId || null, beforeId);
}

// ===== RENDERING — ASSIGNMENTS TAB =====

function renderAssignmentCard(a) {
  const item = document.createElement('div');
  item.className = 'asgn-list-item' + (selectedIds.has(a.id) ? ' selected' : '');
  item.dataset.id = a.id;
  item.draggable = true;
  const pillClass = a.is_published ? 'published' : 'draft';
  const pillLabel = a.is_published ? 'Published' : 'Draft';
  const itemWord = a.item_count === 1 ? 'item' : 'items';
  const checked = selectedIds.has(a.id) ? 'checked' : '';
  item.innerHTML = `
    <input type="checkbox" class="asgn-item-checkbox" data-id="${a.id}" ${checked} />
    <span class="asgn-item-title">${escapeHtml(a.title)}</span>
    <span class="asgn-item-meta">${a.item_count} ${itemWord}</span>
    <span class="asgn-status-pill ${pillClass}">${pillLabel}</span>
  `;

  return item;
}

function renderAssignmentsList() {
  const el = document.getElementById('asgnList');
  if (!el) return;

  el.innerHTML = '';

  const hasFolders = foldersList.length > 0;

  // Group assignments by folder_id
  const byFolder = new Map(); // folder_id → [assignment]
  assignmentsList.forEach(a => {
    const key = a.folder_id || null;
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key).push(a);
  });

  if (!hasFolders && assignmentsList.length === 0) {
    el.innerHTML = '<div class="asgn-list-empty">No assignments yet. Click "+ New Assignment" to create one.</div>';
    return;
  }

  // Rebuild sortable group — destroy old containers first
  if (sortableGroup) sortableGroup.destroy();
  sortableGroup = makeSortableGroup({
    itemSelector: '.asgn-list-item',
    onReorder: handleAssignmentSort,
  });

  function addSortableBody(bodyEl, folderId) {
    bodyEl.dataset.folderId = folderId ?? '';
    sortableGroup.add(bodyEl);
  }

  // Render all folders (including empty ones)
  foldersList.forEach(folder => {
    const assignments = byFolder.get(folder.id) || [];
    const group = document.createElement('div');
    group.className = 'asgn-folder-group';
    group.dataset.folderId = folder.id;

    const header = document.createElement('div');
    header.className = 'asgn-folder-header';
    header.innerHTML = `
      <span class="asgn-folder-toggle">▾</span>
      <span class="asgn-folder-name">${escapeHtml(folder.name)}</span>
      <span class="asgn-folder-count">${assignments.length}</span>
      <button class="asgn-folder-action" data-action="rename-folder" data-id="${folder.id}" title="Rename">✏️</button>
      <button class="asgn-folder-action" data-action="delete-folder" data-id="${folder.id}" title="Delete">✕</button>
    `;
    group.appendChild(header);

    const body = document.createElement('div');
    body.className = 'asgn-folder-body';
    if (assignments.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'asgn-folder-empty';
      empty.textContent = 'Drop assignments here.';
      body.appendChild(empty);
    } else {
      assignments.forEach(a => body.appendChild(renderAssignmentCard(a)));
    }
    addSortableBody(body, folder.id);
    group.appendChild(body);
    el.appendChild(group);
  });

  // Uncategorized assignments
  const uncategorized = byFolder.get(null) || [];
  if (uncategorized.length > 0 || hasFolders) {
    if (hasFolders) {
      const header = document.createElement('div');
      header.className = 'asgn-folder-header asgn-folder-uncategorized';
      header.innerHTML = `
        <span class="asgn-folder-toggle">▾</span>
        <span class="asgn-folder-name">Uncategorized</span>
        <span class="asgn-folder-count">${uncategorized.length}</span>
      `;
      el.appendChild(header);

      const body = document.createElement('div');
      body.className = 'asgn-folder-body';
      if (uncategorized.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'asgn-folder-empty';
        empty.textContent = 'Drop assignments here.';
        body.appendChild(empty);
      } else {
        uncategorized.forEach(a => body.appendChild(renderAssignmentCard(a)));
      }
      addSortableBody(body, null);
      el.appendChild(body);
    } else {
      // No folders — flat reorderable list
      const flatBody = document.createElement('div');
      flatBody.className = 'asgn-folder-body';
      uncategorized.forEach(a => flatBody.appendChild(renderAssignmentCard(a)));
      addSortableBody(flatBody, null);
      el.appendChild(flatBody);
    }
  }
}

function handleAssignmentListClick(e) {
  // Folder action buttons
  const actionBtn = e.target.closest('.asgn-folder-action');
  if (actionBtn) {
    e.stopPropagation();
    const { action, id } = actionBtn.dataset;
    if (action === 'rename-folder') renameFolder(id);
    else if (action === 'delete-folder') deleteFolder(id);
    return;
  }

  // Folder header — toggle collapse
  const header = e.target.closest('.asgn-folder-header');
  if (header) {
    const group = header.closest('.asgn-folder-group');
    const body = group
      ? group.querySelector('.asgn-folder-body')
      : header.nextElementSibling;
    if (body) {
      const collapsed = body.classList.toggle('collapsed');
      const toggle = header.querySelector('.asgn-folder-toggle');
      if (toggle) toggle.textContent = collapsed ? '▸' : '▾';
    }
    return;
  }

  // Unarchive button
  const unarchiveBtn = e.target.closest('.asgn-unarchive-btn');
  if (unarchiveBtn) { unarchiveAssignment(unarchiveBtn.dataset.id); return; }

  // Checkbox — toggle selection without opening editor
  const checkbox = e.target.closest('.asgn-item-checkbox');
  if (checkbox) {
    const id = checkbox.dataset.id;
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    checkbox.closest('.asgn-list-item')?.classList.toggle('selected', selectedIds.has(id));
    updateBulkBar();
    return;
  }

  // Assignment card — open editor only if clicking outside the checkbox
  const row = e.target.closest('.asgn-list-item');
  if (row?.dataset.id && !e.target.closest('.asgn-item-checkbox')) {
    openEditEditor(row.dataset.id);
  }
}

function renderEditor() {
  const a = currentAssignment;

  document.getElementById('asgnEditorTitle').textContent = a?.id ? 'Edit Assignment' : 'New Assignment';
  document.getElementById('asgnTitle').value = a?.title ?? '';
  document.getElementById('asgnDesc').value = a?.description ?? '';
  document.getElementById('asgnVideoUrl').value = a?.video_url ?? '';
  document.getElementById('asgnDueDate').value = a?.default_due_date
    ? a.default_due_date.slice(0, 10) : '';
  document.getElementById('asgnPublished').checked = a?.is_published ?? false;

  // Folder select
  populateFolderSelect();
  const folderSelect = document.getElementById('asgnFolderSelect');
  if (folderSelect) folderSelect.value = a?.folder_id ?? '';

  // Course select
  const courseSelect = document.getElementById('asgnCourseSelect');
  if (courseSelect) courseSelect.value = a?.course_id ?? '';

  // Phrase select
  populatePhraseSelect();
  const phraseSelect = document.getElementById('asgnPhraseSelect');
  if (phraseSelect) phraseSelect.value = a?.phrase_name ?? '';

  // Delete btn
  const deleteBtn = document.getElementById('asgnDeleteBtn');
  setVisible(deleteBtn, !!a?.id);

  // Student section
  const studentSection = document.getElementById('asgnStudentSection');
  if (studentSection) {
    setVisible(studentSection, !!a?.id);
    if (a?.id) renderStudentSection(a.id);
  }

  renderItemsList();
}

function populatePhraseSelect() {
  const sel = document.getElementById('asgnPhraseSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— None —</option>';
  phrasesList.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  if (currentAssignment?.phrase_name) sel.value = currentAssignment.phrase_name;
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
        ${item.item_type === 'composition_reference' ? renderCompositionPickerHTML(idx) : ''}
        ${item.item_type === 'phrase' ? renderPhrasePickerHTML(idx) : ''}
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
          value="${escapeHtml(opt.label ?? '')}" placeholder="Option ${oIdx + 1}" />
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

function renderCompositionPickerHTML(idx) {
  const item = currentItems[idx];
  // original_composition_id is the source the teacher picked from the dropdown.
  // composition_id is the snapshot copy — it's not in compositionsList, so we
  // use the original for display purposes.
  const selectedId = item.config?.original_composition_id ?? item.config?.composition_id ?? '';
  const sections = item.config?.sections ?? [];

  const options = compositionsList.map(c =>
    `<option value="${escapeHtml(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.title)}</option>`
  ).join('');

  const sectionsPreview = sections.length
    ? `<div class="asgn-comp-sections-preview">
        ${sections.filter(s => s.type === 'phrase').map((s, i) =>
          `<span class="asgn-comp-section-chip">${escapeHtml(s.title || s.phrase_name || `Section ${i + 1}`)}</span>`
        ).join('')}
       </div>`
    : '';

  return `
    <div>
      <label class="asgn-label">Composition</label>
      <select data-field="composition-select">
        <option value="">— Choose a composition —</option>
        ${options}
      </select>
    </div>
    ${sectionsPreview}
  `;
}

function renderPhrasePickerHTML(idx) {
  const item = currentItems[idx];
  const selectedName = item.config?.pattern_name ?? '';

  const options = phrasesList.map(p =>
    `<option value="${escapeHtml(p.name)}" ${p.name === selectedName ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');

  return `
    <div>
      <label class="asgn-label">Phrase</label>
      <select data-field="phrase-select">
        <option value="">— Choose a phrase —</option>
        ${options}
      </select>
    </div>
    ${selectedName ? `<div class="asgn-phrase-selected-name">${escapeHtml(selectedName)}</div>` : ''}
  `;
}

async function renderStudentSection(assignmentId) {
  const el = document.getElementById('asgnStudentList');
  if (!el) return;

  // Use the cached map if available — avoids a round-trip after saves and assigns
  let existingMap = cachedAssigneeMap;
  if (!existingMap) {
    el.innerHTML = '<div class="asgn-loading">Loading students…</div>';
    existingMap = await loadExistingAssignees(assignmentId);
    cachedAssigneeMap = existingMap;
  }

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

    const STATUS_LABELS = { submitted: 'Submitted', sent_back: 'Sent back', reviewed: 'Complete' };
    const statusLabel = STATUS_LABELS[row.status] ?? row.status;

    el2.innerHTML = `
      <span class="asgn-sub-student">${escapeHtml(row.student_name)}</span>
      <span class="asgn-sub-assignment">${escapeHtml(row.assignment_title)}</span>
      <span class="asgn-sub-date">${dateStr}</span>
      <span class="student-inbox-status-pill ${escapeHtml(row.status)}">${escapeHtml(statusLabel)}</span>
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
  show(panel);

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

  // Pre-fetch signed URLs for audio/video items (bucket is private)
  await Promise.all(reviewResponses.map(async resp => {
    const path = resp.response_data?.storage_path;
    if (!path) return;
    const itemType = resp.assignment_items?.item_type;
    if (itemType !== 'audio' && itemType !== 'video') return;
    const { data: signed } = await supabase.storage
      .from('assignment-submissions')
      .createSignedUrl(path, 3600);
    if (signed?.signedUrl) {
      resp.response_data = { ...resp.response_data, signed_url: signed.signedUrl };
    }
  }));

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
        const audioUrl = responseData.signed_url ?? '';
        responseHTML = audioUrl
          ? `<audio controls src="${escapeHtml(audioUrl)}" style="width:100%"></audio>`
          : '<em style="opacity:0.5">No audio uploaded.</em>';
        break;
      }
      case 'video': {
        const videoUrl = responseData.signed_url ?? '';
        responseHTML = videoUrl
          ? `<video controls src="${escapeHtml(videoUrl)}" style="max-width:100%"></video>`
          : '<em style="opacity:0.5">No video uploaded.</em>';
        break;
      }
      case 'link': {
        const url = responseData.url ?? '';
        const label = responseData.label ?? url;
        responseHTML = url
          ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`
          : '<em style="opacity:0.5">No link provided.</em>';
        break;
      }
      case 'composition_reference': {
        const config = resp.assignment_items?.config ?? {};
        const sections = (config.sections ?? []).filter(s => s.type === 'phrase');
        const completed = resp.response_data?.completed;
        const statusHTML = completed
          ? '<span class="asgn-mark-complete-check">✅ Student marked as studied</span>'
          : '<span style="opacity:0.5">Not yet marked as studied</span>';
        const sectionList = sections.length
          ? `<div class="asgn-comp-sections-preview" style="margin-top:8px">${
              sections.map((s, i) =>
                `<span class="asgn-comp-section-chip">${escapeHtml(s.title || s.phrase_name || `Section ${i + 1}`)}</span>`
              ).join('')}</div>`
          : '';
        responseHTML = `${statusHTML}${sectionList}`;
        break;
      }
      case 'phrase': {
        const config = resp.assignment_items?.config ?? {};
        const phraseName = config.pattern_name ?? '';
        const completed = resp.response_data?.completed;
        const statusHTML = completed
          ? '<span class="asgn-mark-complete-check">✅ Student marked as practised</span>'
          : '<span style="opacity:0.5">Not yet marked as practised</span>';
        responseHTML = `
          ${phraseName ? `<div class="asgn-phrase-name-chip">${escapeHtml(phraseName)}</div>` : ''}
          ${statusHTML}
        `;
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
  hide(panel);
  currentReview = null;
  reviewResponses = [];
}

// ===== EDITOR ACTIONS =====

function openNewEditor() {
  selectedIds.clear();
  updateBulkBar();
  currentAssignment = null;
  currentItems = [];
  savedItemIds = [];
  resetEditor();
  renderEditor();
  show(document.getElementById('asgnEditor'));
}

async function openEditEditor(assignmentId) {
  const a = assignmentsList.find(x => x.id === assignmentId);
  if (!a) return;
  currentAssignment = { ...a };
  cachedAssigneeMap = null; // will be populated in parallel below

  // Fetch items and existing assignees in parallel instead of sequentially
  const [items, assigneeMap] = await Promise.all([
    loadItemsForAssignment(assignmentId),
    loadExistingAssignees(assignmentId),
  ]);

  currentItems = items.map(it => ({ ...it }));
  savedItemIds = items.map(it => it.id);
  cachedAssigneeMap = assigneeMap;

  renderEditor();
  show(document.getElementById('asgnEditor'));
  document.getElementById('asgnEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetEditor() {
  hide(document.getElementById('asgnEditor'));
  currentAssignment = null;
  currentItems = [];
  savedItemIds = [];
  cachedAssigneeMap = null;
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

function expandItem(idx) {
  const el = document.getElementById('asgnItemsList');
  if (!el) return;

  const card = el.querySelector(`.asgn-item-card[data-idx="${idx}"]`);
  card?.querySelector('.asgn-item-card-body')?.classList.remove('collapsed');
}

// ===== QUIZ HELPERS =====

function addQuizQuestion(itemIdx) {
  const item = currentItems[itemIdx];
  if (!item.config) item.config = { questions: [] };
  if (!item.config.questions) item.config.questions = [];
  item.config.questions.push({ id: `q${Date.now()}`, text: '', options: [] });
  renderItemsList();
  expandItem(itemIdx);
}

function removeQuizQuestion(itemIdx, qIdx) {
  currentItems[itemIdx].config.questions.splice(qIdx, 1);
  renderItemsList();
  expandItem(itemIdx);
}

function addQuizOption(itemIdx, qIdx) {
  const q = currentItems[itemIdx].config.questions[qIdx];
  if (!q.options) q.options = [];
  q.options.push({ id: `o${Date.now()}`, label: '', correct: false });
  renderItemsList();
  expandItem(itemIdx);
}

function removeQuizOption(itemIdx, qIdx, oIdx) {
  currentItems[itemIdx].config.questions[qIdx].options.splice(oIdx, 1);
  renderItemsList();
  expandItem(itemIdx);
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

async function handleItemsListChange(e) {
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
    case 'composition-select': {
      const compId = e.target.value;
      const comp = compositionsList.find(c => c.id === compId);
      item.config = { composition_id: null, original_composition_id: compId, composition_title: comp?.title ?? '' };

      if (compId) {
        // Create a frozen snapshot so students always see the composition as it
        // was at assignment time, and the teacher can edit the original freely.
        const snapshotId = await copyCompositionAsSnapshot(compId);
        if (!snapshotId) { await alert('Could not snapshot composition. Please try again.'); break; }
        item.config.composition_id = snapshotId;

        const { data: sections } = await supabase
          .from('composition_sections')
          .select('id, type, title, phrase_name, color, position')
          .eq('composition_id', snapshotId)
          .order('position');
        item.config.sections = sections || [];
      }

      if (!item.title) {
        item.title = comp?.title ?? '';
        const headerTitle = card.querySelector('.asgn-item-header-title');
        if (headerTitle) headerTitle.textContent = item.title || ITEM_TYPE_LABELS[item.item_type];
      }
      renderItemsList();
      expandItem(idx);
      break;
    }
    case 'phrase-select': {
      const phraseName = e.target.value;
      const phrase = phrasesList.find(p => p.name === phraseName);
      item.config = phrase
        ? { pattern_name: phrase.name, pattern_json: phrase.data }
        : {};
      if (!item.title && phraseName) {
        item.title = phraseName;
        const headerTitle = card.querySelector('.asgn-item-header-title');
        if (headerTitle) headerTitle.textContent = item.title;
      }
      renderItemsList();
      expandItem(idx);
      break;
    }
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

  const wasNew = !currentAssignment?.id;
  const wasPublished = currentAssignment?.is_published ?? false;

  const payload = {
    title,
    description: document.getElementById('asgnDesc')?.value.trim() ?? '',
    video_url: document.getElementById('asgnVideoUrl')?.value.trim() || null,
    folder_id: document.getElementById('asgnFolderSelect')?.value || null,
    course_id: document.getElementById('asgnCourseSelect')?.value || null,
    phrase_name: document.getElementById('asgnPhraseSelect')?.value || null,
    phrase_json: document.getElementById('asgnPhraseSelect')?.value
      ? (phrasesList.find(p => p.name === document.getElementById('asgnPhraseSelect').value)?.data ?? null)
      : null,
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

  // Save all submission items
  if (currentItems.length > 0) {
    const itemsPayload = currentItems.map((item, i) => {
      if (!item.id) item.id = crypto.randomUUID();
      return {
        id: item.id,
        assignment_id: assignmentId,
        item_type: item.item_type,
        title: item.title,
        instructions: item.instructions,
        sort_order: i,
        required: item.required,
        config: item.config,
      };
    });

    const { data: savedItems, error: itemsErr } = await supabase
      .from('assignment_items')
      .upsert(itemsPayload)
      .select('id');

    if (itemsErr) {
      console.error('[Assignments] items save error:', itemsErr);
      await alert('Some submission items failed to save: ' + itemsErr.message);
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

  if (wasNew) {
    // First save: full renderEditor to reveal student section and update title
    renderEditor();
  } else {
    // Re-save: editor fields are unchanged and students haven't moved — skip re-render
    show(document.getElementById('asgnDeleteBtn'));
  }

  // Notify assigned students when assignment is first published
  const justPublished = !wasPublished && saved.is_published;
  if (justPublished) {
    const { data: assignees } = await supabase
      .from('student_assignments')
      .select('student_id')
      .eq('assignment_id', saved.id);
    const studentIds = (assignees || []).map(a => a.student_id);
    const teacherName = buildName(currentProfile);

    const body = `${teacherName} assigned you "${saved.title}".`;

    // Insert notification
    await insertNotifications(
      studentIds,
      'new_assignment',
      'New assignment',
      body,
      { assignment_id: saved.id }
    );

    // Send email to all assigned students
    sendNotificationEmails(studentIds, 'new_assignment', 'New assignment', body);
  }

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

  // Copy any 'phrase' items into each newly-assigned student's own Library so
  // the phrase is still there for them after they submit/complete the
  // assignment — not just borrowed for the duration of it. Non-blocking:
  // the assignment itself already succeeded, so a copy failure here shouldn't
  // undo the "Assigned!" feedback, just get logged for follow-up.
  const phraseItems = currentItems.filter(
    it => it.item_type === 'phrase' && it.config?.pattern_name && it.config?.pattern_json
  );
  if (phraseItems.length) {
    const results = await Promise.all(
      rows.flatMap(row => phraseItems.map(item =>
        supabase.rpc('copy_pattern_to_student', {
          p_student_id: row.student_id,
          p_name: item.config.pattern_name,
          p_data: item.config.pattern_json,
        })
      ))
    );
    results.forEach(r => { if (r.error) console.error('[Assignments] copy_pattern_to_student:', r.error); });
  }

  const assignBtn = document.getElementById('asgnAssignBtn');
  if (assignBtn) {
    const orig = assignBtn.textContent;
    assignBtn.textContent = '✅ Assigned!';
    setTimeout(() => { assignBtn.textContent = orig; }, 2000);
  }

  // Update the cache locally — no need to re-query the DB
  if (!cachedAssigneeMap) cachedAssigneeMap = new Map();
  rows.forEach(row => cachedAssigneeMap.set(row.student_id, 'pending'));
  renderStudentSection(currentAssignment.id);

  // If the assignment is already published, notify the newly-assigned students immediately
  if (currentAssignment.is_published) {
    const teacherName = buildName(currentProfile);
    const newStudentIds = rows.map(r => r.student_id);
    const notifBody = `${teacherName} assigned you "${currentAssignment.title}".`;
    await insertNotifications(
      newStudentIds,
      'new_assignment',
      'New assignment',
      notifBody,
      { assignment_id: currentAssignment.id }
    );
    sendNotificationEmails(newStudentIds, 'new_assignment', 'New assignment', notifBody);
  }
}

// ===== REVIEW ACTIONS =====

async function handleSendBack() {
  if (!currentReview) return;

  const feedback = document.getElementById('asgnFeedback')?.value.trim() ?? '';
  if (!feedback) {
    await alert('Please add feedback before sending back — the student needs to know what to fix.');
    return;
  }

  if (!currentReview.submission_id) {
    await alert('No submission record found for this student assignment.');
    return;
  }

  const [subRes, saRes] = await Promise.all([
    supabase.from('assignment_submissions')
      .update({ feedback })
      .eq('id', currentReview.submission_id),
    supabase.from('student_assignments')
      .update({ status: 'sent_back' })
      .eq('id', currentReview.id),
  ]);

  if (subRes.error || saRes.error) {
    console.error('[Assignments] sendBack error:', subRes.error || saRes.error);
    await alert('Failed to send back.');
    return;
  }

  const teacherName = buildName(currentProfile);
  const feedbackTitle = 'Feedback on your assignment';
  const feedbackBody = `${teacherName} sent feedback on "${currentReview.assignment_title}". Please review and resubmit.`;
  await insertNotifications(
    [currentReview.student_id],
    'assignment_feedback',
    feedbackTitle,
    feedbackBody,
    { assignment_id: currentReview.assignment_id }
  );
  sendNotificationEmails([currentReview.student_id], 'assignment_feedback', feedbackTitle, feedbackBody);

  const statusEl = document.getElementById('asgnReviewStatus');
  if (statusEl) {
    statusEl.textContent = '✅ Sent back to student';
    statusEl.style.opacity = '1';
  }

  setTimeout(() => {
    closeReviewPanel();
    submissionsLoaded = false;
    loadSubmissionsList();
  }, 1500);
}

async function handleMarkComplete() {
  if (!currentReview) return;

  const feedback = document.getElementById('asgnFeedback')?.value.trim() ?? '';

  if (!currentReview.submission_id) {
    await alert('No submission record found for this student assignment.');
    return;
  }

  const now = new Date().toISOString();

  const [subRes, saRes] = await Promise.all([
    supabase.from('assignment_submissions')
      .update({ reviewed_at: now, reviewed_by: currentUser.id, feedback: feedback || null })
      .eq('id', currentReview.submission_id),
    supabase.from('student_assignments')
      .update({ status: 'reviewed' })
      .eq('id', currentReview.id),
  ]);

  if (subRes.error || saRes.error) {
    console.error('[Assignments] markComplete error:', subRes.error || saRes.error);
    await alert('Failed to mark as complete.');
    return;
  }

  const teacherName = buildName(currentProfile);
  const completeTitle = 'Assignment complete!';
  const completeBody = `${teacherName} marked "${currentReview.assignment_title}" as complete. Great work!`;
  await insertNotifications(
    [currentReview.student_id],
    'assignment_complete',
    completeTitle,
    completeBody,
    { assignment_id: currentReview.assignment_id }
  );
  sendNotificationEmails([currentReview.student_id], 'assignment_complete', completeTitle, completeBody);

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

async function insertNotifications(userIds, type, title, body, data = {}) {
  if (!userIds.length) return;
  const rows = userIds.map(uid => ({ user_id: uid, type, title, body, data }));
  const { error } = await supabase.from('notifications').insert(rows);
  if (error) console.error('[Assignments] insertNotifications:', error);
}

async function sendNotificationEmails(userIds, type, title, body) {
  if (!userIds.length) return;
  try {
    const { error } = await supabase.functions.invoke('send-notification-email', {
      body: { userIds, type, title, body },
    });
    if (error) console.warn('[Assignments] sendNotificationEmails error:', error);
  } catch (err) {
    console.warn('[Assignments] sendNotificationEmails exception:', err);
  }
}
