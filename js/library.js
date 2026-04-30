import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';
import { openAuthModal } from './auth.js';
import { openComposerToComposition } from './song-composer.js';
import { loadPatternByName, createNewPhrase } from './controls.js';
import { dbDeletePattern, dbRenamePattern, dbSavePattern, dbListPatternNames } from './pattern-crud.js';
import { alert, confirm, prompt } from './alert.js';
import { startRawAudioRecording, stopRawAudioRecording } from './audio-recorder.js';
import { Bus, BUS_EVENT } from './bus.js';
import { renderThumbnail } from './pattern-thumbnail.js';

let currentTab = 'phrases';
let sortAscending = false;
let currentFolderId = null;
let currentFolderName = null;
let searchQuery = '';
let searchDebounce = null;

// Shared floating context menu
let contextMenuEl = null;
// Shared folder picker modal
let folderPickerEl = null;

// Clips recording state
let clipIsRecording = false;
let clipRecordTimer = null;
let clipRecordStart = 0;
let clipAudio = null;
let clipPlayingId = null;

// ===== INIT =====

export function initLibrary() {
  window.addEventListener('routeChanged', (e) => {
    if (e.detail.route === 'library') renderLibrary();
  });

  document.querySelectorAll('.library-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      currentFolderId = null;
      currentFolderName = null;
      searchQuery = '';
      const searchEl = document.getElementById('librarySearch');
      if (searchEl) searchEl.value = '';
      document.querySelectorAll('.library-tab').forEach(b =>
        b.classList.toggle('active', b === btn)
      );
      renderLibrary();
    });
  });

  document.getElementById('librarySearch')?.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchQuery = e.target.value.trim();
      renderLibrary();
    }, 250);
  });

  document.getElementById('librarySortOrder')?.addEventListener('click', (e) => {
    sortAscending = !sortAscending;
    e.currentTarget.textContent = sortAscending ? 'Oldest first' : 'Newest first';
    renderLibrary();
  });

  document.getElementById('libraryNewFolder')?.addEventListener('click', promptNewFolder);

  Bus.on(BUS_EVENT.AUTH_LOGIN, () => {
    if (document.getElementById('view-library')?.classList.contains('active')) {
      renderLibrary();
    }
  });

  // Dismiss context menu on outside click
  document.addEventListener('click', (e) => {
    if (
      contextMenuEl &&
      !e.target.closest('#libContextMenu') &&
      !e.target.closest('.lib-menu-btn')
    ) {
      hideContextMenu();
    }
  });
}

// ===== CONTEXT MENU =====

function getOrCreateContextMenu() {
  if (!contextMenuEl) {
    contextMenuEl = document.createElement('div');
    contextMenuEl.id = 'libContextMenu';
    contextMenuEl.className = 'lib-context-menu';
    document.body.appendChild(contextMenuEl);
  }
  return contextMenuEl;
}

function hideContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.style.display = 'none';
    contextMenuEl.innerHTML = '';
  }
}

function showContextMenu(anchorEl, items) {
  const menu = getOrCreateContextMenu();
  menu.innerHTML = '';
  items.forEach(({ label, action, danger }) => {
    const btn = document.createElement('button');
    btn.className = 'lib-context-item' + (danger ? ' danger' : '');
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      action();
    });
    menu.appendChild(btn);
  });

  menu.style.display = 'block';
  menu.style.visibility = 'hidden';
  const rect = anchorEl.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  menu.style.visibility = '';

  let top = rect.bottom + 6;
  let left = rect.right - menuRect.width;
  if (left < 8) left = 8;
  if (top + menuRect.height > window.innerHeight - 8) top = rect.top - menuRect.height - 6;

  menu.style.position = 'fixed';
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

// ===== FOLDER PICKER MODAL =====

function getOrCreateFolderPicker() {
  if (!folderPickerEl) {
    folderPickerEl = document.createElement('div');
    folderPickerEl.className = 'lib-picker-backdrop';
    folderPickerEl.innerHTML = `
      <div class="lib-picker">
        <div class="lib-picker-header">
          <span>Move to folder</span>
          <button class="lib-picker-close">✕</button>
        </div>
        <div class="lib-picker-list"></div>
      </div>`;
    document.body.appendChild(folderPickerEl);
    folderPickerEl.addEventListener('click', (e) => {
      if (e.target === folderPickerEl) hideFolderPicker();
    });
    folderPickerEl.querySelector('.lib-picker-close').addEventListener('click', hideFolderPicker);
  }
  return folderPickerEl;
}

