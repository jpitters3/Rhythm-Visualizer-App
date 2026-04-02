/**
 * js/student-management.js
 * Teacher-side student list + lesson progress viewer.
 *
 * - "👥 Students" button injected into dropdown for teacher/admin roles.
 * - List view: all students linked via teacher_students, sortable, with invite form.
 * - Detail view: completed lessons grouped by course/section.
 * - Invite flow: teacher enters email → in-app notification (existing user) or email link (new user).
 * - Token flow: student arrives via ?invite=TOKEN → auto-accepted after login.
 */

import { currentUser } from './state.js';
import { currentProfile, loadCurrentProfile } from './profile.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';
import { escapeHtml } from './utils.js';
import { openAuthModal } from './auth.js';

const APP_URL = 'https://panafide.com';

let sidebarEl = null;
let backdropEl = null;

let students = [];
let sortBy = 'name'; // 'name' | 'signed_up' | 'last_seen' | 'assignment_updated'

// ===== INIT =====

export function initStudentManagement() {
  sidebarEl = document.getElementById('studentMgmtSidebar');
  backdropEl = document.getElementById('studentMgmtBackdrop');
  if (!sidebarEl) return;

  document.getElementById('closeStudentMgmtSidebar')
    ?.addEventListener('click', close);
  backdropEl?.addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sidebarEl.classList.contains('open')) close();
  });

  Bus.on(BUS_EVENT.AUTH_LOGIN, () => {
    injectButton();
    touchLastSeen();
    processPendingInvitations();
    processInviteToken();
  });
  Bus.on(BUS_EVENT.AUTH_LOGOUT, close);

  // Auth may have already resolved before this module loaded (e.g. page refresh)
  if (currentUser) {
    injectButton();
    touchLastSeen();
    processPendingInvitations();
  }
  processInviteToken();
}

async function injectButton() {
  if (!currentProfile) await loadCurrentProfile();
  const role = currentProfile?.role;

  if (role !== 'teacher' && role !== 'admin') return;
  if (document.getElementById('studentMgmtBtn')) return;

  const dropdown = document.getElementById('accountDropdownMenu');
  if (!dropdown) return;

  const btn = document.createElement('button');
  btn.id = 'studentMgmtBtn';
  btn.innerHTML = '👥 Students';
  btn.style.marginTop = '4px';
  btn.onclick = open;

  const anchor = document.getElementById('assignmentsBtn') || document.getElementById('adminBtn');
  if (anchor) {
    dropdown.insertBefore(btn, anchor.nextSibling);
  } else {
    dropdown.appendChild(btn);
  }
}

async function touchLastSeen() {
  if (!currentUser) return;
  await supabase
    .from('profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('user_id', currentUser.id);
}

async function processPendingInvitations() {
  if (!currentUser) return;
  await supabase.rpc('process_pending_invitations');
}

async function processInviteToken() {
  // Check URL first, then localStorage (stored when not logged in)
  const params = new URLSearchParams(window.location.search);
  let token = params.get('invite');

  if (token) {
    params.delete('invite');
    const newUrl = location.pathname + (params.toString() ? '?' + params.toString() : '');
    history.replaceState({}, '', newUrl);
  } else {
    token = localStorage.getItem('pendingInviteToken');
    if (token) localStorage.removeItem('pendingInviteToken');
  }

  if (!token) return;

  if (!currentUser) {
    // Save for after login/signup, then prompt them to authenticate
    localStorage.setItem('pendingInviteToken', token);
    openAuthModal();
    return;
  }

  const { error } = await supabase.rpc('accept_teacher_invitation_by_token', { p_token: token });
  if (error) {
    console.warn('[StudentMgmt] Failed to accept invite token:', error.message);
  }
}

// ===== OPEN / CLOSE =====

export async function open() {
  if (!sidebarEl || !currentUser) return;
  sidebarEl.classList.add('open');
  backdropEl?.classList.add('open');
  await loadAndRenderList();
}

function close() {
  if (!sidebarEl) return;
  sidebarEl.classList.remove('open');
  backdropEl?.classList.remove('open');
}

// ===== DATA =====

async function loadStudents() {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out — please try again.')), 8000)
  );
  const { data, error } = await Promise.race([
    supabase.rpc('get_students_for_teacher'),
    timeout,
  ]);
  if (error) throw error;
  return (data || []).map(r => ({
    user_id: r.user_id,
    first_name: r.first_name,
    last_name: r.last_name,
    username: r.username,
    last_seen_at: r.last_seen_at,
    created_at: r.joined_at,
    lastAssignmentUpdate: r.last_assignment_update,
  }));
}

