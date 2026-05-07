// Calibration Profiles
// Wraps the existing Advanced Calibration modal with named, duplicatable profile sets.
// Each profile stores per-note sensitivities from gp_cal / gp_multipliers / etc.
// Activating a profile writes its data into those same keys and signals transcription.js to reload.

import { openAdvancedCalibrationModal } from './transcription.js';

const PROFILES_KEY = 'cal_profiles';
const ACTIVE_KEY   = 'cal_active_profile';

// --- Storage helpers ---

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getProfiles() {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); } catch { return []; }
}

function storeProfiles(arr) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(arr));
}

export function getActiveProfileId() {
  return localStorage.getItem(ACTIVE_KEY) || null;
}

function setActiveProfileId(id) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

// --- Snapshot current gp_* calibration state ---

function snapshot() {
  return {
    cal:              JSON.parse(localStorage.getItem('gp_cal')              || '{}'),
    clarityProfiles:  JSON.parse(localStorage.getItem('gp_clarity_profiles') || '{}'),
    blossomTimes:     JSON.parse(localStorage.getItem('gp_blossom_times')    || '{}'),
    multipliers:      JSON.parse(localStorage.getItem('gp_multipliers')      || '{}'),
    clarityThreshold: parseFloat(localStorage.getItem('gp_clarity_threshold') || '0.5'),
  };
}

// Write a profile's calibration data into the active gp_* keys
function applyToStorage(profile) {
  localStorage.setItem('gp_cal',               JSON.stringify(profile.cal              || {}));
  localStorage.setItem('gp_clarity_profiles',  JSON.stringify(profile.clarityProfiles  || {}));
  localStorage.setItem('gp_blossom_times',     JSON.stringify(profile.blossomTimes     || {}));
  localStorage.setItem('gp_multipliers',       JSON.stringify(profile.multipliers      || {}));
  localStorage.setItem('gp_clarity_threshold', String(profile.clarityThreshold        ?? 0.5));
}

// --- CRUD ---

function createProfile(micName, location) {
  const profile = {
    id: genId(),
    micName: micName.trim() || 'Mic',
    location: location.trim() || 'Room',
    createdAt: new Date().toISOString(),
    ...snapshot(),
  };
  const profiles = getProfiles();
  profiles.unshift(profile);
  storeProfiles(profiles);
  return profile;
}

function duplicateProfile(id) {
  const profiles = getProfiles();
  const src = profiles.find(p => p.id === id);
  if (!src) return null;
  const copy = {
    ...JSON.parse(JSON.stringify(src)),
    id: genId(),
    location: src.location + ' (copy)',
    createdAt: new Date().toISOString(),
  };
  const idx = profiles.findIndex(p => p.id === id);
  profiles.splice(idx + 1, 0, copy);
  storeProfiles(profiles);
  return copy;
}

function deleteProfile(id) {
  storeProfiles(getProfiles().filter(p => p.id !== id));
  if (getActiveProfileId() === id) setActiveProfileId(null);
}

function renameProfile(id, micName, location) {
  const profiles = getProfiles();
  const p = profiles.find(p => p.id === id);
  if (!p) return;
  p.micName  = micName.trim()  || p.micName;
  p.location = location.trim() || p.location;
  storeProfiles(profiles);
}

// Activate: write profile data to gp_* keys, notify transcription.js to reload.
function activateProfile(id) {
  const profiles = getProfiles();
  const profile  = profiles.find(p => p.id === id);
  if (!profile) return;
  setActiveProfileId(id);
  applyToStorage(profile);
  window.dispatchEvent(new CustomEvent('cal-profile-activated', { detail: { id } }));
}

// Called whenever gp_* keys are updated externally (after advanced-cal saves).
// Writes the new values back into the active profile so it stays in sync.
export function syncActiveProfileFromStorage() {
  const id = getActiveProfileId();
  if (!id) return;
  const profiles = getProfiles();
  const idx = profiles.findIndex(p => p.id === id);
  if (idx === -1) return;
  profiles[idx] = { ...profiles[idx], ...snapshot() };
  storeProfiles(profiles);
}

