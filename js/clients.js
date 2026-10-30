// Clients (route #clients, admin only): active mentorship and group clients,
// read live from Tekmatix via the tekmatix-clients edge function.

import { supabase } from './supabase-client.js';
import { currentUser, isAdminUser } from './state.js';
import { navigate } from './router.js';
import { Bus, BUS_EVENT } from './bus.js';

const SORT_KEY = 'clients_sort';
const PROGRAM_LABELS = { mentorship: 'Mentorship', group: 'Group' };

let clients = null; // cached for the session; Refresh re-fetches
let loading = false;
let error = '';
let sortBy = readSort();
let program = 'all';

export function initClients() {
  const view = document.getElementById('view-clients');
  if (!view) return;

  document.getElementById('openClientsAdminBtn')?.addEventListener('click', () => navigate('clients'));
  window.addEventListener('routeChanged', (e) => {
    if (e.detail.route === 'clients') enter(view);
  });
  // A cold load on #clients routes before auth resolves.
  Bus.on(BUS_EVENT.AUTH_LOGIN, () => {
    if (document.body.classList.contains('route-clients')) enter(view);
  });
  if (document.body.classList.contains('route-clients')) enter(view);
}

function enter(view) {
  if (!isAdminUser(currentUser)) {
    view.innerHTML = '<div class="cl-container"><p class="cl-empty">Sign in as an admin to see clients.</p></div>';
    return;
  }
  render(view);
  if (!clients && !loading) load(view);
}

async function load(view) {
  loading = true;
  error = '';
  render(view);
  const { data, error: fnError } = await supabase.functions.invoke('tekmatix-clients');
  loading = false;
  if (fnError || data?.error) error = data?.error || 'Couldn’t reach Tekmatix. Try Refresh.';
  else clients = data.clients;
  render(view);
}

function readSort() {
  try { return localStorage.getItem(SORT_KEY) || 'next'; } catch { return 'next'; }
}

function saveSort(value) {
  try { localStorage.setItem(SORT_KEY, value); } catch { /* private mode */ }
}

const time = (appt) => appt ? new Date(appt.at).getTime() : null;

// Missing dates sort last for "next", first for "longest since seen".
function sorted(list) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const compare = {
    next: (a, b) => (time(a.nextAppointment) ?? Infinity) - (time(b.nextAppointment) ?? Infinity) || byName(a, b),
    stale: (a, b) => (time(a.lastAppointment) ?? -Infinity) - (time(b.lastAppointment) ?? -Infinity) || byName(a, b),
    name: byName,
  }[sortBy] || byName;
  return [...list].sort(compare);
}

function render(view) {
  const visible = clients ? sorted(clients.filter(c => program === 'all' || c.programs.includes(program))) : [];
  const chip = (value, label) =>
    `<button type="button" class="cl-chip${program === value ? ' active' : ''}" data-program="${value}">${label}</button>`;

  view.innerHTML = `
    <div class="cl-container">
      <header class="cl-header">
        <div>
          <p class="cl-eyebrow">Tekmatix</p>
          <h1 class="cl-title">Clients</h1>
        </div>
        <button type="button" class="cl-refresh" ${loading ? 'disabled' : ''}>${loading ? 'Loading…' : '↻ Refresh'}</button>
      </header>
      <div class="cl-toolbar">
        <div class="cl-chips">
          ${chip('all', 'All')}${chip('mentorship', 'Mentorship')}${chip('group', 'Group')}
        </div>
        <label class="cl-sort">Sort
          <select>
            <option value="next">Next appointment</option>
            <option value="stale">Longest since seen</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      ${error ? `<p class="cl-error">${escapeHtml(error)}</p>` : ''}
      ${clients && !visible.length ? '<p class="cl-empty">No clients tagged “client mentorship” or “client group” yet.</p>' : ''}
      <div class="cl-grid">${visible.map(card).join('')}</div>
    </div>
    <dialog class="cl-reader">
      <div class="cl-reader-head">
        <div>
          <p class="cl-eyebrow cl-reader-who"></p>
          <h2 class="cl-reader-title"></h2>
        </div>
        <button type="button" class="cl-reader-close" aria-label="Close">✕</button>
      </div>
      <div class="cl-reader-body"></div>
    </dialog>
  `;

  const select = view.querySelector('.cl-sort select');
  select.value = sortBy;
  select.addEventListener('change', () => {
    sortBy = select.value;
    saveSort(sortBy);
    render(view);
  });
  view.querySelectorAll('.cl-chip').forEach(btn => btn.addEventListener('click', () => {
    program = btn.dataset.program;
    render(view);
  }));
  view.querySelector('.cl-refresh').addEventListener('click', () => load(view));
  view.querySelectorAll('[data-summary]').forEach(btn => btn.addEventListener('click', () => {
    openReader(view, clients.find(c => c.id === btn.dataset.summary));
  }));

  const reader = view.querySelector('.cl-reader');
  reader.querySelector('.cl-reader-close').addEventListener('click', () => reader.close());
  reader.addEventListener('click', (e) => { if (e.target === reader) reader.close(); }); // backdrop
}

