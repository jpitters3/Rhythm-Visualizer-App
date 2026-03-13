/**
 * course-copier.js
 * Admin-only UI for copying / reordering sections between courses via drag-and-drop.
 */

import { supabase } from './supabase-client.js';
import { loadCourseToEdit } from './course-creator.js';
import { Bus, BUS_EVENT } from './bus.js';

// ── State ─────────────────────────────────────────────────────────────────────
let allAdminCourses = [];   // Full course list (admin sees everything)

// Each side holds: { courseId, sections: [{id, title, order_index, is_published, lessons:[…]}] }
const state = {
  left:  { courseId: null, sections: [] },
  right: { courseId: null, sections: [] },
};

// Drag state
let dragSrc = null; // { side:'left'|'right', sIdx:Number }

// ── Init ──────────────────────────────────────────────────────────────────────
export async function initCourseCopier() {
  // Modal open/close
  document.getElementById('closeCourseCopierModal')
    ?.addEventListener('click', closeCourseCopier);
  document.getElementById('courseCopierModal')
    ?.addEventListener('click', (e) => {
      if (e.target.id === 'courseCopierModal') closeCourseCopier();
    });

  // Search bar — renders rich results panel
  document.getElementById('copierSearch')
    ?.addEventListener('input', (e) => {
      const term = e.target.value.trim();
      renderSearchResults(term);
    });

  // Course selects
  document.getElementById('copierSelectLeft')
    ?.addEventListener('change', (e) => loadSide('left', e.target.value));
  document.getElementById('copierSelectRight')
    ?.addEventListener('change', (e) => loadSide('right', e.target.value));

  // Edit Course buttons
  document.getElementById('copierEditLeft')
    ?.addEventListener('click', () => editCourse('left'));
  document.getElementById('copierEditRight')
    ?.addEventListener('click', () => editCourse('right'));

  // Save buttons
  document.getElementById('copierSaveBtn')
    ?.addEventListener('click', () => saveAll(false));
  document.getElementById('copierSaveCloseBtn')
    ?.addEventListener('click', () => saveAll(true));
}

export async function openCourseCopier() {
  const modal = document.getElementById('courseCopierModal');
  if (!modal) return;

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  allAdminCourses = await fetchAllCourses();
  populateDropdowns(allAdminCourses);
  const searchEl = document.getElementById('copierSearch');
  if (searchEl) searchEl.value = '';
  renderSearchResults(''); // clear any previous results

  // Reset columns
  state.left  = { courseId: null, sections: [] };
  state.right = { courseId: null, sections: [] };
  renderSide('left');
  renderSide('right');
}

