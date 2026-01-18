
// Practice Sidebar Logic

window.practiceItems = [];

async function togglePracticeSidebar() {
  const sb = document.getElementById('practiceSidebar');
  const isOpen = sb.classList.contains('open');

  // Close other sidebar if open
  document.getElementById('courseSidebar').classList.remove('open');

  if (isOpen) {
    sb.classList.remove('open');
    sb.setAttribute('aria-hidden', 'true');
  } else {
    sb.classList.add('open');
    sb.removeAttribute('aria-hidden');
    fetchPracticeItems();
  }
}

function closePracticeSidebar() {
  const sb = document.getElementById('practiceSidebar');
  sb.classList.remove('open');
  sb.setAttribute('aria-hidden', 'true');
}

// Bindings
document.getElementById('togglePracticeBtn')?.addEventListener('click', togglePracticeSidebar);
document.getElementById('closePracticeSidebar')?.addEventListener('click', closePracticeSidebar);
document.getElementById('refreshPracticeBtn')?.addEventListener('click', fetchPracticeItems);
document.getElementById('startPracticeBtn')?.addEventListener('click', startPractice);

function startPractice() {
  if (window.practiceItems.length > 0) {
    const first = window.practiceItems[0];
    loadPracticeItem(first.item_type, first.reference_id);
  } else {
    alert("Add items to your practice plan first!");
  }
}

async function fetchPracticeItems() {
  if (!currentUser) {
    document.getElementById('practiceList').innerHTML = '<p style="padding:20px; text-align:center;">Please sign in to view practice plan.</p>';
    return;
  }

  document.getElementById('practiceList').innerHTML = '<p class="loading">Loading...</p>';

  const { data, error } = await supabase1
    .from('practice_items')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching practice items:', error);
    document.getElementById('practiceList').innerHTML = '<p class="error">Failed to load items.</p>';
    return;
  }

  window.practiceItems = data || [];
  renderPracticeItems();
}

function renderPracticeItems() {
  const container = document.getElementById('practiceList');
  if (window.practiceItems.length === 0) {
    container.innerHTML = `<div class="empty-courses"><p>Practice plan is empty.</p></div>`;
    return;
  }

  container.innerHTML = window.practiceItems.map((item, index) => `
        <div class="practice-item" draggable="true" data-id="${item.id}" data-index="${index}"
             style="padding: 12px; background: rgba(0,0,0,0.03); border-radius: 8px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; cursor: grab;">
            <div style="cursor: move; padding-right:8px; opacity:0.3;">⋮⋮</div>
            <div style="flex:1; cursor: pointer;" onclick="loadPracticeItem('${item.item_type}', '${item.reference_id}')">
                <div style="font-size: 11px; text-transform: uppercase; color: #888; font-weight: 700;">${item.item_type}</div>
                <div style="font-weight: 600; font-size: 14px;">${item.title || 'Untitled'}</div>
            </div>
            <button onclick="removeFromPractice('${item.id}')" class="text-btn" style="color: #999; padding: 4px;">&times;</button>
        </div>
    `).join('');

  setupDragAndDrop();
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
  const container = document.getElementById('practiceList');
  const afterElement = getDragAfterElement(container, e.clientY);

  if (!dragSrcEl) return;

  const currentNext = dragSrcEl.nextElementSibling;

  // Optimization: Only move if position changed
  if (afterElement === currentNext) return;

  // FLIP: First (Capture)
  const siblings = [...container.querySelectorAll('.practice-item')];
  const positions = new Map();
  siblings.forEach(el => positions.set(el, el.getBoundingClientRect().top));

  // FLIP: Last (Change)
  if (afterElement == null) {
    container.appendChild(dragSrcEl);
  } else {
    container.insertBefore(dragSrcEl, afterElement);
  }

  // FLIP: Invert & Play
  siblings.forEach(el => {
    // Don't animate the dragged element itself (ghost handles it)
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
  const container = document.getElementById('practiceList');
  const newItems = [];
  [...container.children].forEach(child => {
    const id = child.dataset.id;
    const item = window.practiceItems.find(p => p.id === id);
    if (item) newItems.push(item);
  });

  window.practiceItems = newItems;
  updateSortOrder();
  return false;
}

function handleDragEnd(e) {
  this.style.opacity = '1';
  this.classList.remove('squeezed');

  // Cleanup
  document.querySelectorAll('.practice-item').forEach(i => {
    i.style.transform = '';
    i.style.transition = '';
  });
}

async function updateSortOrder() {
  const updates = window.practiceItems.map((item, index) => ({
    ...item,
    sort_order: index
  }));
  const { error } = await supabase1.from('practice_items').upsert(updates);
  if (error) console.error("Sort update failed", error);
}

function isItemInPractice(type, id) {
  return window.practiceItems.some(p => p.reference_id === id && p.item_type === type);
}

async function togglePracticeItem(type, id, title) {
  if (!currentUser) return alert("Sign in to practice.");

  const existing = window.practiceItems.find(p => p.reference_id === id && p.item_type === type);

  if (existing) {
    if (confirm(`Remove "${title}" from practice?`)) {
      await removeFromPractice(existing.id);
      return false;
    }
    return true;
  } else {
    const { error } = await supabase1.from('practice_items').insert({
      user_id: currentUser.id, item_type: type, reference_id: id, title: title,
      sort_order: window.practiceItems.length
    });
    if (!error) {
      fetchPracticeItems();
      const sb = document.getElementById('practiceSidebar');
      if (!sb.classList.contains('open')) togglePracticeSidebar();
      return true;
    }
  }
  return false;
}

async function addToPractice(type, id, title) {
  return togglePracticeItem(type, id, title);
}

async function removeFromPractice(recordId) {
  if (!confirm("Remove from practice plan?")) return;

  const { error } = await supabase1.from('practice_items').delete().eq('id', recordId);
  if (!error) {
    fetchPracticeItems();
  }
}

async function loadPracticeItem(type, id) {
  if (type === 'lesson') {
    // Ensure courses are loaded so we can find the lesson
    if (!window.allLessons || window.allLessons.length === 0) {
      if (typeof window.fetchCourses === 'function') {
        await window.fetchCourses(); // Assuming fetchCourses is exposed
      } else if (typeof fetchCourses === 'function') {
        await fetchCourses();
      }
    }
    loadLesson(id);
  } else if (type === 'pattern') {
    const { data, error } = await supabase1
      .from('shared_patterns')
      .select('pattern_json, name')
      .eq('id', id)
      .single();

    if (data && data.pattern_json) {
      applyPattern(data.pattern_json);

      // Show in player panel
      const titleEl = document.getElementById('activeLessonTitle');
      if (titleEl) titleEl.textContent = "Practice: " + data.name;

      document.getElementById('lessonPlayer').style.display = 'block';
      document.getElementById('lessonDescription').textContent = "Practicing Community Pattern";

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

window.addToPractice = addToPractice;
window.togglePracticeItem = togglePracticeItem;
window.isItemInPractice = isItemInPractice;
