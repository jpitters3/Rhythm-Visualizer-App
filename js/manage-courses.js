// Manage courses (route #manage-courses, admin only).
// Courses tab: every course on staging and production side by side, with
// publish (new courses only), pull, delete and links. Copy sections tab: the
// section copier (js/course-copier.js). Moves run in the course-sync edge
// function, which only staging has.

import { supabase } from './supabase-client.js';
import { currentUser, isAdminUser } from './state.js';
import { navigate, getCurrentRoute } from './router.js';
import { Bus, BUS_EVENT } from './bus.js';
import { alert, confirmCustom } from './alert.js';
import { escapeHtml } from './utils.js';
import { loadCourseToEdit } from './course-creator.js';
import { openCourseCopier } from './course-copier.js';
import { courseLink, courseSlug, isProduction, productionEditLink, PRODUCTION_APP_URL } from './course-links.js';

const ROUTE = 'manage-courses';
const FILTERS = [
  ['all', 'All'],
  ['staging', 'Staging only'],
  ['both', 'On production'],
  ['production', 'Production only'],
  ['test', 'Test courses'],
];

let view = null;
let tab = 'courses';
let courses = null; // compareCourses rows (see course-sync/plan.ts)
let loading = false;
let error = '';
let filter = 'all';
let search = '';
const busy = new Set(); // course ids with a move in flight
let selected = new Set();
let copierOpened = false;

export function initManageCourses() {
  view = document.getElementById('view-manage-courses');
  if (!view) return;

  document.getElementById('openCourseCopierAdminBtn')?.addEventListener('click', () => {
    document.getElementById('accountDropdownMenu')?.classList.remove('show');
    navigate(ROUTE);
  });
  view.querySelectorAll('[data-mc-tab]').forEach(btn =>
    btn.addEventListener('click', () => showTab(btn.dataset.mcTab)));

  const list = view.querySelector('[data-mc-panel="courses"]');
  list.addEventListener('click', onListClick);
  list.addEventListener('input', onListInput);
  list.addEventListener('change', onListChange);

  window.addEventListener('routeChanged', (e) => {
    if (e.detail.route === ROUTE) enter();
  });
  Bus.on(BUS_EVENT.AUTH_LOGIN, () => {
    if (getCurrentRoute() === ROUTE) enter();
  });
  Bus.on(BUS_EVENT.COURSE_DATA_CHANGED, () => { courses = null; });
}

function enter() {
  if (!isAdminUser(currentUser)) {
    panel().innerHTML = '<p class="mc-empty">Sign in as an admin to manage courses.</p>';
    return;
  }
  showTab(tab);
  if (!courses && !loading) load();
}

const panel = () => view.querySelector('[data-mc-panel="courses"]');

function showTab(name) {
  tab = name;
  view.querySelectorAll('[data-mc-tab]').forEach(btn =>
    btn.setAttribute('aria-selected', String(btn.dataset.mcTab === name)));
  view.querySelectorAll('[data-mc-panel]').forEach(p => { p.hidden = p.dataset.mcPanel !== name; });
  if (name === 'copy' && !copierOpened) {
    copierOpened = true;
    openCourseCopier();
  }
  if (name === 'courses') render();
}

// --- Data -------------------------------------------------------------------

async function load() {
  loading = true;
  error = '';
  render();
  try {
    courses = isProduction() ? await loadLocal() : await sync({ action: 'list' }).then(r => r.courses);
    const ids = new Set(courses.map(c => c.id));
    selected = new Set([...selected].filter(id => ids.has(id)));
  } catch (err) {
    error = err.message;
  }
  loading = false;
  render();
}

// On production there's no other side to compare with: list what's here.
async function loadLocal() {
  const { data, error: dbError } = await supabase
    .from('courses').select('id, title, is_published, sections(id, lessons(id))').order('title');
  if (dbError) throw dbError;
  return data.map(c => ({
    id: c.id,
    title: c.title,
    slug: courseSlug(c.title),
    where: 'production',
    isTest: false,
    staging: null,
    production: {
      published: c.is_published,
      sections: c.sections.length,
      lessons: c.sections.reduce((n, s) => n + s.lessons.length, 0),
    },
  }));
}