// --- Modal helpers ---

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderList() {
  const container = document.getElementById('calProfilesList');
  if (!container) return;
  const profiles = getProfiles();
  const activeId  = getActiveProfileId();

  if (!profiles.length) {
    container.innerHTML = '<p class="cp-empty">No profiles yet. Click "Save Current Settings as Profile" to create one.</p>';
    return;
  }

  container.innerHTML = profiles.map(p => {
    const isActive = p.id === activeId;
    return `
      <div class="cp-row${isActive ? ' cp-row-active' : ''}" data-id="${p.id}">
        <div class="cp-row-main">
          <span class="cp-dot"></span>
          <div class="cp-row-info">
            <span class="cp-mic">${esc(p.micName)}</span>
            <span class="cp-loc">${esc(p.location)}</span>
          </div>
        </div>
        <div class="cp-row-actions">
          ${isActive
            ? '<span class="cp-active-badge">Active</span>'
            : `<button class="cp-btn cp-use-btn" data-id="${p.id}">Use</button>`}
          <button class="cp-btn cp-adjust-btn" data-id="${p.id}">Adjust</button>
          <button class="cp-btn cp-rename-btn" data-id="${p.id}">Rename</button>
          <button class="cp-btn cp-dup-btn"    data-id="${p.id}">Duplicate</button>
          <button class="cp-btn cp-del-btn"    data-id="${p.id}">Delete</button>
        </div>
      </div>`;
  }).join('');
}

// --- Sub-modal for naming a profile ---

let editingId = null; // null = create new

function openNameModal(id = null) {
  editingId = id;
  const modal = document.getElementById('cpNameModal');
  const title = document.getElementById('cpNameModalTitle');
  const micIn = document.getElementById('cpMicInput');
  const locIn = document.getElementById('cpLocInput');
  if (!modal) return;

  if (id) {
    const p = getProfiles().find(p => p.id === id);
    title.textContent = 'Rename Profile';
    micIn.value = p?.micName  || '';
    locIn.value = p?.location || '';
  } else {
    title.textContent = 'New Profile';
    micIn.value = '';
    locIn.value = '';
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => micIn.focus(), 50);
}

function closeNameModal() {
  editingId = null;
  const modal = document.getElementById('cpNameModal');
  if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
}

function confirmNameModal() {
  const micName  = document.getElementById('cpMicInput').value.trim();
  const location = document.getElementById('cpLocInput').value.trim();
  if (!micName) { document.getElementById('cpMicInput').focus(); return; }
  if (!location) { document.getElementById('cpLocInput').focus(); return; }

  if (editingId) {
    renameProfile(editingId, micName, location);
  } else {
    const p = createProfile(micName, location);
    activateProfile(p.id);
  }
  closeNameModal();
  renderList();
}

// --- Profiles modal open/close ---

export function openCalProfilesModal() {
  renderList();
  const modal = document.getElementById('calProfilesModal');
  if (modal) { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
}

function closeCalProfilesModal() {
  const modal = document.getElementById('calProfilesModal');
  if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
}

// --- Init ---

export function initCalProfiles() {
  // Profiles modal
  document.getElementById('closeCalProfilesBtn')
    ?.addEventListener('click', closeCalProfilesModal);
  document.getElementById('calProfilesModal')
    ?.addEventListener('pointerdown', e => { if (e.target.id === 'calProfilesModal') closeCalProfilesModal(); });

  // "Save current settings as profile" button
  document.getElementById('calProfileCreateBtn')
    ?.addEventListener('click', () => openNameModal(null));

  // Delegated events on the list
  document.getElementById('calProfilesList')
    ?.addEventListener('click', e => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (!id) return;
      if (e.target.closest('.cp-use-btn')) {
        activateProfile(id);
        renderList();
      } else if (e.target.closest('.cp-adjust-btn')) {
        // Activate so Advanced Cal reads this profile's data, then open it
        if (id !== getActiveProfileId()) {
          activateProfile(id);
          renderList();
        }
        closeCalProfilesModal();
        openAdvancedCalibrationModal();
      } else if (e.target.closest('.cp-rename-btn')) {
        openNameModal(id);
      } else if (e.target.closest('.cp-dup-btn')) {
        duplicateProfile(id);
        renderList();
      } else if (e.target.closest('.cp-del-btn')) {
        if (window.confirm('Delete this calibration profile?')) {
          deleteProfile(id);
          renderList();
        }
      }
    });

  // Name sub-modal
  document.getElementById('cpNameCancelBtn')?.addEventListener('click', closeNameModal);
  document.getElementById('cpNameSaveBtn')?.addEventListener('click', confirmNameModal);
  document.getElementById('cpNameModal')
    ?.addEventListener('pointerdown', e => { if (e.target.id === 'cpNameModal') closeNameModal(); });
  ['cpMicInput', 'cpLocInput'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') confirmNameModal();
      if (e.key === 'Escape') closeNameModal();
    })
  );

  // FR header Calibration button
  document.getElementById('frCalBtn')?.addEventListener('click', openCalProfilesModal);

  // Sync active profile whenever Advanced Cal saves
  window.addEventListener('cal-data-changed', syncActiveProfileFromStorage);
}
