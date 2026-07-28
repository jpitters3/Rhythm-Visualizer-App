/**
 * js/notification-settings.js
 * Per-user notification preferences: in-app and email toggles per type.
 * Preferences are loaded on login and exposed to:
 *   - notifications.js  (filter in-app panel + badge)
 *   - account-settings.js  (render toggles in the settings sidebar)
 */

import { currentUser } from './state.js';
import { currentProfile } from './profile.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';

// DB-trigger aliases share prefs with their canonical frontend type.
const TYPE_ALIAS = {
  assignment_assigned: 'new_assignment',
  assignment_reviewed: 'assignment_complete',
};

export const NOTIF_TYPES = [
  { type: 'new_assignment',       label: 'New assignment',       roles: ['student'] },
  { type: 'assignment_feedback',  label: 'Assignment sent back', roles: ['student'] },
  { type: 'assignment_complete',  label: 'Assignment complete',  roles: ['student'] },
  { type: 'assignment_submitted', label: 'Student submitted',    roles: ['teacher', 'admin'] },
  { type: 'practice_reminder',    label: 'Practice reminders',   roles: ['student'] },
];

// prefs: canonical type → { in_app: bool, email: bool }
let prefs = new Map();

// ===== INIT =====

export function initNotificationSettings() {
  Bus.on(BUS_EVENT.AUTH_LOGIN, loadPrefs);
  Bus.on(BUS_EVENT.AUTH_LOGOUT, () => prefs.clear());
  if (currentUser) loadPrefs();
}

async function loadPrefs() {
  if (!currentUser) return;
  const { data } = await supabase
    .from('notification_preferences')
    .select('notif_type, in_app, email')
    .eq('user_id', currentUser.id);

  prefs.clear();
  (data || []).forEach(row => prefs.set(row.notif_type, { in_app: row.in_app, email: row.email }));
}

// ===== PUBLIC HELPERS =====

function canonical(type) {
  return TYPE_ALIAS[type] ?? type;
}

export function isInAppEnabled(type) {
  return prefs.get(canonical(type))?.in_app ?? true;
}

export function isEmailEnabled(type) {
  return prefs.get(canonical(type))?.email ?? true;
}

// ===== RENDER (called by account-settings.js) =====

export function renderNotifSettings(container) {
  if (!container) return;
  const role = currentProfile?.role ?? 'student';
  const rows = NOTIF_TYPES.filter(t => t.roles.includes(role));

  container.innerHTML = `
    <div class="acct-notif-header-row">
      <div></div>
      <div class="acct-notif-col-header">In-App</div>
      <div class="acct-notif-col-header">Email</div>
    </div>
    ${rows.map(t => {
      const p = prefs.get(t.type) ?? { in_app: true, email: true };
      return `
        <div class="acct-notif-row">
          <div class="acct-notif-row-label">${t.label}</div>
          <div class="acct-notif-toggle-cell">
            <label class="notif-toggle">
              <input type="checkbox" data-type="${t.type}" data-channel="in_app" ${p.in_app ? 'checked' : ''} />
              <span class="notif-toggle-track"></span>
            </label>
          </div>
          <div class="acct-notif-toggle-cell">
            <label class="notif-toggle">
              <input type="checkbox" data-type="${t.type}" data-channel="email" ${p.email ? 'checked' : ''} />
              <span class="notif-toggle-track"></span>
            </label>
          </div>
        </div>
      `;
    }).join('')}
  `;

  container.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', () =>
      saveToggle(input.dataset.type, input.dataset.channel, input.checked));
  });
}

async function saveToggle(type, channel, value) {
  console.log('[NotificationSettings] saveToggle', { type, channel, value, userId: currentUser?.id });
  if (!currentUser) return;
  const existing = prefs.get(type) ?? { in_app: true, email: true };
  const updated = { ...existing, [channel]: value };
  prefs.set(type, updated);

  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert(
      { user_id: currentUser.id, notif_type: type, in_app: updated.in_app, email: updated.email }
    )
    .select();

  console.log('[NotificationSettings] upsert result:', { data, error });
}