async function sync(body) {
  const { data, error: fnError } = await supabase.functions.invoke('course-sync', { body });
  if (fnError || data?.error) {
    let message = data?.error;
    try { message ??= (await fnError?.context?.json())?.error; } catch { /* not JSON */ }
    if (!message && fnError?.context?.status === 404) message = 'The course-sync function isn’t deployed to this project yet.';
    throw new Error(message || 'Couldn’t reach course-sync. Try again.');
  }
  return data;
}

// --- Render -----------------------------------------------------------------

function visibleCourses() {
  const q = search.trim().toLowerCase();
  return (courses || []).filter(c => {
    if (q && !c.title.toLowerCase().includes(q)) return false;
    if (filter === 'test') return c.isTest;
    if (filter !== 'all') return c.where === filter;
    return true;
  });
}

function render() {
  if (!view || tab !== 'courses' || !isAdminUser(currentUser)) return;
  const onProd = isProduction();
  const list = visibleCourses();
  const deletable = list.filter(c => c.staging);
  const allChecked = deletable.length > 0 && deletable.every(c => selected.has(c.id));
  const counts = Object.fromEntries(FILTERS.map(([id]) => [id,
    (courses || []).filter(c => id === 'all' || (id === 'test' ? c.isTest : c.where === id)).length]));

  panel().innerHTML = `
    <p class="mc-intro">${onProd
      ? 'This is production. New courses are published from staging’s Manage courses page.'
      : 'New courses go from staging to production once. After that, edit them on production and pull the changes back here.'}</p>

    <div class="mc-toolbar">
      <input type="search" class="mc-search" placeholder="Search courses…" value="${escapeHtml(search)}" aria-label="Search courses">
      ${onProd ? '' : `<div class="mc-chips" role="group" aria-label="Show">
        ${FILTERS.map(([id, label]) => `
          <button type="button" class="mc-chip${filter === id ? ' active' : ''}" data-filter="${id}">
            ${label} <span class="mc-chip-count">${counts[id]}</span>
          </button>`).join('')}
      </div>`}
      <button type="button" class="mc-btn" data-act="refresh" ${loading ? 'disabled' : ''}>${loading ? 'Loading…' : '↻ Refresh'}</button>
    </div>

    ${onProd ? '' : `
    <div class="mc-bulk">
      <label class="mc-check"><input type="checkbox" data-act="select-all" ${allChecked ? 'checked' : ''} ${deletable.length ? '' : 'disabled'}> Select shown</label>
      <span class="mc-bulk-count">${selected.size ? `${selected.size} selected` : ''}</span>
      <button type="button" class="mc-btn mc-btn-danger" data-act="delete-selected" ${selected.size ? '' : 'disabled'}>Delete from staging</button>
    </div>`}

    <div class="mc-status" role="status"></div>
    ${error ? `<p class="mc-error">${escapeHtml(error)}</p>` : ''}
    ${!courses && loading ? '<p class="mc-empty">Loading courses…</p>' : ''}
    ${courses && !list.length ? '<p class="mc-empty">No courses match.</p>' : ''}
    <ul class="mc-list">${list.map(rowHtml).join('')}</ul>
  `;
}

function badge(label, kind) {
  return `<span class="mc-badge mc-badge-${kind}">${label}</span>`;
}

