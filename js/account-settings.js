/**
 * js/account-settings.js
 * Right-side settings sidebar: Account info + Notification preferences.
 * Opens when the logged-in user clicks "Account Settings".
 */

import { currentUser } from './state.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';
import { renderNotifSettings } from './notification-settings.js';
import { openAuthModal } from './auth.js';
import { startTour, resetTour } from './onboarding-tour.js';
import { currentProfile, updateUserAccentColor } from './profile.js';
import { navigate } from './router.js';
import { loadDashboard } from './dashboard.js';

const ACCENT_CHOICES = [
  { id: 'blue',   label: 'Blue' },
  { id: 'purple', label: 'Purple' },
];

let sidebarEl = null;
let backdropEl = null;

// ===== INIT =====

export function initAccountSettings() {
  sidebarEl = document.getElementById('accountSettingsSidebar');
  backdropEl = document.getElementById('accountSettingsBackdrop');
  if (!sidebarEl) return;

  document.getElementById('closeAccountSettingsSidebar')
    ?.addEventListener('click', close);

  backdropEl?.addEventListener('click', close);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sidebarEl.classList.contains('open')) close();
  });

  Bus.on(BUS_EVENT.AUTH_LOGOUT, close);
}

// ===== OPEN / CLOSE =====

export function open() {
  if (!sidebarEl || !currentUser) return;
  renderSidebar();
  sidebarEl.classList.add('open');
  sidebarEl.setAttribute('aria-hidden', 'false');
  backdropEl?.classList.add('open');
}

function close() {
  if (!sidebarEl) return;
  sidebarEl.classList.remove('open');
  sidebarEl.setAttribute('aria-hidden', 'true');
  backdropEl?.classList.remove('open');
}

// ===== RENDER =====

function renderSidebar() {
  const body = sidebarEl.querySelector('#accountSettingsBody');
  if (!body) return;

  body.innerHTML = `
    <div class="acct-section">
      <div class="acct-section-title">Account</div>
      <div class="acct-email-row">
        <span class="acct-email-label">${currentUser.email}</span>
        <button class="acct-link-btn" id="acctChangeEmailBtn">Change</button>
      </div>
      <button class="acct-link-btn" id="acctChangePasswordBtn">Change password</button>
    </div>

    <div class="acct-section">
      <div class="acct-section-title">Appearance</div>
      <div class="acct-row">
        <span class="acct-row-label">Theme colour</span>
        <div class="acct-accent-swatches">
          ${ACCENT_CHOICES.map(c => `
            <button class="acct-accent-swatch acct-accent-swatch--${c.id}" data-accent="${c.id}" title="${c.label}" aria-label="${c.label} accent colour"></button>
          `).join('')}
        </div>
      </div>
      <label class="acct-toggle-row" for="acctThemeToggle">
        <span class="acct-toggle-label">Dark mode</span>
        <span class="acct-toggle">
          <input type="checkbox" id="acctThemeToggle" />
          <span class="acct-toggle-slider"></span>
        </span>
      </label>
    </div>

    <div class="acct-section">
      <div class="acct-section-title">Notifications</div>
      <div id="acctNotifSettingsContainer"></div>
    </div>

    <div class="acct-section">
      <div class="acct-section-title">App Tour</div>
      <button class="acct-pill-btn" id="acctReplayTourBtn">Replay onboarding tour</button>
    </div>

    <div class="acct-section acct-section-footer">
      <button class="acct-signout-btn" id="acctSignOutBtn">Sign out</button>
    </div>
  `;

  renderNotifSettings(body.querySelector('#acctNotifSettingsContainer'));

  const activeAccent = currentProfile?.accent_color || 'blue';
  const swatches = body.querySelectorAll('.acct-accent-swatch');
  swatches.forEach(btn => {
    btn.classList.toggle('acct-accent-swatch--active', btn.dataset.accent === activeAccent);
    btn.addEventListener('click', () => {
      swatches.forEach(b => b.classList.remove('acct-accent-swatch--active'));
      btn.classList.add('acct-accent-swatch--active');
      updateUserAccentColor(btn.dataset.accent);
    });
  });

  const themeToggle = body.querySelector('#acctThemeToggle');
  if (themeToggle) themeToggle.checked = document.body.classList.contains('dark');
  themeToggle?.addEventListener('change', () => {
    document.body.classList.toggle('dark', themeToggle.checked);
    localStorage.setItem('theme', themeToggle.checked ? 'dark' : 'light');
  });

  body.querySelector('#acctChangeEmailBtn')?.addEventListener('click', () => {
    close();
    openAuthModal();
  });

  body.querySelector('#acctChangePasswordBtn')?.addEventListener('click', () => {
    close();
    openAuthModal();
  });

  body.querySelector('#acctReplayTourBtn')?.addEventListener('click', async () => {
    close();
    resetTour(); // resets all sections
    navigate('dashboard');
    await loadDashboard();
    startTour('dashboard');
  });

  body.querySelector('#acctSignOutBtn')?.addEventListener('click', async () => {
    close();
    await supabase.auth.signOut();
  });
}
