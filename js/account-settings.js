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
      <div class="acct-section-title">Notifications</div>
      <div id="acctNotifSettingsContainer"></div>
    </div>

    <div class="acct-section acct-section-footer">
      <button class="acct-signout-btn" id="acctSignOutBtn">Sign out</button>
    </div>
  `;

  renderNotifSettings(body.querySelector('#acctNotifSettingsContainer'));

  body.querySelector('#acctChangeEmailBtn')?.addEventListener('click', () => {
    close();
    openAuthModal();
  });

  body.querySelector('#acctChangePasswordBtn')?.addEventListener('click', () => {
    close();
    openAuthModal();
  });

  body.querySelector('#acctSignOutBtn')?.addEventListener('click', async () => {
    close();
    await supabase.auth.signOut();
  });
}
