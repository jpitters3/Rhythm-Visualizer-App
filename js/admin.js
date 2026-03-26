/**
 * Admin Tools for Rhythm Visualizer
 * Handles restricted features like Pattern Tagging and Game Config.
 */

import { alert, confirm, prompt } from './alert.js';
import { Modal } from './modal.js';
import { currentUser, isAdminUser } from './state.js';

import { dbListPatternNames, dbLoadPatternByName, dbSavePattern, applyPattern } from './pattern-crud.js';
import { start, stop } from './noteplayer.js';
import { GridContext } from './grid-context.js';
import { initCourseCopier, openCourseCopier } from './course-copier.js';
import { initAssignments, openAssignments, prefetchAssignmentsData } from './assignments.js';
import { Bus, BUS_EVENT } from './bus.js';

let isAdmin = false;
let adminInitialized = false;
let patternOrgModal = null;
let gameConfigModal = null;

// Cache for pattern data to avoiding hammering DB during tagging
let patternCache = [];

// Preview playback - dedicated grid for admin preview only
let previewGrid = null;
let currentPreviewPattern = null;

export function initAdmin() {
  // Also run on every AUTH_LOGIN so buttons appear without a refresh.
  Bus.on(BUS_EVENT.AUTH_LOGIN, () => activateAdminIfAuthorized());

  // Run immediately in case auth was already resolved before this module loaded.
  activateAdminIfAuthorized();
}

function activateAdminIfAuthorized() {
  const user = currentUser;
  if (!user?.email) return;
  if (!isAdminUser(user)) return;

  isAdmin = true;
  injectAdminButton(); // safe to call repeatedly — checks #adminBtn exists

  if (adminInitialized) return; // one-time setup below
  adminInitialized = true;

  console.log('[Admin] Authorized user detected:', user.email);

  previewGrid = new GridContext('preview', 'preview-grid-container');
  console.log('[Admin] Preview grid initialized');

  setupModals();
  initCourseCopier();
  initAssignments();
  setTimeout(() => prefetchAssignmentsData(), 0);
}

function injectAdminButton() {
  const dropdown = document.getElementById('accountDropdownMenu');
  const accountSettingsBtn = document.getElementById('openAccountAuthBtn');

  if (!dropdown || !accountSettingsBtn) return;

  // Check if already exists
  if (document.getElementById('adminBtn')) return;

  const btn = document.createElement('button');
  btn.id = 'adminBtn';
  btn.innerHTML = '⚙️ Admin Tools';
  btn.style.marginTop = '4px';
  btn.style.color = 'var(--accent-glow)';

  btn.onclick = openAdminMenu;

  // Insert after Account Settings
  dropdown.insertBefore(btn, accountSettingsBtn.nextSibling);

  // Assignments button
  if (!document.getElementById('assignmentsBtn')) {
    const assignBtn = document.createElement('button');
    assignBtn.id = 'assignmentsBtn';
    assignBtn.innerHTML = '📋 Assignments';
    assignBtn.style.marginTop = '4px';
    assignBtn.onclick = openAssignments;
    dropdown.insertBefore(assignBtn, btn.nextSibling);
  }

  // Also enable other admin-only buttons in the dropdown if they exist
  const adminElements = document.querySelectorAll('.admin-only');
  adminElements.forEach(el => el.style.display = 'block');
}

function setupModals() {
  // Pattern Org Modal
  patternOrgModal = document.getElementById('patternOrgModal');
  if (patternOrgModal) {
    const patternOrgPanel = new Modal(patternOrgModal, { onClose: stopPatternPreview });
    patternOrgModal.querySelector('.close-modal-btn').onclick = () => patternOrgPanel.close();
    patternOrgModal._panel = patternOrgPanel;
  }

  // Search input listener
  const searchInput = document.getElementById('adminPatternSearch');
  if (searchInput) {
    searchInput.oninput = (e) => {
      renderPatternList(e.target.value.toLowerCase());
    };
  }

  // Game Config Modal (Placeholder for now)
  gameConfigModal = document.getElementById('gameConfigModal');
}

async function openAdminMenu() {
  // Simple menu to choose tool
  const choice = await prompt("Admin Tools:\n1. Pattern Organization (Tagging)\n2. Game Configuration\n3. Copy Sections Between Courses", "1");

  if (choice === '1') {
    openPatternOrgModal();
  } else if (choice === '2') {
    await alert("Game Config coming soon!");
  } else if (choice === '3') {
    openCourseCopier();
  }
}

async function openPatternOrgModal() {
  if (!patternOrgModal) return;

  patternOrgModal._panel.open();
  const listContainer = document.getElementById('adminPatternList');
  listContainer.innerHTML = '<div style="padding:20px; text-align:center;">Loading patterns...</div>';

  try {
    // 1. Fetch all pattern names
    const names = await dbListPatternNames();

    // 2. Fetch full data for each (to get tags)
    patternCache = [];

    // Fetch in parallel batches of 5 to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < names.length; i += batchSize) {
      const batch = names.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (name) => {
        const data = await dbLoadPatternByName(name);
        return { name, data };
      }));
      patternCache.push(...results);
    }

    renderPatternList();

  } catch (err) {
    console.error("Admin Load Error:", err);
    listContainer.innerHTML = `<div style="color:var(--error);">Error: ${err.message}</div>`;
  }
}