function sortedStudents(list) {
  return [...list].sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return buildName(a).localeCompare(buildName(b));
      case 'signed_up':
        return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      case 'last_seen':
        return (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? '');
      case 'assignment_updated':
        return (b.lastAssignmentUpdate ?? '').localeCompare(a.lastAssignmentUpdate ?? '');
      default:
        return 0;
    }
  });
}

function buildName(p) {
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ');
  return full || p.username || 'Unknown';
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ===== LIST VIEW =====

async function loadAndRenderList() {
  const body = sidebarEl.querySelector('#studentMgmtBody');
  body.innerHTML = '<div class="stmgmt-loading">Loading students…</div>';
  try {
    students = await loadStudents();
    renderList();
  } catch (err) {
    body.innerHTML = `
      <div class="stmgmt-error">Failed to load students: ${escapeHtml(err.message)}</div>
      <div style="text-align:center;margin-top:12px">
        <button class="stmgmt-invite-send-btn" id="stmgmtRetry">Retry</button>
      </div>`;
    body.querySelector('#stmgmtRetry').addEventListener('click', loadAndRenderList);
  }
}

const SORT_LABELS = {
  name: 'Name',
  signed_up: 'Signed up',
  last_seen: 'Last seen',
  assignment_updated: 'Assignment',
};

function renderList() {
  const body = sidebarEl.querySelector('#studentMgmtBody');
  const sorted = sortedStudents(students);

  const sortBtns = Object.entries(SORT_LABELS).map(([key, label]) =>
    `<button class="stmgmt-sort-btn ${sortBy === key ? 'active' : ''}" data-sort="${key}">${label}</button>`
  ).join('');

  const rows = sorted.length === 0
    ? '<div class="stmgmt-empty">No students yet. Invite one to get started.</div>'
    : sorted.map(s => `
        <div class="stmgmt-student-row" data-id="${s.user_id}">
          <div class="stmgmt-student-avatar">${escapeHtml(buildName(s).charAt(0).toUpperCase())}</div>
          <div class="stmgmt-student-info">
            <div class="stmgmt-student-name">${escapeHtml(buildName(s))}</div>
            <div class="stmgmt-student-meta">
              <span>Joined ${fmtDate(s.created_at)}</span>
              <span class="stmgmt-dot">·</span>
              <span>Seen ${fmtDate(s.last_seen_at)}</span>
              <span class="stmgmt-dot">·</span>
              <span>Assignment ${fmtDate(s.lastAssignmentUpdate)}</span>
            </div>
          </div>
          <div class="stmgmt-chevron">›</div>
        </div>
      `).join('');

  body.innerHTML = `
    <div class="stmgmt-invite-bar">
      <button class="stmgmt-invite-toggle-btn" id="stmgmtInviteToggle">+ Invite student</button>
    </div>
    <div class="stmgmt-invite-form" id="stmgmtInviteForm" hidden>
      <input class="stmgmt-invite-input" type="email" id="stmgmtInviteEmail" placeholder="Student's email address" />
      <div class="stmgmt-invite-actions">
        <button class="stmgmt-invite-send-btn" id="stmgmtInviteSend">Send invitation</button>
        <button class="stmgmt-invite-cancel-btn" id="stmgmtInviteCancel">Cancel</button>
      </div>
      <div class="stmgmt-invite-status" id="stmgmtInviteStatus"></div>
    </div>
    <div class="stmgmt-sort-bar">
      <span class="stmgmt-sort-label">Sort:</span>
      ${sortBtns}
    </div>
    ${rows}
  `;

  // Sort buttons
  body.querySelectorAll('.stmgmt-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => { sortBy = btn.dataset.sort; renderList(); });
  });

  // Student rows
  body.querySelectorAll('.stmgmt-student-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.id));
  });

  // Invite toggle
  body.querySelector('#stmgmtInviteToggle').addEventListener('click', () => {
    const form = body.querySelector('#stmgmtInviteForm');
    form.hidden = !form.hidden;
    if (!form.hidden) body.querySelector('#stmgmtInviteEmail').focus();
  });

  // Invite cancel
  body.querySelector('#stmgmtInviteCancel').addEventListener('click', () => {
    body.querySelector('#stmgmtInviteForm').hidden = true;
    body.querySelector('#stmgmtInviteEmail').value = '';
    body.querySelector('#stmgmtInviteStatus').textContent = '';
  });

  // Invite send
  body.querySelector('#stmgmtInviteSend').addEventListener('click', () => {
    const email = body.querySelector('#stmgmtInviteEmail').value.trim();
    if (!email) return;
    sendInvite(email);
  });

  body.querySelector('#stmgmtInviteEmail').addEventListener('keydown', e => {
    if (e.key === 'Enter') body.querySelector('#stmgmtInviteSend').click();
  });
}

