import { Bus, BUS_EVENT } from './bus.js';
import { currentUser } from './state.js';
import { supabase } from './supabase-client.js';
import { applyPattern } from './pattern-crud.js';

// State
let practiceItems = [];

// DOM Elements
const sidebar = document.getElementById('practiceSidebar');
const container = document.getElementById('practiceList');

export async function togglePracticeSidebar() {
  const isOpen = sidebar.classList.contains('open');

  // Close other sidebar if open
  const courseSb = document.getElementById('courseSidebar');
  if (courseSb) courseSb.classList.remove('open');

  if (isOpen) {
    closePracticeSidebar();
  } else {
    sidebar.classList.add('open');
    sidebar.removeAttribute('aria-hidden');
    fetchPracticeItems();
  }
}

export function closePracticeSidebar() {
  if (sidebar) {
    sidebar.classList.remove('open');
    sidebar.setAttribute('aria-hidden', 'true');
  }
}

// Bindings
// We can bind these in init.js or here if this module is imported.
// Since we are refactoring to ESM, let's keep the bindings here but ensure they run on load.
// Ideally, init.js calls an init function, or the module evaluation does it.

export function initPractice() {
  document.getElementById('togglePracticeBtn')?.addEventListener('click', togglePracticeSidebar);
  document.getElementById('closePracticeSidebar')?.addEventListener('click', closePracticeSidebar);
  document.getElementById('refreshPracticeBtn')?.addEventListener('click', fetchPracticeItems);
  document.getElementById('startPracticeBtn')?.addEventListener('click', startPractice);

  Bus.on(BUS_EVENT.AUTH_LOGOUT, () => {
    practiceItems = [];
    if (container) container.innerHTML = '<p style="padding:20px; text-align:center;">Please sign in to view practice plan.</p>';
    closePracticeSidebar();
  });
}

// Call init immediately? Or let init.js call it. 
// Standard pattern: side-effects on import is okay for UI bindings if safe.
initPractice();


