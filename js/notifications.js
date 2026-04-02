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
import { isInAppEnabled } from './notification-settings.js';

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
  unreadCount = notifications.filter(n => !n.read_at && isInAppEnabled(n.type)).length;
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

  const visible = notifications.filter(n => isInAppEnabled(n.type));

  if (visible.length === 0) {
    panel.innerHTML = '<div class="notif-panel-header">Notifications</div><div class="notif-empty">No notifications yet.</div>';
    return;
  }

  panel.innerHTML = `
    <div class="notif-panel-header">Notifications</div>
    ${visible.map(n => {
      const timeStr = formatRelativeTime(n.created_at);
      const unreadCls = n.read_at ? '' : ' unread';
      if (n.type === 'teacher_invitation') {
        const invId = n.data?.invitation_id ?? '';
        const result = n.data?.result;
        const actionsHtml = result
          ? `<span class="notif-invite-result${result === 'declined' ? ' notif-invite-result--declined' : ''}">${result === 'accepted' ? 'Accepted' : 'Declined'}</span>`
          : `<button class="notif-accept-btn" data-inv-id="${escapeHtml(invId)}">Accept</button>
             <button class="notif-decline-btn" data-inv-id="${escapeHtml(invId)}">Decline</button>`;
        return `
          <div class="notif-item${unreadCls}" data-id="${n.id}" data-type="teacher_invitation" data-inv-id="${escapeHtml(invId)}">
            <div class="notif-item-title">${escapeHtml(n.title)}</div>
            ${n.body ? `<div class="notif-item-body">${escapeHtml(n.body)}</div>` : ''}
            <div class="notif-item-time">${timeStr}</div>
            <div class="notif-item-actions">${actionsHtml}</div>
          </div>
        `;
      }
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

const STUDENT_ASSIGNMENT_TYPES = new Set([
  'new_assignment', 'assignment_assigned', 'assignment_feedback',
  'assignment_complete', 'assignment_reviewed',
]);
const TEACHER_ASSIGNMENT_TYPES = new Set(['assignment_submitted']);

async function resolveInvitationNotification(item, result) {
  const notifId = item.dataset.id;
  const notif = notifications.find(n => n.id === notifId);
  if (notif) {
    notif.data = { ...notif.data, result };
    await supabase
      .from('notifications')
      .update({ data: notif.data })
      .eq('id', notifId);
  }
  const resultCls = result === 'declined' ? ' notif-invite-result--declined' : '';
  const label = result === 'accepted' ? 'Accepted' : 'Declined';
  item.querySelector('.notif-item-actions').innerHTML =
    `<span class="notif-invite-result${resultCls}">${label}</span>`;
}

async function handlePanelClick(e) {
  // Accept invitation button
  if (e.target.classList.contains('notif-accept-btn')) {
    const invId = e.target.dataset.invId;
    const item = e.target.closest('.notif-item');
    e.target.disabled = true;
    const { error } = await supabase.rpc('accept_teacher_invitation', { p_invitation_id: invId });
    if (error) {
      if (error.message?.includes('not found or already processed')) {
        await resolveInvitationNotification(item, 'accepted');
      } else {
        e.target.disabled = false;
        console.error('[Notifications] accept error:', error);
      }
      return;
    }
    await resolveInvitationNotification(item, 'accepted');
    return;
  }

  // Decline invitation button
  if (e.target.classList.contains('notif-decline-btn')) {
    const invId = e.target.dataset.invId;
    const item = e.target.closest('.notif-item');
    e.target.disabled = true;
    const { error } = await supabase.rpc('decline_teacher_invitation', { p_invitation_id: invId });
    if (error) {
      if (error.message?.includes('not found or already processed')) {
        await resolveInvitationNotification(item, 'accepted');
      } else {
        e.target.disabled = false;
        console.error('[Notifications] decline error:', error);
      }
      return;
    }
    await resolveInvitationNotification(item, 'declined');
    return;
  }

  const item = e.target.closest('.notif-item');
  if (!item) return;
  closePanel();
  const type = item.dataset.type;
  if (STUDENT_ASSIGNMENT_TYPES.has(type)) {
    Bus.emit(BUS_EVENT.OPEN_STUDENT_ASSIGNMENTS);
  } else if (TEACHER_ASSIGNMENT_TYPES.has(type)) {
    Bus.emit(BUS_EVENT.OPEN_ASSIGNMENTS);
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