function closeCourseCopier() {
  const modal = document.getElementById('courseCopierModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function fetchAllCourses() {
  const { data, error } = await supabase
    .from('courses')
    .select(`
      id, title,
      sections (
        id, title, order_index, is_published,
        lessons ( id, title, order_index, description, video_url, pattern_json, pattern_name, section_id )
      )
    `)
    .order('title', { ascending: true });

  if (error) { console.error('[CourseCopier] fetch error', error); return []; }
  return data || [];
}

/** Returns true if a course matches the search query anywhere in its titles. */
function courseMatchesSearch(course, term) {
  if (course.title.toLowerCase().includes(term)) return true;
  return (course.sections || []).some(s => {
    if (s.title.toLowerCase().includes(term)) return true;
    return (s.lessons || []).some(l => l.title.toLowerCase().includes(term));
  });
}

/**
 * Wrap every occurrence of `term` in `text` with a <mark> highlight.
 * Returns plain text if no term.
 */
function highlightMatch(text, term) {
  if (!term) return escHtml(text);
  const escaped = escHtml(text);
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${escapedTerm})`, 'gi'), '<mark class="copier-hl">$1</mark>');
}

/**
 * Build / hide the rich search results panel.
 * When term is blank, hide the panel and show the regular dropdown.
 */
function renderSearchResults(term) {
  const panel = document.getElementById('copierSearchResults');
  const dropdown = document.getElementById('copierSelectLeft');
  const query = term.toLowerCase();

  if (!term) {
    if (panel) panel.style.display = 'none';
    if (dropdown) dropdown.style.display = '';
    populateDropdowns(allAdminCourses);
    return;
  }

  // Hide the plain dropdown while results are showing
  if (dropdown) dropdown.style.display = 'none';

  const matched = allAdminCourses.filter(c => courseMatchesSearch(c, query));

  if (!panel) return;

  if (matched.length === 0) {
    panel.innerHTML = '<div class="csr-empty">No courses, sections, or lessons matched.</div>';
    panel.style.display = 'block';
    return;
  }

  panel.innerHTML = '';
  panel.style.display = 'block';

  matched.forEach(course => {
    const courseNode = document.createElement('div');
    courseNode.className = 'csr-course';

    const titleMatchesCourse = course.title.toLowerCase().includes(query);

    // Course title row — clicking selects this course into the left column
    const titleRow = document.createElement('div');
    titleRow.className = 'csr-course-title';
    titleRow.innerHTML = highlightMatch(course.title, term);
    titleRow.title = 'Click to load this course';
    titleRow.addEventListener('click', () => {
      // Select in dropdown and load on the left
      const sel = document.getElementById('copierSelectLeft');
      if (sel) {
        // Restore dropdown visibility and select value
        sel.style.display = '';
        panel.style.display = 'none';
        document.getElementById('copierSearch').value = '';
        sel.value = course.id;
        loadSide('left', course.id);
        populateDropdowns(allAdminCourses);
        sel.value = course.id; // ensure selected after repopulate
      }
    });
    courseNode.appendChild(titleRow);

    // Sections that match (or all sections if the course title matched)
    const sortedSections = [...(course.sections || [])].sort((a, b) => a.order_index - b.order_index);
    sortedSections.forEach(section => {
      const sectionMatchesTerm = section.title.toLowerCase().includes(query);
      const matchingLessons = (section.lessons || []).filter(l => l.title.toLowerCase().includes(query));

      // Show this section if: course title matched (show all), or section itself matched, or a lesson inside matched
      if (!titleMatchesCourse && !sectionMatchesTerm && matchingLessons.length === 0) return;

      const sectionNode = document.createElement('div');
      sectionNode.className = 'csr-section';

      const sectionTitle = document.createElement('div');
      sectionTitle.className = 'csr-section-title';
      sectionTitle.innerHTML = '📂 ' + highlightMatch(section.title, sectionMatchesTerm ? term : '');
      sectionNode.appendChild(sectionTitle);

      // Show matching lessons (always show all if section title matched or course title matched)
      const lessonsToShow = (titleMatchesCourse || sectionMatchesTerm)
        ? [...(section.lessons || [])].sort((a, b) => a.order_index - b.order_index)
        : matchingLessons.sort((a, b) => a.order_index - b.order_index);

      lessonsToShow.forEach(lesson => {
        const lessonNode = document.createElement('div');
        lessonNode.className = 'csr-lesson';
        const lessonMatches = lesson.title.toLowerCase().includes(query);
        lessonNode.innerHTML = '• ' + highlightMatch(lesson.title, lessonMatches ? term : '');
        sectionNode.appendChild(lessonNode);
      });

      courseNode.appendChild(sectionNode);
    });

    panel.appendChild(courseNode);
  });
}

function populateDropdowns(courses = allAdminCourses) {
  ['Left', 'Right'].forEach(side => {
    const sel = document.getElementById(`copierSelect${side}`);
    if (!sel) return;
    const currentVal = sel.value; // preserve current selection if possible
    sel.innerHTML = courses.length === 0
      ? '<option value="">— No matches —</option>'
      : '<option value="">— Select a Course —</option>'
        + courses.map(c =>
            `<option value="${c.id}">${escHtml(c.title)}</option>`
          ).join('');
    // Restore previous selection if still in list
    if (courses.some(c => c.id === currentVal)) sel.value = currentVal;
  });
}

function loadSide(side, courseId) {
  const course = allAdminCourses.find(c => c.id === courseId);
  state[side].courseId = courseId || null;
  state[side].sections = course
    ? JSON.parse(JSON.stringify(
        course.sections
          .map(s => ({ ...s, lessons: [...(s.lessons || [])].sort((a,b) => a.order_index - b.order_index) }))
          .sort((a, b) => a.order_index - b.order_index)
      ))
    : [];
  renderSide(side);
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderSide(side) {
  const container = document.getElementById(
    side === 'left' ? 'copierSectionsLeft' : 'copierSectionsRight'
  );
  if (!container) return;

  const sections = state[side].sections;

  if (!state[side].courseId) {
    container.innerHTML = '<p style="opacity:0.5; font-size:13px; padding:10px;">Select a course above.</p>';
    return;
  }
  if (sections.length === 0) {
    container.innerHTML = '<p style="opacity:0.5; font-size:13px; padding:10px;">No sections in this course.</p>';
    return;
  }

  container.innerHTML = '';

  sections.forEach((section, sIdx) => {
    const el = document.createElement('div');
    el.className = 'copier-section';
    el.setAttribute('draggable', 'true');
    el.dataset.side = side;
    el.dataset.sidx = sIdx;

    const pubStyle = section.is_published ? '' : 'border-left: 3px dashed #f39c12; opacity: 0.8;';

    el.innerHTML = `
      <div class="copier-section-header" style="${pubStyle}">
        <span class="copier-drag-handle" title="Drag to reorder">☰</span>
        <span class="copier-section-title">${escHtml(section.title)}</span>
        ${!section.is_published ? '<span class="copier-draft-badge">Draft</span>' : ''}
        <button class="copier-toggle-btn" data-side="${side}" data-sidx="${sIdx}" title="Toggle lessons">▾</button>
      </div>
      <div class="copier-lessons" id="copier-lessons-${side}-${sIdx}" style="display:none;">
        ${(section.lessons || []).map(l =>
          `<div class="copier-lesson-item">
             <span class="copier-lesson-icon">•</span>
             <span class="copier-lesson-title">${escHtml(l.title)}</span>
           </div>`
        ).join('')}
        ${section.lessons.length === 0 ? '<div style="opacity:0.4; font-size:12px; padding:4px 8px;">No lessons</div>' : ''}
      </div>`;

    // D&D
    el.addEventListener('dragstart', e => onDragStart(e, side, sIdx));
    el.addEventListener('dragover',  e => onDragOver(e));
    el.addEventListener('dragenter', e => onDragEnter(e, el));
    el.addEventListener('dragleave', e => onDragLeave(e, el));
    el.addEventListener('drop',      e => onDrop(e, side, sIdx));
    el.addEventListener('dragend',   onDragEnd);

    // Toggle
    el.querySelector('.copier-toggle-btn').addEventListener('click', () => {
      const lessons = document.getElementById(`copier-lessons-${side}-${sIdx}`);
      if (lessons) lessons.style.display = lessons.style.display === 'none' ? 'block' : 'none';
    });

    container.appendChild(el);
  });

  // Make the body itself a drop target (for dropping into empty space at end)
  container.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  container.ondrop = e => {
    // Only handle if dropped directly on the container, not on a child section
    if (e.target === container) {
      onDrop(e, side, state[side].sections.length - 1);
    }
  };
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────
function onDragStart(e, side, sIdx) {
  dragSrc = { side, sIdx };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', JSON.stringify({ side, sIdx }));
  setTimeout(() => e.target.classList.add('copier-dragging'), 0);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function onDragEnter(e, el) {
  el.classList.add('copier-drop-target');
}

function onDragLeave(e, el) {
  // Only remove if we actually left the element (not just a child)
  if (!el.contains(e.relatedTarget)) {
    el.classList.remove('copier-drop-target');
  }
}

function onDragEnd(e) {
  document.querySelectorAll('.copier-dragging').forEach(el => el.classList.remove('copier-dragging'));
  document.querySelectorAll('.copier-drop-target').forEach(el => el.classList.remove('copier-drop-target'));
  dragSrc = null;
}

async function onDrop(e, targetSide, targetSIdx) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.copier-drop-target').forEach(el => el.classList.remove('copier-drop-target'));

  if (!dragSrc) return;

  const { side: srcSide, sIdx: srcSIdx } = dragSrc;

  if (srcSide === targetSide) {
    // ── Reorder within same course ──
    if (srcSIdx === targetSIdx) return;

    const sections = state[srcSide].sections;
    const [moved] = sections.splice(srcSIdx, 1);
    sections.splice(targetSIdx, 0, moved);

    renderSide(srcSide);
    await autoSaveOrder(srcSide);

  } else {
    // ── Copy from source course to destination course ──
    if (!state[targetSide].courseId) {
      showStatus('Please select a destination course first.', true);
      return;
    }

    const srcSection = state[srcSide].sections[srcSIdx];
    if (!srcSection) return;

    await copySection(srcSection, targetSide, targetSIdx);
  }
}

// ── Core Operations ───────────────────────────────────────────────────────────

/** Deep-copy a section (and its lessons) into the target course at the given position. */
async function copySection(srcSection, targetSide, targetSIdx) {
  const targetCourseId = state[targetSide].courseId;
  if (!targetCourseId) return;

  showStatus('Copying section…');

  try {
    // 1. Determine insertion order_index (insert after targetSIdx)
    const targetSections = state[targetSide].sections;
    const insertAt = Math.min(targetSIdx + 1, targetSections.length);

    // 2. Insert new section row
    const { data: newSection, error: secErr } = await supabase
      .from('sections')
      .insert([{
        course_id: targetCourseId,
        title: srcSection.title,
        is_published: srcSection.is_published,
        order_index: insertAt,
      }])
      .select()
      .single();

    if (secErr) throw secErr;

    // 3. Insert lessons in order
    const lessonsToInsert = (srcSection.lessons || []).map((l, lIdx) => ({
      section_id: newSection.id,
      title: l.title,
      description: l.description || '',
      video_url: l.video_url || '',
      pattern_json: l.pattern_json || null,
      pattern_name: l.pattern_name || '',
      order_index: lIdx,
    }));

    let insertedLessons = [];
    if (lessonsToInsert.length > 0) {
      const { data: newLessons, error: lesErr } = await supabase
        .from('lessons')
        .insert(lessonsToInsert)
        .select();
      if (lesErr) throw lesErr;
      insertedLessons = newLessons || [];
    }

    // 4. Merge into local state
    const newSectionLocal = {
      ...newSection,
      lessons: insertedLessons.sort((a, b) => a.order_index - b.order_index),
    };

    targetSections.splice(insertAt, 0, newSectionLocal);
    renderSide(targetSide);

    // 5. Fix order_index for all dest sections after the insert
    await autoSaveOrder(targetSide);

    showStatus(`✓ Section "${srcSection.title}" copied successfully.`);
    Bus.emit(BUS_EVENT.COURSE_DATA_CHANGED);

  } catch (err) {
    console.error('[CourseCopier] Copy failed:', err);
    showStatus('Copy failed: ' + err.message, true);
  }
}

/** Persist the current section order for one side. */
async function autoSaveOrder(side) {
  const sections = state[side].sections;
  const updates = sections.map((s, idx) =>
    supabase.from('sections').update({ order_index: idx }).eq('id', s.id)
  );
  await Promise.all(updates);
}

/** Full save: rewrite order_index for both sides. */
async function saveAll(andClose) {
  showStatus('Saving…');
  try {
    await autoSaveOrder('left');
    await autoSaveOrder('right');

    const statusEl = document.getElementById('copierSaveStatus');
    if (statusEl) {
      statusEl.style.opacity = '1';
      setTimeout(() => statusEl.style.opacity = '0', 2500);
    }

    Bus.emit(BUS_EVENT.COURSE_DATA_CHANGED);
    showStatus('✓ Saved!');

    if (andClose) closeCourseCopier();
  } catch (err) {
    showStatus('Save failed: ' + err.message, true);
  }
}

/** Open existing Course Creator for the course in the given side. */
function editCourse(side) {
  const courseId = state[side].courseId;
  if (!courseId) { alert('Please select a course first.'); return; }
  const course = allAdminCourses.find(c => c.id === courseId);
  if (!course) return;
  closeCourseCopier();
  loadCourseToEdit(course);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showStatus(msg, isError = false) {
  const bar = document.getElementById('copierStatusBar');
  if (!bar) return;
  bar.textContent = msg;
  bar.style.display = 'block';
  bar.style.color = isError ? '#e74c3c' : '#2ecc71';
  bar.style.background = isError ? 'rgba(231,76,60,0.1)' : 'rgba(46,204,113,0.12)';
  bar.style.borderColor = isError ? 'rgba(231,76,60,0.3)' : 'rgba(46,204,113,0.3)';
  clearTimeout(bar._timeout);
  bar._timeout = setTimeout(() => bar.style.display = 'none', 4000);
}