// ===== INVITE =====

async function sendInvite(email) {
  const statusEl = sidebarEl.querySelector('#stmgmtInviteStatus');
  const sendBtn = sidebarEl.querySelector('#stmgmtInviteSend');

  statusEl.textContent = 'Sending…';
  statusEl.className = 'stmgmt-invite-status';
  sendBtn.disabled = true;

  try {
    // Create invitation in DB (security definer — looks up student by email server-side)
    const { data, error } = await supabase.rpc('create_teacher_invitation', {
      p_student_email: email,
    });

    if (error) throw error;

    const [{ invitation_id, token, student_exists }] = data;

    if (student_exists) {
      // Student has an account — in-app notification sent via DB trigger
      statusEl.textContent = 'Invitation sent! The student will see it in their notifications.';
    } else {
      // Student has no account — send email with signup + invite link
      const inviteUrl = `${APP_URL}/?invite=${token}`;
      await supabase.functions.invoke('send-notification-email', {
        body: {
          to: email,
          title: 'You\'ve been invited to Panafide',
          body: 'Your teacher has invited you to join Panafide. Click below to accept.',
          cta_url: inviteUrl,
          cta_text: 'Accept Invitation',
        },
      });
      statusEl.textContent = `Invitation email sent to ${email}.`;
    }

    statusEl.classList.add('stmgmt-invite-status--success');
    sidebarEl.querySelector('#stmgmtInviteEmail').value = '';
  } catch (err) {
    statusEl.textContent = `Failed: ${err.message}`;
    statusEl.classList.add('stmgmt-invite-status--error');
  } finally {
    sendBtn.disabled = false;
  }
}

// ===== DETAIL VIEW =====

async function openDetail(studentId) {
  const student = students.find(s => s.user_id === studentId);
  const body = sidebarEl.querySelector('#studentMgmtBody');

  body.innerHTML = `
    <div class="stmgmt-detail-header">
      <button class="stmgmt-back-btn" id="stmgmtBackBtn">← Students</button>
      <div class="stmgmt-detail-name-row">
        <div class="stmgmt-detail-name">${escapeHtml(buildName(student))}</div>
        <button class="stmgmt-remove-btn" id="stmgmtRemoveBtn">Remove student</button>
      </div>
    </div>
    <div id="stmgmtDetailContent" class="stmgmt-detail-content">
      <div class="stmgmt-loading">Loading lesson progress…</div>
    </div>
  `;

  document.getElementById('stmgmtBackBtn')?.addEventListener('click', renderList);
  document.getElementById('stmgmtRemoveBtn')?.addEventListener('click', () => removeStudent(studentId, buildName(student)));
  await loadAndRenderDetail(studentId);
}

