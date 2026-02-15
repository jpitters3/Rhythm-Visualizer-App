/**
 * Admin Tools for Rhythm Visualizer
 * Handles restricted features like Pattern Tagging and Game Config.
 */

import { currentUser } from './state.js';
import { ADMIN_EMAILS } from './config.js';
import { supabase } from './supabase-client.js';
import { dbListPatternNames, dbLoadPatternByName, dbSavePattern } from './pattern-crud.js';

let isAdmin = false;
let patternOrgModal = null;
let gameConfigModal = null;

// Cache for pattern data to avoiding hammering DB during tagging
let patternCache = [];

export async function initAdmin() {
  const user = currentUser;
  if (!user || !user.email) return;

  if (ADMIN_EMAILS.has(user.email)) {
    console.log('[Admin] Authorized user detected:', user.email);
    isAdmin = true;
    injectAdminButton();
    setupModals();
  }
}

function injectAdminButton() {
  const dropdown = document.getElementById('accountDropdownMenu');
  const accountSettingsBtn = document.getElementById('openAccountAuthBtn');

  if (!dropdown || !accountSettingsBtn) return;

  // Check if already exists
  if (document.getElementById('adminBtn')) return;

  const btn = document.createElement('button');
  btn.id = 'adminBtn';
  // Use default dropdown style (no specific class needed if CSS handles 'button' in dropdown)
  // But let's match the "Account Settings" style if any
  btn.innerHTML = '⚙️ Admin Tools';
  btn.style.marginTop = '4px';
  btn.style.color = 'var(--accent-glow)';

  btn.onclick = openAdminMenu;

  // Insert after Account Settings
  dropdown.insertBefore(btn, accountSettingsBtn.nextSibling);

  // Also enable other admin-only buttons in the dropdown if they exist
  // (e.g. Create Course, POTW Dashboard which are hardcoded in HTML but hidden)
  const adminElements = document.querySelectorAll('.admin-only');
  adminElements.forEach(el => el.style.display = 'block');
}

function setupModals() {
  // Pattern Org Modal
  patternOrgModal = document.getElementById('patternOrgModal');
  if (patternOrgModal) {
    patternOrgModal.querySelector('.close-modal-btn').onclick = () => {
      patternOrgModal.style.display = 'none';
    }
  }

  // Game Config Modal (Placeholder for now)
  gameConfigModal = document.getElementById('gameConfigModal');
}

function openAdminMenu() {
  // Simple menu to choose tool
  const choice = prompt("Admin Tools:\n1. Pattern Organization (Tagging)\n2. Game Configuration", "1");

  if (choice === '1') {
    openPatternOrgModal();
  } else if (choice === '2') {
    alert("Game Config coming soon!");
  }
}

async function openPatternOrgModal() {
  if (!patternOrgModal) return;

  patternOrgModal.style.display = 'flex';
  const listContainer = document.getElementById('adminPatternList');
  listContainer.innerHTML = '<div style="padding:20px; text-align:center;">Loading patterns...</div>';

  try {
    // 1. Fetch all pattern names
    const names = await dbListPatternNames();

    // 2. Fetch full data for each (to get tags)
    // Optimization: In a real app we'd want a dedicated 'metadata' table or column,
    // but for now we load the JSON.
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

  // Singleton listener check (simple way: remove then add, or just check a flag if needed)
  // Since initAdmin calls this once, it's fine.
  listContainer.onclick = (e) => {
    const removeBtn = e.target.closest('.remove-tag-btn');
    if (removeBtn) {
      const { pattern, tag } = removeBtn.dataset;
      removeTag(pattern, tag);
      return;
    }

    const addBtn = e.target.closest('.add-tag-btn');
    if (addBtn) {
      const { pattern } = addBtn.dataset;
      promptAddTag(pattern);
      return;
    }
  };
}

function renderPatternList(filterTag = null) {
  const listContainer = document.getElementById('adminPatternList');
  listContainer.innerHTML = '';

  setupDelegation();

  const table = document.createElement('div');
  table.className = 'admin-pattern-table';

  patternCache.forEach(item => {
    const tags = item.data.tags || [];

    // Filter logic
    if (filterTag && !tags.includes(filterTag)) return;

    const row = document.createElement('div');
    row.className = 'admin-pattern-row';

    row.innerHTML = `
      <div class="row-name">${item.name}</div>
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
    alert("Failed to save: " + err.message);
  }
};

async function promptAddTag(patternName) {
  if (!isAdmin) return;
  const tag = prompt("Enter tag (e.g. #simon, #easy):");
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
    alert("Failed to save: " + err.message);
  }
};