function hideFolderPicker() {
  if (folderPickerEl) folderPickerEl.style.display = 'none';
}

async function showFolderPicker(tab, onSelect) {
  const picker = getOrCreateFolderPicker();
  const list = picker.querySelector('.lib-picker-list');
  list.innerHTML = '<p class="lib-picker-empty">Loading…</p>';
  picker.style.display = 'flex';

  const { data: folders } = await supabase
    .from('library_folders')
    .select('id, name')
    .eq('tab', tab)
    .is('parent_id', null)
    .order('name');

  list.innerHTML = '';

  const makeItem = (icon, label, action) => {
    const btn = document.createElement('button');
    btn.className = 'lib-picker-item';
    btn.innerHTML = `<span class="lib-picker-item-icon">${icon}</span>${escapeHtml(label)}`;
    btn.addEventListener('click', () => { hideFolderPicker(); action(); });
    list.appendChild(btn);
  };

  makeItem('📂', 'No folder (root)', () => onSelect(null));
  (folders || []).forEach(f => makeItem('📁', f.name, () => onSelect(f.id)));

  if (!folders?.length) {
    const p = document.createElement('p');
    p.className = 'lib-picker-empty';
    p.textContent = 'No folders yet — create one with "+ New Folder".';
    list.appendChild(p);
  }
}

// ===== RENDER =====

async function renderLibrary() {
  const grid = document.getElementById('libraryGrid');
  const foldersSection = document.getElementById('libraryFolders');
  const breadcrumb = document.getElementById('libraryBreadcrumb');
  if (!grid) return;

  const newFolderBtn = document.getElementById('libraryNewFolder');

  if (!currentUser) {
    if (foldersSection) foldersSection.innerHTML = '';
    if (breadcrumb) { breadcrumb.innerHTML = ''; breadcrumb.hidden = true; }
    if (newFolderBtn) newFolderBtn.style.display = 'none';
    grid.innerHTML = `
      <div class="library-empty">
        <p>Sign in to view your phrases and compositions.</p>
        <button id="librarySignInBtn" class="primary-btn">Sign In</button>
      </div>`;
    document.getElementById('librarySignInBtn')?.addEventListener('click', openAuthModal);
    return;
  }

  const hideFolderBtn = currentTab === 'archive' || currentTab === 'shared' || currentTab === 'clips';
  if (newFolderBtn) newFolderBtn.style.display = hideFolderBtn ? 'none' : '';

  const searchRow = document.querySelector('.library-search-row');
  if (searchRow) searchRow.style.visibility = (currentTab === 'archive' || currentTab === 'clips') ? 'hidden' : '';

  // Breadcrumb
  if (breadcrumb) {
    if (currentFolderId && currentFolderName) {
      breadcrumb.hidden = false;
      breadcrumb.innerHTML = `
        <button class="lib-crumb-root">Library</button>
        <span class="lib-crumb-sep">›</span>
        <span class="lib-crumb-current">${escapeHtml(currentFolderName)}</span>`;
      breadcrumb.querySelector('.lib-crumb-root').addEventListener('click', () => {
        currentFolderId = null;
        currentFolderName = null;
        renderLibrary();
      });
    } else {
      breadcrumb.hidden = true;
      breadcrumb.innerHTML = '';
    }
  }

  grid.classList.remove('clips-view');
  if (foldersSection) foldersSection.innerHTML = '';
  grid.innerHTML = '<div class="library-empty">Loading…</div>';

  if (currentTab === 'shared') {
    await loadSharedWithMe(grid);
  } else if (currentTab === 'archive') {
    await loadArchive(grid);
  } else if (currentTab === 'clips') {
    if (foldersSection) foldersSection.innerHTML = '';
    if (breadcrumb) { breadcrumb.innerHTML = ''; breadcrumb.hidden = true; }
    await loadClips(grid);
  } else {
    await loadAndRender(currentTab, grid, foldersSection);
  }
}