function rowHtml(c) {
  const onProd = isProduction();
  const side = c.production ?? c.staging;
  const isBusy = busy.has(c.id);
  const where = onProd ? '' : {
    staging: badge('Staging only', 'staging'),
    both: badge('On production', 'live'),
    production: badge('Production only', 'prod'),
  }[c.where];
  const status = side.published ? '' : badge('Draft', 'draft');
  const test = c.isTest ? badge('Test', 'test') : '';

  const behind = c.where === 'both' && (c.staging.lessons !== c.production.lessons || c.staging.sections !== c.production.sections);
  const meta = c.where === 'both' && behind
    ? `Production: ${plural(c.production.sections, 'section')} · ${plural(c.production.lessons, 'lesson')} — staging has ${plural(c.staging.lessons, 'lesson')}`
    : `${plural(side.sections, 'section')} · ${plural(side.lessons, 'lesson')}`;

  const actions = [];
  if (onProd) {
    actions.push(btn('edit', 'Edit', true), btn('copy-link', 'Copy link'));
  } else if (c.where === 'staging') {
    actions.push(btn('publish', 'Publish to production', true), btn('edit', 'Edit'), btn('delete', 'Delete'));
  } else if (c.where === 'both') {
    actions.push(link(productionEditLink(c.title), 'Edit in production ↗', true),
      btn('pull', behind ? 'Pull changes' : 'Pull from production'), btn('copy-link', 'Copy link'), btn('delete', 'Delete staging copy'));
  } else {
    actions.push(btn('pull', 'Pull to staging', true), link(productionEditLink(c.title), 'Edit in production ↗'));
  }

  return `
    <li class="mc-row${isBusy ? ' is-busy' : ''}" data-id="${escapeHtml(c.id)}">
      ${!onProd && c.staging ? `<input type="checkbox" class="mc-row-check" aria-label="Select ${escapeHtml(c.title)}" ${selected.has(c.id) ? 'checked' : ''}>` : '<span class="mc-row-check"></span>'}
      <div class="mc-row-main">
        <div class="mc-row-title">${escapeHtml(c.title)} ${where}${status}${test}</div>
        <div class="mc-row-meta">${meta}${behind ? ' <span class="mc-behind">out of date</span>' : ''}</div>
      </div>
      <div class="mc-row-actions">${isBusy ? '<span class="mc-working">Working…</span>' : actions.join('')}</div>
    </li>`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const btn = (act, label, primary = false) =>
  `<button type="button" class="mc-btn${primary ? ' mc-btn-primary' : ''}" data-act="${act}">${label}</button>`;
const link = (href, label, primary = false) =>
  `<a class="mc-btn${primary ? ' mc-btn-primary' : ''}" href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>`;

function setStatus(message, kind = 'ok') {
  const el = panel().querySelector('.mc-status');
  if (!el) return;
  el.className = `mc-status mc-status-${kind}`;
  el.innerHTML = message;
}

// --- Events -----------------------------------------------------------------

function onListInput(e) {
  if (!e.target.matches('.mc-search')) return;
  search = e.target.value;
  const at = e.target.selectionStart;
  render();
  const input = panel().querySelector('.mc-search');
  input.focus();
  input.setSelectionRange(at, at);
}

function onListChange(e) {
  if (e.target.matches('.mc-row-check')) {
    const id = e.target.closest('.mc-row').dataset.id;
    if (e.target.checked) selected.add(id); else selected.delete(id);
    render();
  } else if (e.target.matches('[data-act="select-all"]')) {
    const ids = visibleCourses().filter(c => c.staging).map(c => c.id);
    ids.forEach(id => (e.target.checked ? selected.add(id) : selected.delete(id)));
    render();
  }
}

function onListClick(e) {
  const chip = e.target.closest('[data-filter]');
  if (chip) {
    filter = chip.dataset.filter;
    render();
    return;
  }
  const button = e.target.closest('button[data-act]');
  if (!button) return;
  const act = button.dataset.act;
  if (act === 'refresh') { load(); return; }
  if (act === 'delete-selected') { deleteCourses([...selected]); return; }
  const course = courses?.find(c => c.id === button.closest('.mc-row')?.dataset.id);
  if (!course) return;
  ({ publish, pull, edit, delete: (c) => deleteCourses([c.id]), 'copy-link': copyLink })[act]?.(course);
}

// Runs a move for one course; `work` returns the status message to show after reloading.
async function withBusy(course, work) {
  busy.add(course.id);
  render();
  let message;
  try {
    message = await work();
  } catch (err) {
    busy.delete(course.id);
    render();
    setStatus(escapeHtml(err.message), 'error');
    return;
  }
  busy.delete(course.id);
  await load();
  setStatus(message);
}

async function publish(course) {
  const live = course.staging.published ? 'published' : 'a draft';
  const ok = await confirmCustom(
    `“${course.title}” will be copied to production as ${live}, with its ${plural(course.staging.sections, 'section')} and ${plural(course.staging.lessons, 'lesson')}.\n\nAfter this, edit it on production and pull changes back to staging.`,
    'Publish to production', 'Publish', 'Cancel');
  if (!ok) return;
  await withBusy(course, async () => {
    const result = await sync({ action: 'publish', courseId: course.id });
    return `Published “${escapeHtml(course.title)}”. ${filesNote(result)}<a href="${escapeHtml(productionEditLink(course.title))}" target="_blank" rel="noopener">Open in production ↗</a>`;
  });
}

async function pull(course) {
  const message = course.where === 'production'
    ? `Copy “${course.title}” from production to staging?`
    : `Replace the staging copy of “${course.title}” with production’s version?\n\nAnything changed on staging only will be lost.`;
  const ok = await confirmCustom(message, 'Pull from production', 'Pull', 'Cancel');
  if (!ok) return;
  await withBusy(course, async () => {
    const result = await sync({ action: 'pull', courseId: course.id });
    Bus.emit(BUS_EVENT.COURSE_DATA_CHANGED);
    return `Pulled “${escapeHtml(course.title)}” from production. ${filesNote(result)}`;
  });
}

const filesNote = (result) => result?.failedFiles?.length
  ? `${plural(result.failedFiles.length, 'file')} (thumbnail or video) couldn’t be copied and still point at the other project. `
  : '';

async function deleteCourses(ids) {
  const chosen = (courses || []).filter(c => ids.includes(c.id) && c.staging);
  if (!chosen.length) return;
  const onBoth = chosen.filter(c => c.where === 'both').length;
  const names = chosen.length === 1 ? `“${chosen[0].title}”` : plural(chosen.length, 'course');
  const ok = await confirmCustom(
    `Delete ${names} from staging? This can’t be undone.` +
      (onBoth ? `\n\n${onBoth === 1 && chosen.length === 1 ? 'It’s' : `${onBoth} of them are`} also on production, which isn’t touched; pull ${onBoth === 1 ? 'it' : 'them'} back any time.` : ''),
    'Delete from staging', 'Delete', 'Cancel');
  if (!ok) return;
  chosen.forEach(c => busy.add(c.id));
  render();
  try {
    await sync({ action: 'delete', courseIds: chosen.map(c => c.id) });
    chosen.forEach(c => selected.delete(c.id));
    Bus.emit(BUS_EVENT.COURSE_DATA_CHANGED);
    chosen.forEach(c => busy.delete(c.id));
    await load();
    setStatus(`Deleted ${names} from staging.`);
  } catch (err) {
    chosen.forEach(c => busy.delete(c.id));
    render();
    setStatus(escapeHtml(err.message), 'error');
  }
}

async function edit(course) {
  const { data, error: dbError } = await supabase
    .from('courses').select('*, sections(*, lessons(*))').eq('id', course.id).single();
  if (dbError) { await alert(`Couldn’t open the course: ${dbError.message}`); return; }
  loadCourseToEdit(data);
}

async function copyLink(course) {
  const url = isProduction() ? courseLink(course.title) : courseLink(course.title, { origin: `${PRODUCTION_APP_URL}/` });
  try {
    await navigator.clipboard.writeText(url);
    setStatus(`Copied <code>${escapeHtml(url)}</code>`);
  } catch {
    setStatus(`Link: <code>${escapeHtml(url)}</code>`);
  }
}
