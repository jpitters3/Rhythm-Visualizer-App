import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';
import { currentProfile } from './profile.js';
import { openAuthModal } from './auth.js';
import { navigate } from './router.js';
import { escapeHtml } from './utils.js';

// ── Module state ──────────────────────────────────────────────────────────────

// When the teacher navigates to a student's dashboard, these are set
let viewingAsUserId = null;
let viewingAsName = null;

// ── Public API ────────────────────────────────────────────────────────────────

export function initDashboard() {
  // Route listener
  window.addEventListener('routeChanged', e => {
    if (e.detail.route === 'dashboard') {
      loadDashboard();
    }
  });

  // Goals modal buttons (exist in DOM from page load)
  document.getElementById('dashGoalsEditBtn')
    ?.addEventListener('click', openGoalsModal);
  document.getElementById('dashGoalsCancelBtn')
    ?.addEventListener('click', closeGoalsModal);
  document.getElementById('dashGoalsSaveBtn')
    ?.addEventListener('click', saveGoals);
  document.getElementById('dashGoalsModal')
    ?.addEventListener('click', e => { if (e.target === e.currentTarget) closeGoalsModal(); });

  // Practice "view all" shortcut
  document.getElementById('dashPracticeLink')
    ?.addEventListener('click', () => navigate('practice'));

  // Exit "view as student" mode
  document.getElementById('dashViewingExitBtn')
    ?.addEventListener('click', () => {
      viewingAsUserId = null;
      viewingAsName = null;
      loadDashboard();
    });
}

/** Called from student-management.js when teacher clicks a student. */
export function viewStudentDashboard(studentId, displayName) {
  viewingAsUserId = studentId;
  viewingAsName = displayName;
  navigate('dashboard');
}

// ── Load & render ─────────────────────────────────────────────────────────────