// ===== PHRASES / COMPOSITIONS =====

async function loadAndRender(tab, grid, foldersSection) {
  const isCompositions = tab === 'compositions';

  const showFolders = !currentFolderId && !searchQuery;
  const [folders, countsByFolder, itemsResult] = await Promise.all([
    showFolders ? loadFoldersList(tab) : Promise.resolve([]),
    showFolders ? getItemCountsPerFolder(tab) : Promise.resolve({}),
    fetchItems(tab),
  ]);

  const { data, error } = itemsResult;

  // Render folder cards
  if (foldersSection && folders.length > 0) {
    const row = document.createElement('div');
    row.className = 'lib-folders-row';
    folders.forEach(f => row.appendChild(buildFolderCard(f, countsByFolder[f.id] || 0, tab)));
    foldersSection.appendChild(row);
  }

  // Render item cards
  grid.innerHTML = '';
  if (error || !data?.length) {
    if (!folders.length || currentFolderId) {
      if (tab === 'phrases' && !currentFolderId) {
        grid.innerHTML = `
          <div class="library-empty">
            <p>No phrases saved yet.</p>
            <button id="libraryCreatePhraseBtn" class="primary-btn">+ Create New Phrase</button>
          </div>`;
        document.getElementById('libraryCreatePhraseBtn')?.addEventListener('click', async () => {
          const created = await createNewPhrase();
          if (created) window.location.hash = '#freeplay';
        });
      } else {
        grid.innerHTML = `<div class="library-empty">No ${tab} ${currentFolderId ? 'in this folder' : 'saved yet'}.</div>`;
      }
    }
    return;
  }

  if (isCompositions) {
    data.forEach(row => {
      const sections = (row.composition_sections || []).sort((a, b) => a.position - b.position);
      const firstPhrase = sections.find(s => s.type === 'phrase' && s.pattern_snapshot);
      grid.appendChild(buildCard({
        title: row.title || 'Untitled',
        date: row.created_at,
        patternData: firstPhrase?.pattern_snapshot ?? null,
        onClick: () => {
          window.location.hash = '#freeplay';
          setTimeout(() => openComposerToComposition(row.id), 120);
        },
        dragPayload: { tab, compositionId: row.id },
        menuItems: buildCompositionMenuItems(row),
      }));
    });
  } else {
    data.forEach(row => {
      grid.appendChild(buildCard({
        title: row.name,
        date: row.updated_at,
        patternData: row.data,
        onClick: () => {
          window.location.hash = '#freeplay';
          setTimeout(() => loadPatternByName(row.name), 120);
        },
        dragPayload: { tab, patternName: row.name },
        menuItems: buildPhraseMenuItems(row),
      }));
    });
  }
}

async function fetchItems(tab) {
  const isCompositions = tab === 'compositions';
  let q;
  if (isCompositions) {
    q = supabase
      .from('compositions')
      .select('id, title, created_at, folder_id, composition_sections(position, type, pattern_snapshot)')
      .eq('is_snapshot', false)
      .not('archived', 'is', true)
      .order('created_at', { ascending: sortAscending });
    if (searchQuery) q = q.ilike('title', `%${searchQuery}%`);
  } else {
    q = supabase
      .from('patterns')
      .select('name, data, updated_at, folder_id')
      .eq('user_id', currentUser.id)
      .not('archived', 'is', true)
      .order('updated_at', { ascending: sortAscending });
    if (searchQuery) q = q.ilike('name', `%${searchQuery}%`);
  }
  if (searchQuery) {
    // Skip folder filter when searching so results aren't constrained to current folder
  } else if (currentFolderId) {
    q = q.eq('folder_id', currentFolderId);
  } else {
    q = q.is('folder_id', null);
  }
  return q;
}

// ===== SHARED WITH ME =====

