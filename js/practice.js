import { Bus, BUS_EVENT } from './bus.js';
import { currentUser } from './state.js';
import { supabase } from './supabase-client.js';
import { applyPattern, syncPhraseNameDisplay } from './pattern-crud.js';
import { openLessonSidebar, closeSidebar } from './courses.js';
import { Sidepanel, updateBodySidebarClass, setLastSidebarType, registerPanelOpener } from './sidepanel.js';
import { navigate } from './router.js';

// State
let practiceItems = [];

// DOM Elements
const sidebar = document.getElementById('practiceSidebar');
const practiceSidePanel = new Sidepanel(sidebar, { onClose: updateBodySidebarClass });
const container = document.getElementById('practiceList');

function openPracticeSidebar() {
  setLastSidebarType('practice');
  closeSidebar({ reason: 'practice-open', source: 'practice' });
  practiceSidePanel.open();
  fetchPracticeItems();
  updateBodySidebarClass();
}

export async function togglePracticeSidebar() {
  if (practiceSidePanel.isOpen) {
    closeSidebar({ reason: 'practice-close', source: 'practice' });
  } else {
    openPracticeSidebar();
  }
}

registerPanelOpener('practice', openPracticeSidebar);

export function closePracticeSidebar() {
  practiceSidePanel.close();
}

// Bindings
// We can bind these in init.js or here if this module is imported.
// Since we are refactoring to ESM, let's keep the bindings here but ensure they run on load.
// Ideally, init.js calls an init function, or the module evaluation does it.

export function initPractice() {
  document.getElementById('togglePracticeBtn')?.addEventListener('click', togglePracticeSidebar);
  document.getElementById('toggleExercisesBtn')?.addEventListener('click', togglePracticeSidebar);
  document.getElementById('closePracticeSidebar')?.addEventListener('click', closePracticeSidebar);
  document.getElementById('browseExercisesBtn')?.addEventListener('click', () => {
    closePracticeSidebar();
    navigate('practice');
  });

  Bus.on(BUS_EVENT.AUTH_LOGOUT, () => {
    practiceItems = [];
    if (container) container.innerHTML = '<p style="padding:20px; text-align:center;">Please sign in to view practice plan.</p>';
    closePracticeSidebar();
  });
}

// Call init immediately? Or let init.js call it. 
// Standard pattern: side-effects on import is okay for UI bindings if safe.
initPractice();


export async function startPractice() {
  if (practiceItems.length > 0) {
    const first = practiceItems[0];
    await loadPracticeItem(first.item_type, first.reference_id);
  } else {
    await alert("Add items to your practice plan first!");
  }
}

export async function fetchPracticeItems() {
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = '<p style="padding:20px; text-align:center;">Please sign in to view practice plan.</p>';
    return;
  }

  container.innerHTML = '<p class="loading">Loading...</p>';

  const { data, error } = await supabase
    .from('practice_items')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching practice items:', error);
    container.innerHTML = '<p class="error">Failed to load items.</p>';
    return;
  }

  practiceItems = data || [];
  renderPracticeItems();
  Bus.emit(BUS_EVENT.PRACTICE_ITEMS_CHANGED);
}

function practiceItemHTML(item) {
  return `
    <div class="practice-item" draggable="true" data-id="${item.id}">
      <div class="practice-item-drag">⋮⋮</div>
      <div class="practice-item-content" data-type="${item.item_type}" data-ref="${item.reference_id}">
        <div class="practice-item-type">${item.item_type}</div>
        <div class="practice-item-title">${item.title || 'Untitled'}</div>
      </div>
      <button class="remove-practice-btn" data-id="${item.id}" aria-label="Remove">&times;</button>
    </div>
  `;
}

function sectionHTML(label, category, items) {
  return `
    <div class="practice-section">
      <div class="practice-section-label">${label}</div>
      <div class="practice-section-list" data-category="${category}">
        ${items.map(practiceItemHTML).join('')}
        <div class="practice-section-empty">Drag exercises here</div>
      </div>
    </div>
  `;
}

function renderPracticeItems() {
  if (!container) return;

  const daily = practiceItems.filter(p => p.category === 'daily');
  const other = practiceItems.filter(p => p.category !== 'daily');

  container.innerHTML =
    sectionHTML('Daily Practice', 'daily', daily) +
    sectionHTML('Other Exercises', 'other', other);

  syncEmptyStates();
  setupDragAndDrop();
}

function syncEmptyStates() {
  container.querySelectorAll('.practice-section-list').forEach(list => {
    const hasItems = list.querySelector('.practice-item') !== null;
    list.querySelector('.practice-section-empty')?.classList.toggle('visible', !hasItems);
  });
}