function card(c) {
  const initials = c.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const photo = c.photo
    ? `<img class="cl-photo" src="${escapeAttr(c.photo)}" alt="" loading="lazy">`
    : `<div class="cl-photo cl-photo-initials" aria-hidden="true">${escapeHtml(initials)}</div>`;
  const badges = c.programs.map(p => `<span class="cl-badge" data-program="${p}">${PROGRAM_LABELS[p]}</span>`).join('');
  const preview = c.summary?.text?.trim();

  return `
    <article class="cl-card" data-client="${escapeAttr(c.id)}">
      ${photo}
      <div class="cl-body">
        <div class="cl-name-row">
          <h2 class="cl-name">${escapeHtml(c.name)}</h2>
          <div class="cl-badges">${badges}</div>
        </div>
        <dl class="cl-dates">
          <div><dt>Next</dt><dd>${apptLabel(c.nextAppointment)}</dd></div>
          <div><dt>Last</dt><dd>${apptLabel(c.lastAppointment)}</dd></div>
        </dl>
        ${preview
          ? `<button type="button" class="cl-summary" data-summary="${escapeAttr(c.id)}">
               <span class="cl-summary-label">Lesson summary · ${shortDate(c.summary.at)}</span>
               <span class="cl-summary-text">${escapeHtml(preview)}</span>
             </button>`
          : '<p class="cl-summary cl-summary-none">No lesson summary yet</p>'}
        <div class="cl-actions">
          ${c.videoUrl
            ? `<a class="cl-action" href="${escapeAttr(safeUrl(c.videoUrl))}" target="_blank" rel="noopener">▶ Latest lesson video</a>`
            : '<span class="cl-action cl-action-off">No video link</span>'}
          <a class="cl-action" href="${escapeAttr(c.profileUrl)}" target="_blank" rel="noopener">Open in Tekmatix ↗</a>
        </div>
      </div>
    </article>
  `;
}

function openReader(view, client) {
  if (!client?.summary) return;
  const reader = view.querySelector('.cl-reader');
  reader.querySelector('.cl-reader-who').textContent = `${client.name} · ${shortDate(client.summary.at)}`;
  reader.querySelector('.cl-reader-title').textContent = client.summary.title || 'Lesson summary';
  const body = reader.querySelector('.cl-reader-body');
  body.replaceChildren(sanitizeNote(client.summary.html || escapeHtml(client.summary.text)));
  reader.showModal();
  body.scrollTop = 0;
}

function apptLabel(appt) {
  if (!appt) return '<span class="cl-muted">—</span>';
  const at = new Date(appt.at);
  const when = at.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${escapeHtml(when)} <span class="cl-muted">${relativeDays(at)}</span>`;
}

function relativeDays(date) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(new Date())) / 86400000);
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(days, 'day');
}

function shortDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

// Notes are CRM HTML (e.g. pasted Zoom AI summaries): keep basic formatting,
// drop everything else (scripts, styles, attributes, event handlers).
const ALLOWED_TAGS = new Set(['P', 'BR', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'A', 'DIV', 'SPAN']);
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'TEMPLATE', 'SVG', 'MATH']);

function sanitizeNote(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createDocumentFragment();
  const copy = (node, parent) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        parent.append(child.textContent);
      } else if (child.nodeType === Node.ELEMENT_NODE && !DROPPED_TAGS.has(child.tagName)) {
        if (!ALLOWED_TAGS.has(child.tagName)) { copy(child, parent); continue; }
        const el = document.createElement(child.tagName);
        if (child.tagName === 'A' && safeUrl(child.getAttribute('href')) !== '#') {
          el.href = child.getAttribute('href');
          el.target = '_blank';
          el.rel = 'noopener';
        }
        copy(child, el);
        parent.append(el);
      }
    }
  };
  copy(doc.body, out);
  return out;
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || '') ? url : '#';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const escapeAttr = escapeHtml;