async function loadDashboard() {
  const userId = viewingAsUserId ?? currentUser?.id;

  if (!userId) {
    renderNotLoggedIn();
    return;
  }

  // Viewing-as banner
  const banner = document.getElementById('dashViewingBanner');
  const editBtn = document.getElementById('dashGoalsEditBtn');
  if (viewingAsUserId) {
    banner?.removeAttribute('hidden');
    const nameEl = document.getElementById('dashViewingName');
    if (nameEl) nameEl.textContent = viewingAsName || 'Student';
    editBtn?.setAttribute('hidden', '');
  } else {
    banner?.setAttribute('hidden', '');
    editBtn?.removeAttribute('hidden');
  }

  // Greeting
  const greetEl = document.getElementById('dashGreetName');
  if (greetEl) {
    if (viewingAsUserId) {
      greetEl.textContent = (viewingAsName || 'Student').split(' ')[0];
    } else {
      greetEl.textContent =
        currentProfile?.first_name ||
        currentProfile?.username ||
        (currentUser?.email?.split('@')[0] ?? 'there');
    }
  }

  // Fetch all data in parallel
  const [assignmentRow, goalsRow, practiceRes, courseIdsRes] = await Promise.all([
    fetchCurrentAssignment(userId),
    fetchGoals(userId),
    supabase
      .from('practice_items')
      .select('id, title, item_type')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .limit(5),
    supabase
      .from('user_courses')
      .select('course_id')
      .eq('user_id', userId)
      .neq('is_archived', true),
  ]);

  renderAssignment(assignmentRow);
  renderGoals(goalsRow);
  renderPractice(practiceRes.data || []);
  await renderCourses((courseIdsRes.data || []).map(r => r.course_id));
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchCurrentAssignment(userId) {
  // Fetch recent assignments and pick the best one client-side
  const { data } = await supabase
    .from('student_assignments')
    .select(`
      id, assignment_id, status, due_date, assigned_at,
      assignments(id, title, description, video_url, is_published)
    `)
    .eq('student_id', userId)
    .order('assigned_at', { ascending: false })
    .limit(10);

  const rows = (data || []).filter(r => r.assignments?.is_published);
  // Prefer non-submitted; fall back to most recent submitted
  return rows.find(r => r.status !== 'submitted') ?? rows[0] ?? null;
}

async function fetchGoals(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('dream_goal, short_term_goal')
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderAssignment(sa) {
  const el = document.getElementById('dashAssignmentCard');
  if (!el) return;

  if (!sa) {
    el.innerHTML = `<div class="dash-assignment-empty">No assignment yet — your teacher will send one here.</div>`;
    return;
  }

  const a = sa.assignments;
  const statusLabel = { assigned: 'New', in_progress: 'In Progress', submitted: 'Submitted' }[sa.status] ?? sa.status;
  const statusClass = `dash-assignment-status--${sa.status}`;

  const dueStr = sa.due_date
    ? `Due ${new Date(sa.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : '';

  el.className = 'dash-assignment-hero';
  el.innerHTML = `
    <div class="dash-assignment-badge">📋 Assignment</div>
    <div class="dash-assignment-title">${escapeHtml(a.title)}</div>
    ${a.description ? `<div class="dash-assignment-desc">${escapeHtml(a.description)}</div>` : ''}
    <div class="dash-assignment-footer">
      <span class="dash-assignment-status ${statusClass}">${statusLabel}</span>
      ${dueStr ? `<span class="dash-assignment-due">${dueStr}</span>` : ''}
      <span class="dash-assignment-cta">Open →</span>
    </div>
  `;

  el.addEventListener('click', () => {
    import('./student-assignments.js').then(m => {
      m.openStudentAssignments?.();
    });
  });
}

function renderGoals(goals) {
  const el = document.getElementById('dashGoalsContent');
  if (!el) return;

  const dream = goals?.dream_goal || '';
  const shortTerm = goals?.short_term_goal || '';

  el.innerHTML = `
    <div class="dash-goal-card ${dream ? '' : 'dash-goal-card--empty'}" id="dashDreamGoalCard">
      <div class="dash-goal-label">Dream Goal</div>
      ${dream
        ? `<div class="dash-goal-text">${escapeHtml(dream)}</div>`
        : `<div class="dash-goal-empty">Tap to set your dream goal</div>`}
    </div>
    <div class="dash-goal-card ${shortTerm ? '' : 'dash-goal-card--empty'}" id="dashShortGoalCard">
      <div class="dash-goal-label">Current Focus</div>
      ${shortTerm
        ? `<div class="dash-goal-text">${escapeHtml(shortTerm)}</div>`
        : `<div class="dash-goal-empty">Tap to set your current focus</div>`}
    </div>
  `;

  // Clicking either card opens the goals edit modal (only for self)
  if (!viewingAsUserId) {
    el.querySelectorAll('.dash-goal-card').forEach(card => {
      card.addEventListener('click', openGoalsModal);
    });
  }

  // Pre-fill modal inputs
  const dreamInput = document.getElementById('dashDreamGoalInput');
  const shortInput = document.getElementById('dashShortGoalInput');
  if (dreamInput) dreamInput.value = dream;
  if (shortInput) shortInput.value = shortTerm;
}

function renderPractice(items) {
  const el = document.getElementById('dashPracticeContent');
  if (!el) return;

  if (items.length === 0) {
    el.innerHTML = `<div class="dash-list-empty">Your practice plan is empty.</div>`;
    return;
  }

  el.innerHTML = items.map(item => {
    const icon = item.item_type === 'pattern' ? '🎵' : '📖';
    return `<div class="dash-list-item" data-id="${item.id}">
      <span class="dash-list-icon">${icon}</span>
      <span>${escapeHtml(item.title)}</span>
    </div>`;
  }).join('');

  el.querySelectorAll('.dash-list-item').forEach(row => {
    row.addEventListener('click', () => navigate('practice'));
  });
}

async function renderCourses(courseIds) {
  const el = document.getElementById('dashCoursesContent');
  if (!el) return;

  if (courseIds.length === 0) {
    el.innerHTML = `<div class="dash-list-empty">No active courses.</div>`;
    return;
  }

  const { data: courses } = await supabase
    .from('courses')
    .select('id, title')
    .in('id', courseIds);

  if (!courses || courses.length === 0) {
    el.innerHTML = `<div class="dash-list-empty">No active courses.</div>`;
    return;
  }

  el.innerHTML = courses.map(c =>
    `<div class="dash-list-item" data-id="${c.id}">
      <span class="dash-list-icon">📚</span>
      <span>${escapeHtml(c.title)}</span>
    </div>`
  ).join('');

  el.querySelectorAll('.dash-list-item').forEach(row => {
    row.addEventListener('click', async () => {
      const { openSidebar, setActiveCourse } = await import('./courses.js');
      openSidebar();
      setActiveCourse(row.dataset.id);
    });
  });
}

function renderNotLoggedIn() {
  const content = document.querySelector('.dash-content');
  if (!content) return;
  content.innerHTML = `
    <div class="dash-not-logged-in">
      <p>Sign in to see your dashboard.</p>
      <button class="dash-signin-btn" id="dashSignInBtn">Sign In</button>
    </div>
  `;
  document.getElementById('dashSignInBtn')?.addEventListener('click', openAuthModal);
}

// ── Goals modal ───────────────────────────────────────────────────────────────

function openGoalsModal() {
  document.getElementById('dashGoalsModal')?.removeAttribute('hidden');
}

function closeGoalsModal() {
  document.getElementById('dashGoalsModal')?.setAttribute('hidden', '');
}

async function saveGoals() {
  if (!currentUser) return;

  const dreamGoal = document.getElementById('dashDreamGoalInput')?.value.trim() ?? '';
  const shortGoal = document.getElementById('dashShortGoalInput')?.value.trim() ?? '';
  const saveBtn = document.getElementById('dashGoalsSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Saving…';

  const { error } = await supabase
    .from('profiles')
    .update({ dream_goal: dreamGoal, short_term_goal: shortGoal })
    .eq('user_id', currentUser.id);

  if (saveBtn) saveBtn.textContent = error ? 'Error — try again' : 'Save Goals';

  if (!error) {
    closeGoalsModal();
    // Re-render goals with new values
    renderGoals({ dream_goal: dreamGoal, short_term_goal: shortGoal });
    if (!error && saveBtn) setTimeout(() => { saveBtn.textContent = 'Save Goals'; }, 2000);
  }
}