function setupDelegation() {
  const listContainer = document.getElementById('adminPatternList');
  if (!listContainer) return;

  listContainer.onclick = async (e) => {
    const removeBtn = e.target.closest('.remove-tag-btn');
    if (removeBtn) {
      const { pattern, tag } = removeBtn.dataset;
      removeTag(pattern, tag);
      return;
    }

    const addBtn = e.target.closest('.add-tag-btn');
    if (addBtn) {
      const { pattern } = addBtn.dataset;
      await promptAddTag(pattern);
      return;
    }

    // Play/Stop button
    const playBtn = e.target.closest('.pattern-play-btn');
    if (playBtn) {
      const { pattern } = playBtn.dataset;
      togglePatternPreview(pattern);
      return;
    }

    // Clicking pattern name
    const patternName = e.target.closest('.row-name');
    if (patternName) {
      const { pattern } = patternName.dataset;
      togglePatternPreview(pattern);
      return;
    }
  };
}

function renderPatternList(searchQuery = '') {
  const listContainer = document.getElementById('adminPatternList');
  listContainer.innerHTML = '';

  setupDelegation();

  const table = document.createElement('div');
  table.className = 'admin-pattern-table';

  patternCache.forEach(item => {
    const tags = item.data.tags || [];

    // Filter logic: search by name or tags
    if (searchQuery) {
      const matchesName = item.name.toLowerCase().includes(searchQuery);
      const matchesTags = tags.some(tag => tag.toLowerCase().includes(searchQuery));
      if (!matchesName && !matchesTags) return;
    }

    const row = document.createElement('div');
    row.className = 'admin-pattern-row';

    const isPlaying = previewGrid && previewGrid.playing && currentPreviewPattern === item.name;
    const playIcon = isPlaying ? '⏹' : '▶';

    row.innerHTML = `
      <button class="pattern-play-btn" data-pattern="${item.name}" style="background: transparent; border: none; cursor: pointer; font-size: 16px; padding: 4px 8px; color: var(--primary);" title="${isPlaying ? 'Stop' : 'Play'} preview">${playIcon}</button>
      <div class="row-name" data-pattern="${item.name}" style="cursor: pointer;">${item.name}</div>
      <div class="row-tags" id="tags-${item.name.replace(/\s+/g, '-')}">
        ${tags.map(t => `
            <span class="tag-pill">
                ${t} 
                <span class="remove-tag-btn" data-pattern="${item.name}" data-tag="${t}" style="cursor:pointer; margin-left:4px;">&times;</span>
            </span>`).join('')}
        <button class="add-tag-btn" data-pattern="${item.name}">+ Tag</button>
      </div>
      <div class="row-actions">
        <!-- <button class="small-btn">Edit</button> -->
      </div>
    `;

    table.appendChild(row);
  });

  listContainer.appendChild(table);
}

// Pattern Preview Playback
function togglePatternPreview(patternName) {
  // If currently playing this pattern, stop it
  if (previewGrid && previewGrid.playing && currentPreviewPattern === patternName) {
    stopPatternPreview();
    return;
  }

  // If playing a different pattern, stop it first
  if (previewGrid && previewGrid.playing) {
    stopPatternPreview();
  }

  // Start playing the new pattern
  startPatternPreview(patternName);
}

async function startPatternPreview(patternName) {
  const item = patternCache.find(p => p.name === patternName);

  if (!item || !item.data) {
    console.error('[Admin Preview] Pattern not found in cache:', patternName);
    return;
  }

  if (!previewGrid) {
    console.error('[Admin Preview] Preview grid not initialized');
    return;
  }

  currentPreviewPattern = patternName;

  try {
    // Use dedicated preview grid
    await applyPattern(item.data, previewGrid);

    // Start playback (skipCountdown = true for immediate playback)
    await start(previewGrid, false, true);

    // Update UI
    renderPatternList();
  } catch (err) {
    console.error('[Admin Preview] Error during preview:', err);
  }
}

function stopPatternPreview() {
  if (previewGrid) {
    stop(previewGrid, false);
  }
  currentPreviewPattern = null;

  // Update UI
  renderPatternList();
}

async function removeTag(patternName, tagToRemove) {
  if (!isAdmin) return;

  const item = patternCache.find(p => p.name === patternName);
  if (!item) return;

  if (!item.data.tags) item.data.tags = [];
  item.data.tags = item.data.tags.filter(t => t !== tagToRemove);

  // Optimistic Update
  renderPatternList();

  // Save
  try {
    await dbSavePattern(patternName, item.data);
    console.log(`[Admin] Removed tag ${tagToRemove} from ${patternName}`);
  } catch (err) {
    await alert("Failed to save: " + err.message);
  }
};

async function promptAddTag(patternName) {
  if (!isAdmin) return;
  const tag = await prompt("Enter tag (e.g. #simon, #easy):");
  if (!tag) return;

  const cleanTag = tag.trim().startsWith('#') ? tag.trim() : '#' + tag.trim();

  const item = patternCache.find(p => p.name === patternName);
  if (!item) return;

  if (!item.data.tags) item.data.tags = [];
  if (item.data.tags.includes(cleanTag)) return;

  item.data.tags.push(cleanTag);

  // Optimistic Update
  renderPatternList();

  // Save
  try {
    await dbSavePattern(patternName, item.data);
    console.log(`[Admin] Added tag ${cleanTag} to ${patternName}`);
  } catch (err) {
    await alert("Failed to save: " + err.message);
  }
};
