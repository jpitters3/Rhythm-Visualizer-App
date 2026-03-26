/**
 * js/notifications.js
 * In-app notification bell for students and teachers.
 * Loads unread notifications from the `notifications` table,
 * renders a dropdown panel, and marks notifications as read.
 */

import { currentUser } from './state.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';
import { escapeHtml } from './utils.js';

// ===== STATE =====
let bellBtn = null;
let badgeEl = null;
let wrapperEl = null;
let panel = null;
let notifications = [];
let unreadCount = 0;
let panelOpen = false;

// ===== INIT =====

export function initNotifications() {
  bellBtn = document.getElementById('notifBell');
  badgeEl = document.getElementById('notifBadge');
  wrapperEl = document.getElementById('notifBellWrapper');
  panel = document.getElementById('notifPanel');

  if (!bellBtn || !panel) return;

  bellBtn.addEventListener('click', e => {
    e.stopPropagation();
    togglePanel();
  });

  document.addEventListener('click', e => {
    if (panelOpen && !panel.contains(e.target) && e.target !== bellBtn) {
      closePanel();
    }
  });

  panel.addEventListener('click', handlePanelClick);

  Bus.on(BUS_EVENT.AUTH_LOGIN, () => {
    if (wrapperEl) wrapperEl.style.display = '';
    loadNotifications();
  });

  Bus.on(BUS_EVENT.AUTH_LOGOUT, () => {
    if (wrapperEl) wrapperEl.style.display = 'none';
    notifications = [];
    unreadCount = 0;
    updateBadge();
    closePanel();
  });

  // AUTH_LOGIN may have already fired before this module initialized
  if (currentUser) {
    if (wrapperEl) wrapperEl.style.display = '';
    loadNotifications();
  }
}

// ===== LOAD =====

export async function loadNotifications() {
  if (!currentUser) return;

  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, data, read_at, created_at')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[Notifications] load error:', error);
    return;
  }

  notifications = data || [];
  unreadCount = notifications.filter(n => !n.read_at).length;
  updateBadge();
}

// ===== BADGE =====

function updateBadge() {
  if (!badgeEl) return;
  if (unreadCount > 0) {
    badgeEl.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
    badgeEl.style.display = '';
  } else {
    badgeEl.style.display = 'none';
  }
}

// ===== PANEL =====

function togglePanel() {
  panelOpen ? closePanel() : openPanel();
}

function openPanel() {
  if (!panel) return;
  panelOpen = true;
  renderPanel();
  panel.classList.add('open');
  markAllRead();
}

function closePanel() {
  if (!panel) return;
  panelOpen = false;
  panel.classList.remove('open');
}

function renderPanel() {
  if (!panel) return;

  if (notifications.length === 0) {
    panel.innerHTML = '<div class="notif-empty">No notifications yet.</div>';
    return;
  }

  panel.innerHTML = `
    <div class="notif-panel-header">Notifications</div>
    ${notifications.map(n => {
      const timeStr = formatRelativeTime(n.created_at);
      const unreadCls = n.read_at ? '' : ' unread';
      return `
        <div class="notif-item${unreadCls}" data-id="${n.id}" data-type="${escapeHtml(n.type)}">
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          ${n.body ? `<div class="notif-item-body">${escapeHtml(n.body)}</div>` : ''}
          <div class="notif-item-time">${timeStr}</div>
        </div>
      `;
    }).join('')}
  `;
}

function handlePanelClick(e) {
  const item = e.target.closest('.notif-item');
  if (!item) return;
  closePanel();
  const type = item.dataset.type;
  if (type === 'new_assignment' || type === 'assignment_feedback' || type === 'assignment_complete') {
    Bus.emit(BUS_EVENT.OPEN_STUDENT_ASSIGNMENTS);
  }
}

async function markAllRead() {
  const unreadIds = notifications.filter(n => !n.read_at).map(n => n.id);
  if (unreadIds.length === 0) return;

  const now = new Date().toISOString();
  await supabase
    .from('notifications')
    .update({ read_at: now })
    .in('id', unreadIds);

  notifications.forEach(n => {
    if (unreadIds.includes(n.id)) n.read_at = now;
  });
  unreadCount = 0;
  updateBadge();
}

// ===== HELPERS =====

function formatRelativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