async function loadSharedWithMe(grid) {
  let q = supabase
    .from('patterns')
    .select('name, data, updated_at')
    .eq('user_id', currentUser.id)
    .eq('source', 'shared')
    .not('archived', 'is', true)
    .order('updated_at', { ascending: sortAscending });
  if (searchQuery) q = q.ilike('name', `%${searchQuery}%`);
  const { data, error } = await q;

  if (error || !data?.length) {
    grid.innerHTML = '<div class="library-empty"><p>No shared phrases saved yet.</p><span style="opacity:0.5;font-size:13px">When someone shares a pattern with you, use "Save a copy" to store it here.</span></div>';
    return;
  }

  grid.innerHTML = '';
  data.forEach(row => {
    grid.appendChild(buildCard({
      title: row.name,
      date: row.updated_at,
      patternData: row.data,
      onClick: () => {
        window.location.hash = '#freeplay';
        setTimeout(() => loadPatternByName(row.name), 120);
      },
      dragPayload: null,
      menuItems: buildPhraseMenuItems(row),
    }));
  });
}

// ===== ARCHIVE TAB =====

async function loadArchive(grid) {
  const [phrasesResult, compositionsResult] = await Promise.all([
    supabase
      .from('patterns')
      .select('name, data, updated_at')
      .eq('user_id', currentUser.id)
      .eq('archived', true)
      .order('updated_at', { ascending: sortAscending }),
    supabase
      .from('compositions')
      .select('id, title, created_at, composition_sections(position, type, pattern_snapshot)')
      .eq('is_snapshot', false)
      .eq('archived', true)
      .order('created_at', { ascending: sortAscending }),
  ]);

  const phrases = phrasesResult.data || [];
  const compositions = compositionsResult.data || [];

  if (!phrases.length && !compositions.length) {
    grid.innerHTML = '<div class="library-empty"><p>Archive is empty.</p></div>';
    return;
  }

  grid.innerHTML = '';

  phrases.forEach(row => {
    grid.appendChild(buildCard({
      title: row.name,
      date: row.updated_at,
      patternData: row.data,
      onClick: () => {
        window.location.hash = '#freeplay';
        setTimeout(() => loadPatternByName(row.name), 120);
      },
      dragPayload: null,
      menuItems: [
        { label: 'Restore', action: () => unarchiveItem('patterns', row.name, null) },
        { label: 'Delete', danger: true, action: () => deletePhrase(row.name) },
      ],
    }));
  });

  compositions.forEach(row => {
    const sections = (row.composition_sections || []).sort((a, b) => a.position - b.position);
    const firstPhrase = sections.find(s => s.type === 'phrase' && s.pattern_snapshot);
    grid.appendChild(buildCard({
      title: row.title || 'Untitled',
      date: row.created_at,
      patternData: firstPhrase?.pattern_snapshot ?? null,
      onClick: () => {
        window.location.hash = '#freeplay';
        setTimeout(() => openComposerToComposition(row.id), 120);
      },
      dragPayload: null,
      menuItems: [
        { label: 'Restore', action: () => unarchiveItem('compositions', null, row.id) },
        { label: 'Delete', danger: true, action: () => deleteComposition(row.id, row.title) },
      ],
    }));
  });
}

// ===== MENU ITEM BUILDERS =====

function buildPhraseMenuItems(row) {
  return [
    {
      label: 'Share',
      action: () => sharePhrase(row.name, row.data),
    },
    {
      label: 'Rename',
      action: () => renamePhrase(row.name),
    },
    {
      label: 'Move…',
      action: () => showFolderPicker('phrases', async (folderId) => {
        await supabase.from('patterns').update({ folder_id: folderId }).eq('name', row.name).eq('user_id', currentUser.id);
        renderLibrary();
      }),
    },
    {
      label: 'Duplicate',
      action: () => duplicatePhrase(row.name, row.data),
    },
    {
      label: 'Archive',
      action: () => archiveItem('patterns', row.name, null),
    },
    {
      label: 'Delete',
      danger: true,
      action: () => deletePhrase(row.name),
    },
  ];
}

function buildCompositionMenuItems(row) {
  return [
    {
      label: 'Rename',
      action: () => renameComposition(row.id, row.title),
    },
    {
      label: 'Move…',
      action: () => showFolderPicker('compositions', async (folderId) => {
        await supabase.from('compositions').update({ folder_id: folderId }).eq('id', row.id);
        renderLibrary();
      }),
    },
    {
      label: 'Archive',
      action: () => archiveItem('compositions', null, row.id),
    },
    {
      label: 'Delete',
      danger: true,
      action: () => deleteComposition(row.id, row.title),
    },
  ];
}