// Event delegation — wired once at module load, works across re-renders
if (container) {
  container.addEventListener('click', async e => {
    const contentDiv = e.target.closest('.practice-item-content');
    if (contentDiv) {
      await loadPracticeItem(contentDiv.dataset.type, contentDiv.dataset.ref);
      return;
    }
    const removeBtn = e.target.closest('.remove-practice-btn');
    if (removeBtn) {
      if (await confirm('Remove from practice plan?')) {
        await removeFromPractice(removeBtn.dataset.id);
      }
    }
  });
}

// ── Drag and drop ─────────────────────────────────────────────────────────

let dragSrcEl = null;

function setupDragAndDrop() {
  container.querySelectorAll('.practice-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      dragSrcEl = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      dragSrcEl = null;
      container.querySelectorAll('.practice-section-list').forEach(l => l.classList.remove('drag-over'));
      syncEmptyStates();
      updateSortOrder();
    });
  });

  container.querySelectorAll('.practice-section-list').forEach(list => {
    list.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragSrcEl) return;
      list.classList.add('drag-over');
      const after = getDragAfterElement(list, e.clientY);
      if (after == null) {
        list.insertBefore(dragSrcEl, list.querySelector('.practice-section-empty'));
      } else {
        list.insertBefore(dragSrcEl, after);
      }
    });
    list.addEventListener('dragleave', e => {
      if (!list.contains(e.relatedTarget)) list.classList.remove('drag-over');
    });
    list.addEventListener('drop', e => {
      e.preventDefault();
      list.classList.remove('drag-over');
    });
  });
}

function getDragAfterElement(list, y) {
  const items = [...list.querySelectorAll('.practice-item:not(.dragging)')];
  return items.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    return offset < 0 && offset > closest.offset ? { offset, element: child } : closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function updateSortOrder() {
  const updates = [];
  container.querySelectorAll('.practice-section-list').forEach(list => {
    const category = list.dataset.category;
    [...list.querySelectorAll('.practice-item')].forEach((el, index) => {
      const item = practiceItems.find(p => p.id === el.dataset.id);
      if (item) {
        item.category = category;
        item.sort_order = index;
        updates.push({ id: item.id, category, sort_order: index });
      }
    });
  });

  const results = await Promise.all(
    updates.map(u =>
      supabase.from('practice_items')
        .update({ category: u.category, sort_order: u.sort_order })
        .eq('id', u.id)
    )
  );

  const firstError = results.find(r => r.error)?.error;
  if (firstError) console.error('[Practice] updateSortOrder failed:', firstError);
}

export function isItemInPractice(type, id) {
  return practiceItems.some(p => p.reference_id === id && p.item_type === type);
}

export async function togglePracticeItem(type, id, title) {
  if (!currentUser) return await alert("Sign in to practice.");

  const existing = practiceItems.find(p => p.reference_id === id && p.item_type === type);

  if (existing) {
    if (await confirm(`Remove "${title}" from practice?`)) {
      await removeFromPractice(existing.id);
      return false; // Removed
    }
    return true; // Still there
  } else {
    // Optimistic UI update could go here
    const { error } = await supabase.from('practice_items').insert({
      user_id: currentUser.id, item_type: type, reference_id: id, title: title,
      sort_order: practiceItems.length
    });

    if (!error) {
      await fetchPracticeItems();
      if (!practiceSidePanel.isOpen) togglePracticeSidebar();
      return true; // Added
    }
  }
  return false;
}

export async function addToPractice(type, id, title) {
  return togglePracticeItem(type, id, title);
}

export async function removeFromPractice(recordId) {
  const { error } = await supabase.from('practice_items').delete().eq('id', recordId);
  if (!error) {
    await fetchPracticeItems();
  }
}

async function loadPracticeItem(type, id) {
  if (type === 'exercise') {
    navigate('practice');
    const { openExerciseById } = await import('./exercises.js');
    openExerciseById(id);
  } else if (type === 'lesson') {
    Bus.emit(BUS_EVENT.REQUEST_LOAD_LESSON, { lessonId: id });
  } else if (type === 'pattern') {
    const { data, error } = await supabase
      .from('shared_patterns')
      .select('pattern_json, name')
      .eq('id', id)
      .single();

    if (data && data.pattern_json) {
      await applyPattern(data.pattern_json);
      syncPhraseNameDisplay(data.name);

      // Show in player panel
      const titleEl = document.getElementById('activeLessonTitle');
      if (titleEl) titleEl.textContent = "Practice: " + data.name;

      openLessonSidebar();

      const desc = document.getElementById('lessonDescription');
      if (desc) desc.textContent = "Practicing Community Pattern";

      // Hide specific lesson buttons
      const compBtn = document.getElementById('lessonCompleteBtn');
      if (compBtn) compBtn.style.display = 'none';
      const nextBtn = document.getElementById('nextLessonBtn');
      if (nextBtn) nextBtn.style.display = 'none';

    } else {
      await alert("Pattern not found (might have been deleted).");
    }
  }

  if (window.innerWidth < 768) closePracticeSidebar();
}