export function startPractice() {
  if (practiceItems.length > 0) {
    const first = practiceItems[0];
    loadPracticeItem(first.item_type, first.reference_id);
  } else {
    alert("Add items to your practice plan first!");
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
}

function renderPracticeItems() {
  if (!container) return;

  if (practiceItems.length === 0) {
    container.innerHTML = `<div class="empty-courses"><p>Practice plan is empty.</p></div>`;
    return;
  }

  container.innerHTML = practiceItems.map((item, index) => `
        <div class="practice-item" draggable="true" data-id="${item.id}" data-index="${index}"
             style="padding: 12px; background: rgba(0,0,0,0.03); border-radius: 8px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; cursor: grab;">
            <div style="cursor: move; padding-right:8px; opacity:0.3;">⋮⋮</div>
            <div class="practice-item-content" data-type="${item.item_type}" data-ref="${item.reference_id}" style="flex:1; cursor: pointer;">
                <div style="font-size: 11px; text-transform: uppercase; color: #888; font-weight: 700;">${item.item_type}</div>
                <div style="font-weight: 600; font-size: 14px;">${item.title || 'Untitled'}</div>
            </div>
            <button class="remove-practice-btn text-btn" data-id="${item.id}" style="color: #999; padding: 4px;">&times;</button>
        </div>
    `).join('');

  setupDragAndDrop();
}

// Event Delegation for Practice List
if (container) {
  container.addEventListener('click', (e) => {
    // Handle Item Click (Load)
    const contentDiv = e.target.closest('.practice-item-content');
    if (contentDiv) {
      const type = contentDiv.dataset.type;
      const ref = contentDiv.dataset.ref;
      loadPracticeItem(type, ref);
      return;
    }

    // Handle Remove Click
    const removeBtn = e.target.closest('.remove-practice-btn');
    if (removeBtn) {
      const id = removeBtn.dataset.id;
      removeFromPractice(id);
      return;
    }
  });
}


let dragSrcEl = null;

function setupDragAndDrop() {
  const items = document.querySelectorAll('.practice-item');
  items.forEach(item => {
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragend', handleDragEnd);
  });
}

function handleDragStart(e) {
  this.style.opacity = '0.4';
  this.classList.add('squeezed');
  dragSrcEl = this;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragOver(e) {
  e.preventDefault();
  const afterElement = getDragAfterElement(container, e.clientY);

  if (!dragSrcEl) return;
  const currentNext = dragSrcEl.nextElementSibling;
  if (afterElement === currentNext) return;

  // FLIP Animation logic retained...
  const siblings = [...container.querySelectorAll('.practice-item')];
  const positions = new Map();
  siblings.forEach(el => positions.set(el, el.getBoundingClientRect().top));

  if (afterElement == null) {
    container.appendChild(dragSrcEl);
  } else {
    container.insertBefore(dragSrcEl, afterElement);
  }

  siblings.forEach(el => {
    if (el === dragSrcEl) return;
    const oldTop = positions.get(el);
    const newTop = el.getBoundingClientRect().top;
    const delta = oldTop - newTop;

    if (delta && delta !== 0) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      el.getBoundingClientRect(); // Force reflow
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0.2, 1)';
        el.style.transform = '';
      });
    }
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.practice-item:not(.squeezed)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function handleDrop(e) {
  if (e.stopPropagation) e.stopPropagation();

  // Rebuild array from DOM order
  const newItems = [];
  [...container.children].forEach(child => {
    const id = child.dataset.id;
    const item = practiceItems.find(p => p.id === id);
    if (item) newItems.push(item);
  });

  practiceItems = newItems;
  updateSortOrder();
  return false;
}

function handleDragEnd(e) {
  this.style.opacity = '1';
  this.classList.remove('squeezed');
  document.querySelectorAll('.practice-item').forEach(i => {
    i.style.transform = '';
    i.style.transition = '';
  });
}

async function updateSortOrder() {
  const updates = practiceItems.map((item, index) => ({
    ...item,
    sort_order: index
  }));
  const { error } = await supabase.from('practice_items').upsert(updates);
  if (error) console.error("Sort update failed", error);
}

export function isItemInPractice(type, id) {
  return practiceItems.some(p => p.reference_id === id && p.item_type === type);
}

export async function togglePracticeItem(type, id, title) {
  if (!currentUser) return alert("Sign in to practice.");

  const existing = practiceItems.find(p => p.reference_id === id && p.item_type === type);

  if (existing) {
    if (confirm(`Remove "${title}" from practice?`)) {
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
      if (!sidebar.classList.contains('open')) togglePracticeSidebar();
      return true; // Added
    }
  }
  return false;
}

export async function addToPractice(type, id, title) {
  return togglePracticeItem(type, id, title);
}

export async function removeFromPractice(recordId) {
  if (!confirm("Remove from practice plan?")) return;

  const { error } = await supabase.from('practice_items').delete().eq('id', recordId);
  if (!error) {
    fetchPracticeItems();
  }
}

async function loadPracticeItem(type, id) {
  if (type === 'lesson') {
    Bus.emit(BUS_EVENT.REQUEST_LOAD_LESSON, { lessonId: id });
  } else if (type === 'pattern') {
    const { data, error } = await supabase
      .from('shared_patterns')
      .select('pattern_json, name')
      .eq('id', id)
      .single();

    if (data && data.pattern_json) {
      applyPattern(data.pattern_json);

      // Show in player panel (Legacy DOM manipulation, maybe move to controls/UI module?)
      const titleEl = document.getElementById('activeLessonTitle');
      if (titleEl) titleEl.textContent = "Practice: " + data.name;

      const player = document.getElementById('lessonPlayer');
      if (player) player.style.display = 'block';

      const desc = document.getElementById('lessonDescription');
      if (desc) desc.textContent = "Practicing Community Pattern";

      // Hide specific lesson buttons
      const compBtn = document.getElementById('lessonCompleteBtn');
      if (compBtn) compBtn.style.display = 'none';
      const nextBtn = document.getElementById('nextLessonBtn');
      if (nextBtn) nextBtn.style.display = 'none';

    } else {
      alert("Pattern not found (might have been deleted).");
    }
  }

  if (window.innerWidth < 768) closePracticeSidebar();
}