// ===== ITEM ACTIONS =====

async function sharePhrase(name, patternData) {
  const { data: existing } = await supabase
    .from('shared_patterns')
    .select('share_id')
    .eq('user_id', currentUser.id)
    .eq('name', name)
    .maybeSingle();

  const shareId = existing?.share_id || crypto.randomUUID().replace(/-/g, '').slice(0, 16);

  const { error } = await supabase
    .from('shared_patterns')
    .upsert({
      user_id: currentUser.id,
      name,
      pattern_json: JSON.stringify(patternData),
      share_id: shareId,
      is_public: true,
    }, { onConflict: 'user_id,name' });

  if (error) { await alert('Could not create share link.'); return; }

  const url = `${location.origin}${location.pathname}?share=${encodeURIComponent(shareId)}`;
  try {
    await navigator.clipboard.writeText(url);
    await alert('Share link copied to clipboard!');
  } catch {
    await alert(`Share link:\n${url}`);
  }
}

async function renamePhrase(oldName) {
  const newName = window.prompt('Rename phrase:', oldName);
  if (!newName?.trim() || newName.trim() === oldName) return;
  try {
    await dbRenamePattern(oldName, newName.trim());
    renderLibrary();
  } catch (err) {
    await alert(`Could not rename: ${err.message}`);
  }
}

async function duplicatePhrase(name, data) {
  const newName = window.prompt('Duplicate as:', `${name} (copy)`);
  if (!newName?.trim()) return;
  const trimmed = newName.trim();
  try {
    const existing = await dbListPatternNames();
    if (existing.includes(trimmed)) {
      await alert(`A phrase named "${trimmed}" already exists.`);
      return;
    }
    await dbSavePattern(trimmed, data, 'manual');
    renderLibrary();
  } catch (err) {
    await alert(`Could not duplicate: ${err.message}`);
  }
}

async function deletePhrase(name) {
  if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
  try {
    await dbDeletePattern(name);
    renderLibrary();
  } catch (err) {
    await alert(`Could not delete: ${err.message}`);
  }
}

