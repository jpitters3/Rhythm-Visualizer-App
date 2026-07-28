// Dashboard "Set/Manage Reminders" — recurring practice reminders, configured
// like a recurring calendar event (frequency, days, time, lead time).
// This module only saves the configuration; actual sending (email/push) is
// a separate, later piece.

import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';
import { alert, confirm } from './alert.js';
import { Modal } from './modal.js';

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_NAMES  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LEAD_LABELS = { 0: 'at the scheduled time', 15: '15 min before', 30: '30 min before', 60: '1 hour before' };

let reminders = [];
let editingId = null;
let selectedDays = new Set();
let modal = null;

// The time picker is three <select>s (hour / 15-min-step minute / AM-PM)
// rather than a native <input type="time"> — that guarantees only :00/:15/
// :30/:45 are ever selectable (the cron job only ticks every 15 min, so
// anything else would just never fire), and lets it be styled to match the
// rest of the app instead of each browser's own time-input chrome.
function to24h(hour12, minute, ampm) {
  let h = Number(hour12) % 12;
  if (ampm === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${minute}`;
}

function from24h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  // Defensive rounding in case a row predates the 15-min constraint.
  const minute = String(Math.round(m / 15) * 15 % 60).padStart(2, '0');
  return { hour12, minute, ampm };
}

function timeLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function summarize(r) {
  const days = r.frequency === 'daily'
    ? 'Every day'
    : (r.days_of_week || []).slice().sort().map(d => DAY_LABELS[d]).join(', ') || 'No days selected';
  const channels = [r.notify_email && 'Email', r.notify_push && 'Push'].filter(Boolean).join(' + ') || 'No channel selected';
  return `${days} · ${timeLabel(r.time_of_day.slice(0, 5))} (${LEAD_LABELS[r.lead_minutes] ?? `${r.lead_minutes} min before`}) · ${channels}`;
}

async function fetchReminders() {
  if (!currentUser) { reminders = []; return; }
  const { data, error } = await supabase
    .from('practice_reminders')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('time_of_day', { ascending: true });
  if (error) { console.error('[Reminders] fetch error:', error); reminders = []; return; }
  reminders = data || [];
}

export async function refreshRemindersButton(hidden = false) {
  const btn = document.getElementById('dashRemindersBtn');
  if (!btn) return;
  if (hidden || !currentUser) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  await fetchReminders();
  btn.textContent = reminders.length ? 'Manage Reminders' : 'Set Reminders';
}

function renderList() {
  const list = document.getElementById('remindersList');
  if (!list) return;
  if (!reminders.length) {
    list.innerHTML = '<div class="dash-list-empty">No reminders set yet.</div>';
    return;
  }
  list.innerHTML = reminders.map(r => `
    <div class="reminder-row${r.enabled ? '' : ' reminder-row--disabled'}" data-id="${r.id}">
      <label class="reminder-toggle">
        <input type="checkbox" class="reminder-enabled-check" ${r.enabled ? 'checked' : ''} />
        <span class="reminder-toggle-slider"></span>
      </label>
      <span class="reminder-summary">${summarize(r)}</span>
      <button type="button" class="reminder-edit-btn" title="Edit">✏️</button>
      <button type="button" class="reminder-delete-btn" title="Delete">🗑️</button>
    </div>
  `).join('');

  list.querySelectorAll('.reminder-row').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('.reminder-enabled-check').addEventListener('change', (e) => toggleEnabled(id, e.target.checked));
    row.querySelector('.reminder-edit-btn').addEventListener('click', () => openEditor(reminders.find(r => r.id === id)));
    row.querySelector('.reminder-delete-btn').addEventListener('click', () => deleteReminder(id));
  });
}

function showView(view) {
  document.getElementById('remindersListView').style.display = view === 'list' ? '' : 'none';
  document.getElementById('reminderEditorView').style.display = view === 'editor' ? '' : 'none';
}

function openEditor(existing) {
  editingId = existing?.id ?? null;
  selectedDays = new Set(existing?.days_of_week ?? []);

  document.getElementById('reminderFrequency').value = existing?.frequency ?? 'daily';
  const { hour12, minute, ampm } = from24h(existing?.time_of_day?.slice(0, 5) ?? '18:00');
  document.getElementById('reminderHour').value = String(hour12);
  document.getElementById('reminderMinute').value = minute;
  document.getElementById('reminderAmPm').value = ampm;
  document.getElementById('reminderLead').value = String(existing?.lead_minutes ?? 0);
  document.getElementById('reminderNotifyEmail').checked = existing?.notify_email ?? true;
  document.getElementById('reminderNotifyPush').checked = existing?.notify_push ?? false;
  document.getElementById('reminderDeleteInEditorBtn').style.display = existing ? '' : 'none';

  syncDayPills();
  syncFrequencyUI();
  showView('editor');
}

function syncFrequencyUI() {
  const isWeekly = document.getElementById('reminderFrequency').value === 'weekly';
  document.getElementById('reminderDaysRow').style.display = isWeekly ? '' : 'none';
}

function syncDayPills() {
  document.querySelectorAll('.reminder-day-pill').forEach(btn => {
    btn.classList.toggle('active', selectedDays.has(Number(btn.dataset.day)));
  });
}

async function saveReminder() {
  const frequency = document.getElementById('reminderFrequency').value;
  const time_of_day = to24h(
    document.getElementById('reminderHour').value,
    document.getElementById('reminderMinute').value,
    document.getElementById('reminderAmPm').value,
  );
  const lead_minutes = Number(document.getElementById('reminderLead').value);
  const notify_email = document.getElementById('reminderNotifyEmail').checked;
  const notify_push = document.getElementById('reminderNotifyPush').checked;

  if (frequency === 'weekly' && selectedDays.size === 0) {
    await alert('Please choose at least one day.');
    return;
  }
  if (!notify_email && !notify_push) {
    await alert('Please choose at least one way to be notified.');
    return;
  }

  const row = {
    user_id: currentUser.id,
    frequency,
    days_of_week: frequency === 'weekly' ? Array.from(selectedDays).sort() : [],
    time_of_day,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    lead_minutes,
    notify_email,
    notify_push,
    enabled: true,
  };

  const query = editingId
    ? supabase.from('practice_reminders').update(row).eq('id', editingId)
    : supabase.from('practice_reminders').insert(row);

  const { error } = await query;
  if (error) {
    console.error('[Reminders] save error:', error);
    await alert('Could not save reminder.');
    return;
  }

  await fetchReminders();
  renderList();
  await refreshRemindersButton();
  showView('list');
}

async function deleteReminder(id) {
  if (!await confirm('Delete this reminder?')) return;
  const { error } = await supabase.from('practice_reminders').delete().eq('id', id);
  if (error) { await alert('Could not delete reminder.'); return; }
  await fetchReminders();
  renderList();
  await refreshRemindersButton();
}

async function toggleEnabled(id, enabled) {
  const { error } = await supabase.from('practice_reminders').update({ enabled }).eq('id', id);
  if (error) { await alert('Could not update reminder.'); return; }
  const r = reminders.find(x => x.id === id);
  if (r) r.enabled = enabled;
  const row = document.querySelector(`.reminder-row[data-id="${id}"]`);
  row?.classList.toggle('reminder-row--disabled', !enabled);
}

export function initPracticeReminders() {
  const overlay = document.getElementById('remindersModal');
  if (!overlay) return;
  modal = new Modal(overlay);

  document.getElementById('dashRemindersBtn')?.addEventListener('click', async () => {
    await fetchReminders();
    renderList();
    showView('list');
    modal.open();
  });

  overlay.querySelectorAll('.close-modal-btn').forEach(btn => btn.addEventListener('click', () => modal.close()));

  document.getElementById('addReminderBtn')?.addEventListener('click', () => openEditor(null));
  document.getElementById('reminderCancelBtn')?.addEventListener('click', () => showView('list'));
  document.getElementById('reminderSaveBtn')?.addEventListener('click', saveReminder);
  document.getElementById('reminderDeleteInEditorBtn')?.addEventListener('click', async () => {
    if (!editingId) return;
    await deleteReminder(editingId);
    showView('list');
  });

  document.getElementById('reminderFrequency')?.addEventListener('change', syncFrequencyUI);

  document.querySelectorAll('.reminder-day-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = Number(btn.dataset.day);
      selectedDays.has(day) ? selectedDays.delete(day) : selectedDays.add(day);
      syncDayPills();
    });
  });
}