async function removeStudent(studentId, studentName) {
  const btn = document.getElementById('stmgmtRemoveBtn');

  if (btn.dataset.confirm !== 'true') {
    btn.dataset.confirm = 'true';
    btn.textContent = 'Confirm removal';
    btn.classList.add('stmgmt-remove-btn--confirm');
    setTimeout(() => {
      if (btn.dataset.confirm === 'true') {
        btn.dataset.confirm = '';
        btn.textContent = 'Remove student';
        btn.classList.remove('stmgmt-remove-btn--confirm');
      }
    }, 4000);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Removing…';

  const { error } = await supabase
    .from('teacher_students')
    .delete()
    .eq('student_id', studentId)
    .eq('teacher_id', currentUser.id);

  if (error) {
    btn.disabled = false;
    btn.dataset.confirm = '';
    btn.textContent = 'Remove student';
    btn.classList.remove('stmgmt-remove-btn--confirm');
    alert(`Failed to remove student: ${error.message}`);
    return;
  }

  students = students.filter(s => s.user_id !== studentId);
  renderList();
}

async function loadAndRenderDetail(studentId) {
  const content = document.getElementById('stmgmtDetailContent');
  try {
    const { data, error } = await supabase
      .from('user_lesson_progress')
      .select(`
        lesson_id,
        completed_at,
        lessons (
          id, title, order_index,
          sections (
            id, title, order_index,
            courses ( id, title )
          )
        )
      `)
      .eq('user_id', studentId);

    if (error) throw error;

    if (!data || data.length === 0) {
      content.innerHTML = '<div class="stmgmt-empty">No lessons completed yet.</div>';
      return;
    }

    // Group by course → section
    const courseMap = new Map();
    for (const row of data) {
      const lesson = row.lessons;
      if (!lesson) continue;
      const section = lesson.sections;
      if (!section) continue;
      const course = section.courses;
      if (!course) continue;

      if (!courseMap.has(course.id)) {
        courseMap.set(course.id, { title: course.title, sections: new Map() });
      }
      const courseEntry = courseMap.get(course.id);

      if (!courseEntry.sections.has(section.id)) {
        courseEntry.sections.set(section.id, {
          title: section.title,
          order_index: section.order_index,
          lessons: [],
        });
      }
      courseEntry.sections.get(section.id).lessons.push({
        title: lesson.title,
        order_index: lesson.order_index,
        completed_at: row.completed_at,
      });
    }

    let html = '';
    for (const course of courseMap.values()) {
      const sortedSections = [...course.sections.values()]
        .sort((a, b) => a.order_index - b.order_index);
      sortedSections.forEach(s => s.lessons.sort((a, b) => a.order_index - b.order_index));
      const totalLessons = sortedSections.reduce((n, s) => n + s.lessons.length, 0);

      html += `
        <div class="stmgmt-course-group">
          <div class="stmgmt-course-title">${escapeHtml(course.title)}</div>
          <div class="stmgmt-course-count">${totalLessons} lesson${totalLessons !== 1 ? 's' : ''} completed</div>
          ${sortedSections.map(section => `
            <div class="stmgmt-section-group">
              <div class="stmgmt-section-title">${escapeHtml(section.title)}</div>
              ${section.lessons.map(l => `
                <div class="stmgmt-lesson-item">
                  <span class="stmgmt-lesson-check">✓</span>
                  <span class="stmgmt-lesson-title">${escapeHtml(l.title)}</span>
                  <span class="stmgmt-lesson-date">${fmtDate(l.completed_at)}</span>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      `;
    }

    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = `<div class="stmgmt-error">Error: ${escapeHtml(err.message)}</div>`;
  }
}