async function renameComposition(id, currentTitle) {
  const newTitle = window.prompt('Rename composition:', currentTitle);
  if (!newTitle?.trim() || newTitle.trim() === currentTitle) return;
  const { error } = await supabase
    .from('compositions')
    .update({ title: newTitle.trim(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { await alert(`Could not rename: ${error.message}`); return; }
  renderLibrary();
}

async function deleteComposition(id, title) {
  if (!window.confirm(`Delete "${title || 'Untitled'}"? This cannot be undone.`)) return;
  const { error } = await supabase.from('compositions').delete().eq('id', id);
  if (error) { await alert(`Could not delete: ${error.message}`); return; }
  renderLibrary();
}

async function archiveItem(table, patternName, compositionId) {
  const filter = table === 'patterns'
    ? { col: 'name', val: patternName }
    : { col: 'id', val: compositionId };
  const { error } = await supabase
    .from(table)
    .update({ archived: true })
    .eq(filter.col, filter.val);
  if (error) { await alert(`Could not archive: ${error.message}`); return; }
  renderLibrary();
}

async function unarchiveItem(table, patternName, compositionId) {
  const filter = table === 'patterns'
    ? { col: 'name', val: patternName }
    : { col: 'id', val: compositionId };
  const { error } = await supabase
    .from(table)
    .update({ archived: false })
    .eq(filter.col, filter.val);
  if (error) { await alert(`Could not restore: ${error.message}`); return; }
  renderLibrary();
}

// ===== FOLDER OPERATIONS =====

async function loadFoldersList(tab) {
  const { data } = await supabase
    .from('library_folders')
    .select('id, name')
    .eq('tab', tab)
    .is('parent_id', null)
    .order('name');
  return data || [];
}

async function getItemCountsPerFolder(tab) {
  const table = tab === 'phrases' ? 'patterns' : 'compositions';
  let q = supabase.from(table).select('folder_id').not('folder_id', 'is', null);
  if (tab === 'compositions') q = q.eq('is_snapshot', false);
  const { data } = await q;
  const counts = {};
  (data || []).forEach(r => { counts[r.folder_id] = (counts[r.folder_id] || 0) + 1; });
  return counts;
}

function buildFolderCard(folder, itemCount, tab) {
  const card = document.createElement('div');
  card.className = 'lib-folder-card';

  card.innerHTML = `
    <div class="lib-folder-icon-wrap">
      <svg class="lib-folder-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 8a2 2 0 012-2h4.17a2 2 0 011.42.59l1.41 1.41H20a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8z" fill="currentColor"/>
      </svg>
    </div>
    <div class="lib-folder-info">
      <div class="lib-folder-name">${escapeHtml(folder.name)}</div>
      <div class="lib-folder-count">${itemCount} item${itemCount !== 1 ? 's' : ''}</div>
    </div>
    <button class="lib-menu-btn" title="More options">⋯</button>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.closest('.lib-menu-btn')) return;
    currentFolderId = folder.id;
    currentFolderName = folder.name;
    renderLibrary();
  });

  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('dragenter', (e) => { e.preventDefault(); });
  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');
    try {
      const payload = JSON.parse(e.dataTransfer.getData('application/json'));
      await moveItemToFolder(payload, folder.id);
    } catch { }
  });

  card.querySelector('.lib-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    showContextMenu(e.currentTarget, [
      { label: 'Rename', action: () => promptRenameFolder(folder.id, folder.name) },
      { label: 'Delete folder', danger: true, action: () => promptDeleteFolder(folder.id, folder.name) },
    ]);
  });

  return card;
}

async function moveItemToFolder(payload, folderId) {
  if (!payload) return;
  const { tab, patternName, compositionId } = payload;
  if (tab === 'phrases' && patternName) {
    await supabase.from('patterns').update({ folder_id: folderId }).eq('name', patternName).eq('user_id', currentUser.id);
  } else if (tab === 'compositions' && compositionId) {
    await supabase.from('compositions').update({ folder_id: folderId }).eq('id', compositionId);
  }
  renderLibrary();
}

function promptNewFolder() {
  const name = window.prompt('New folder name:');
  if (!name?.trim()) return;
  supabase.from('library_folders').insert({
    user_id: currentUser.id,
    name: name.trim(),
    tab: currentTab,
    parent_id: currentFolderId,
  }).then(() => renderLibrary());
}

function promptRenameFolder(id, currentName) {
  const name = window.prompt('Rename folder:', currentName);
  if (!name?.trim() || name.trim() === currentName) return;
  supabase.from('library_folders').update({ name: name.trim() }).eq('id', id)
    .then(() => renderLibrary());
}

function promptDeleteFolder(id, name) {
  if (!window.confirm(`Delete folder "${name}"?\n\nItems inside will be moved to the root.`)) return;
  supabase.from('library_folders').delete().eq('id', id).then(() => {
    if (currentFolderId === id) { currentFolderId = null; currentFolderName = null; }
    renderLibrary();
  });
}

// ===== ITEM CARD =====

function buildCard({ title, date, patternData, onClick, dragPayload, menuItems = [] }) {
  const card = document.createElement('div');
  card.className = 'library-card';

  if (dragPayload) {
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify(dragPayload));
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  }

  if (onClick) {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.lib-menu-btn')) return;
      onClick();
    });
    card.style.cursor = 'pointer';
  }

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'library-thumb-wrap';

  const canvas = document.createElement('canvas');
  canvas.className = 'library-thumbnail';
  canvas.width = 320;
  canvas.height = 180;
  thumbWrap.appendChild(canvas);

  if (menuItems.length) {
    const menuBtn = document.createElement('button');
    menuBtn.className = 'lib-menu-btn';
    menuBtn.title = 'More options';
    menuBtn.textContent = '⋯';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showContextMenu(e.currentTarget, menuItems);
    });
    thumbWrap.appendChild(menuBtn);
  }

  const dateStr = date
    ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const body = document.createElement('div');
  body.className = 'library-card-body';
  body.innerHTML = `
    <div class="library-card-title">${escapeHtml(title)}</div>
    <div class="library-card-meta">${dateStr}</div>
  `;

  card.appendChild(thumbWrap);
  card.appendChild(body);

  requestAnimationFrame(() => renderThumbnail(canvas, patternData));

  return card;
}

// ===== THUMBNAIL =====

// ===== CLIPS =====

async function loadClips(grid) {
  const { data: clips, error } = await supabase
    .from('clips')
    .select('id, title, audio_url, duration_secs, created_at')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    grid.innerHTML = `<div class="library-empty">Could not load clips: ${error.message}</div>`;
    return;
  }

  renderClips(grid, clips || []);
}

function renderClips(grid, clips) {
  grid.innerHTML = '';
  grid.classList.add('clips-view');

  const toolbar = document.createElement('div');
  toolbar.className = 'clips-toolbar';
  toolbar.innerHTML = `
    <button class="clips-record-btn" id="clipsRecordBtn">&#9679; Record</button>
    <span class="clips-record-timer" id="clipsRecordTimer"></span>
  `;
  grid.appendChild(toolbar);

  toolbar.querySelector('#clipsRecordBtn').addEventListener('click', () => {
    if (clipIsRecording) {
      stopClipRecording();
    } else {
      startClipRecording();
    }
  });

  if (clips.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'library-empty clips-empty';
    empty.innerHTML = '<p>No clips yet.</p><span>Hit Record to capture your playing.</span>';
    grid.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'clips-list';
  clips.forEach(clip => list.appendChild(buildClipRow(clip)));
  grid.appendChild(list);
}

function buildClipRow(clip) {
  const row = document.createElement('div');
  row.className = 'clip-row';
  row.dataset.id = clip.id;

  const dateStr = new Date(clip.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
  const durStr = clip.duration_secs ? formatDuration(clip.duration_secs) : '—';

  row.innerHTML = `
    <button class="clip-play-btn" title="Play" aria-label="Play ${escapeHtml(clip.title)}">&#9654;</button>
    <div class="clip-info">
      <div class="clip-title">${escapeHtml(clip.title)}</div>
      <div class="clip-meta">${durStr} &nbsp;·&nbsp; ${dateStr}</div>
    </div>
    <button class="lib-menu-btn clip-menu-btn" title="More options">&#8943;</button>
  `;

  row.querySelector('.clip-play-btn').addEventListener('click', () => playClip(clip, row));

  row.querySelector('.clip-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    showContextMenu(e.currentTarget, [
      { label: 'Rename', action: () => renameClip(clip.id, clip.title) },
      { label: 'Share (7-day link)', action: () => shareClip(clip) },
      { label: 'Delete', danger: true, action: () => deleteClip(clip) },
    ]);
  });

  return row;
}

async function startClipRecording() {
  const btn = document.getElementById('clipsRecordBtn');
  const timerEl = document.getElementById('clipsRecordTimer');
  if (!btn) return;

  clipRecordStart = Date.now();
  clipIsRecording = true;
  btn.textContent = '⏹ Stop';
  btn.classList.add('recording');

  clipRecordTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - clipRecordStart) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    if (timerEl) {
      timerEl.textContent = secs >= 600 ? `⚠ ${mm}:${ss}` : `${mm}:${ss}`;
      timerEl.classList.toggle('warn', secs >= 600);
    }
  }, 1000);

  const success = await startRawAudioRecording(async (blob) => {
    await saveClip(blob);
  });

  if (!success) {
    clearInterval(clipRecordTimer);
    clipIsRecording = false;
    if (btn) { btn.innerHTML = '&#9679; Record'; btn.classList.remove('recording'); }
    if (timerEl) { timerEl.textContent = ''; timerEl.classList.remove('warn'); }
  }
}

function stopClipRecording() {
  clearInterval(clipRecordTimer);
  clipRecordTimer = null;
  clipIsRecording = false;
  stopRawAudioRecording();

  const btn = document.getElementById('clipsRecordBtn');
  const timerEl = document.getElementById('clipsRecordTimer');
  if (btn) { btn.innerHTML = '&#9679; Record'; btn.classList.remove('recording'); }
  if (timerEl) { timerEl.textContent = ''; timerEl.classList.remove('warn'); }
}

async function saveClip(blob) {
  const durationSecs = Math.round((Date.now() - clipRecordStart) / 1000);
  const clipId = crypto.randomUUID();
  const path = `${currentUser.id}/${clipId}.webm`;

  const now = new Date();
  const defaultTitle = `Recording – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

  const { error: uploadError } = await supabase.storage
    .from('user-clips')
    .upload(path, blob, { contentType: 'audio/webm' });

  if (uploadError) {
    await alert(uploadErrMsg(uploadError, blob.size));
    return;
  }

  const { error: dbError } = await supabase
    .from('clips')
    .insert({ id: clipId, user_id: currentUser.id, title: defaultTitle, audio_url: path, duration_secs: durationSecs });

  if (dbError) { await alert(`Could not save clip: ${dbError.message}`); return; }

  renderLibrary();
}

async function playClip(clip, row) {
  const playBtn = row.querySelector('.clip-play-btn');

  // Stop currently playing clip if it's a different one
  if (clipAudio && !clipAudio.paused) {
    clipAudio.pause();
    document.querySelectorAll('.clip-play-btn.playing').forEach(b => {
      b.innerHTML = '&#9654;';
      b.classList.remove('playing');
    });
    if (clipPlayingId === clip.id) { clipPlayingId = null; return; }
  }

  clipPlayingId = clip.id;
  playBtn.innerHTML = '&#9203;'; // hourglass while fetching URL

  const { data, error } = await supabase.storage
    .from('user-clips')
    .createSignedUrl(clip.audio_url, 3600);

  if (error || !data?.signedUrl) {
    playBtn.innerHTML = '&#9654;';
    await alert('Could not load audio.');
    return;
  }

  if (!clipAudio) clipAudio = new Audio();
  clipAudio.src = data.signedUrl;
  clipAudio.onended = () => {
    playBtn.innerHTML = '&#9654;';
    playBtn.classList.remove('playing');
    clipPlayingId = null;
  };
  clipAudio.play();
  playBtn.innerHTML = '&#9646;&#9646;'; // pause
  playBtn.classList.add('playing');
}

async function renameClip(id, currentTitle) {
  const newTitle = await prompt('Rename clip:', currentTitle);
  if (!newTitle?.trim() || newTitle.trim() === currentTitle) return;
  const { error } = await supabase.from('clips').update({ title: newTitle.trim() }).eq('id', id);
  if (error) { await alert(`Could not rename: ${error.message}`); return; }
  renderLibrary();
}

async function shareClip(clip) {
  const { data, error } = await supabase.storage
    .from('user-clips')
    .createSignedUrl(clip.audio_url, 604800); // 7 days

  if (error || !data?.signedUrl) { await alert('Could not create share link.'); return; }

  try {
    await navigator.clipboard.writeText(data.signedUrl);
    await alert('Share link copied!\n\nThis link is valid for 7 days.');
  } catch {
    await alert(`Share link (valid 7 days):\n${data.signedUrl}`);
  }
}

async function deleteClip(clip) {
  const ok = await confirm(`Delete "${clip.title}"?\n\nThis cannot be undone.`);
  if (!ok) return;

  if (clip.audio_url) {
    await supabase.storage.from('user-clips').remove([clip.audio_url]);
  }
  const { error } = await supabase.from('clips').delete().eq('id', clip.id);
  if (error) { await alert(`Could not delete: ${error.message}`); return; }

  if (clipPlayingId === clip.id && clipAudio) {
    clipAudio.pause();
    clipPlayingId = null;
  }
  renderLibrary();
}

function formatDuration(secs) {
  const s = Math.round(secs);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function uploadErrMsg(err, bytes) {
  const status = String(err?.statusCode ?? err?.status ?? '');
  const msg = (err?.message ?? '').toLowerCase();
  const isTooLarge = status === '413' || msg.includes('too large') || msg.includes('payload') || msg.includes('exceeded');
  if (isTooLarge) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    return `Recording is too large to upload (${mb} MB). The limit is 50 MB — try a shorter clip.`;
  }
  return 'Upload failed — check your connection and try again.';
}

// ===== UTILS =====

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
