// Patterns Modal — browse Pattern Mini-Courses (courses generated from a
// Progression, see js/progressions.js). Deliberately reuses course-
// marketplace.js's unlock/archive/activate/publish/delete logic verbatim —
// a Mini-Course is a real row in `courses`, so the exact same
// ownership/publish flow applies. Only the fetch query (filtered to
// progression_id IS NOT NULL), card template (category + preview), and
// category filter are new.

import { Modal } from './modal.js';
import { supabase } from './supabase-client.js';
import { currentUser, isAdminUser } from './state.js';
import { fetchCourses, setActiveCourse, openSidebar } from './courses.js';
import {
  togglePublish, deleteCourse, archiveCourse, activateCourse, unlockCourse,
} from './course-marketplace.js';
import { mountHandpanPreview } from './handpan-pattern-preview.js';
import { SCALES, BASE_PATH } from './config.js';

// Hollow (stroke-only) icons for the play/stop button — deliberately not
// filled shapes, per design direction.
const PLAY_ICON_SVG = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none">
  <circle cx="12" cy="12" r="10.25" stroke="currentColor" stroke-width="1.5"/>
  <path d="M10 8.3v7.4l6.2-3.7-6.2-3.7z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;
const STOP_ICON_SVG = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none">
  <circle cx="12" cy="12" r="10.25" stroke="currentColor" stroke-width="1.5"/>
  <rect x="8.5" y="8.5" width="7" height="7" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

let patternsModal = null;
let patternsPanel = null;
let gridEl = null;
let pillsEl = null;
let closeBtn = null;
let scaleSelectEl = null;

let activeCategory = 'All';
let activePreviews = []; // controllers to stop on close/re-render
let activeCards = []; // { myHandpanBtn, scaleLabelEl, imgEl, controller, intendedScaleLabel } — refreshed on scale change

export async function openPatternsModal() {
  if (!patternsModal) return;

  patternsPanel.open();
  syncScaleSelect();
  gridEl.innerHTML = '<div class="loading-spinner">Loading patterns...</div>';

  try {
    const { data: allCourses, error: cErr } = await supabase
      .from('courses')
      .select('id, title, description, price, is_paid, thumbnail_url, owner_id, is_published, category, tags, intended_scale, preview_lesson_id')
      .not('progression_id', 'is', null)
      .order('created_at', { ascending: false });
    if (cErr) throw cErr;

    let ownedIds = new Set();
    let archivedIds = new Set();
    if (currentUser) {
      const { data: result } = await supabase
        .from('user_courses')
        .select('course_id, is_archived')
        .eq('user_id', currentUser.id);

      (result || []).forEach(r => {
        ownedIds.add(r.course_id);
        if (r.is_archived) archivedIds.add(r.course_id);
      });

      allCourses.forEach(c => {
        if (c.owner_id === currentUser.id) ownedIds.add(c.id);
      });
    }

    const previewByCourse = await resolvePreviewPatterns(allCourses || []);

    renderCategoryPills(allCourses || []);
    renderPatterns(allCourses || [], ownedIds, archivedIds, previewByCourse);

  } catch (err) {
    console.error('Error loading patterns:', err);
    gridEl.innerHTML = '<div style="color:var(--error);">Failed to load patterns.</div>';
  }
}

// Preferred: courses.preview_lesson_id (the admin's chosen phrase — see
// js/progressions.js) points at the actual lesson row, so pattern_json is
// read live rather than duplicated onto courses (can't drift out of sync).
// Falls back to each course's first lesson for older Mini-Courses generated
// before preview_lesson_id existed (or ones without it set for any reason).
async function resolvePreviewPatterns(courses) {
  const result = new Map();
  const needsFallback = [];
  const previewLessonIds = [];
  const courseIdByPreviewLessonId = new Map();

  for (const c of courses) {
    if (c.preview_lesson_id) {
      previewLessonIds.push(c.preview_lesson_id);
      courseIdByPreviewLessonId.set(c.preview_lesson_id, c.id);
    } else {
      needsFallback.push(c.id);
    }
  }

  if (previewLessonIds.length > 0) {
    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, pattern_json')
      .in('id', previewLessonIds);

    for (const l of (lessons || [])) {
      const courseId = courseIdByPreviewLessonId.get(l.id);
      if (courseId && l.pattern_json) result.set(courseId, l.pattern_json);
      else if (courseId) needsFallback.push(courseId); // linked lesson vanished — fall back
    }
  }

  if (needsFallback.length > 0) {
    const fallback = await fetchFirstLessonPatterns(needsFallback);
    for (const [courseId, pattern] of fallback.entries()) result.set(courseId, pattern);
  }

  return result;
}

// Batches: one query for each course's first section, one for each of those
// sections' first lesson — avoids N queries per card.
async function fetchFirstLessonPatterns(courseIds) {
  const result = new Map();
  if (courseIds.length === 0) return result;

  const { data: sections } = await supabase
    .from('sections')
    .select('id, course_id, order_index')
    .in('course_id', courseIds)
    .order('order_index', { ascending: true });

  const firstSectionByCourse = new Map();
  for (const s of (sections || [])) {
    if (!firstSectionByCourse.has(s.course_id)) firstSectionByCourse.set(s.course_id, s.id);
  }
  const sectionIds = [...firstSectionByCourse.values()];
  if (sectionIds.length === 0) return result;

  const { data: lessons } = await supabase
    .from('lessons')
    .select('section_id, pattern_json, order_index')
    .in('section_id', sectionIds)
    .order('order_index', { ascending: true });

  const firstLessonBySection = new Map();
  for (const l of (lessons || [])) {
    if (!firstLessonBySection.has(l.section_id)) firstLessonBySection.set(l.section_id, l.pattern_json);
  }

  for (const [courseId, sectionId] of firstSectionByCourse.entries()) {
    const pattern = firstLessonBySection.get(sectionId);
    if (pattern) result.set(courseId, pattern);
  }
  return result;
}

function renderCategoryPills(courses) {
  const categories = ['All', ...new Set(courses.map(c => c.category).filter(Boolean))];
  if (!categories.includes(activeCategory)) activeCategory = 'All';

  pillsEl.innerHTML = '';
  for (const cat of categories) {
    const pill = document.createElement('button');
    pill.className = 'patterns-category-pill' + (cat === activeCategory ? ' active' : '');
    pill.textContent = cat;
    pill.onclick = () => {
      activeCategory = cat;
      renderCategoryPills(courses);
      renderPatterns(courses, currentOwnedIds, currentArchivedIds, currentPreviewByCourse);
    };
    pillsEl.appendChild(pill);
  }
}

// Cached from the last openPatternsModal() fetch so the category pill
// click handler can re-render without refetching.
let currentOwnedIds = new Set();
let currentArchivedIds = new Set();
let currentPreviewByCourse = new Map();

function renderPatterns(courses, ownedIds, archivedIds, previewByCourse) {
  currentOwnedIds = ownedIds;
  currentArchivedIds = archivedIds;
  currentPreviewByCourse = previewByCourse;

  for (const p of activePreviews) p.stop();
  activePreviews = [];
  activeCards = [];

  gridEl.innerHTML = '';

  const isAdmin = isAdminUser(currentUser);
  const visible = courses.filter(c => {
    if (!isAdmin && c.is_published !== true) return false;
    if (activeCategory !== 'All' && c.category !== activeCategory) return false;
    return true;
  });

  if (visible.length === 0) {
    gridEl.innerHTML = '<p>No patterns in this category yet.</p>';
    return;
  }

  // Only the first card animates by default — many cards flashing at once
  // is a real photosensitivity hazard. The rest stay static until played.
  visible.forEach((course, idx) => {
    gridEl.appendChild(buildCard(course, ownedIds, archivedIds, previewByCourse, isAdmin, idx === 0));
  });
}

function buildCard(course, ownedIds, archivedIds, previewByCourse, isAdmin, autoplay) {
  const isOwned = ownedIds.has(course.id);
  const isArchived = archivedIds.has(course.id);
  const isPaid = course.is_paid;
  const isPublished = course.is_published;

  let badgeClass = 'free';
  let badgeText = 'FREE';
  if (isPaid) { badgeClass = 'paid'; badgeText = `$${course.price}`; }
  if (isAdmin && !isPublished) { badgeClass = 'paid'; badgeText = 'DRAFT'; }
  else if (isOwned && isPublished) { badgeClass = 'free'; badgeText = isArchived ? 'ARCHIVED' : 'OWNED'; }

  let btnClass = 'market-btn get';
  let btnText = 'Get Pattern';
  let btnAction = 'unlock-course';

  if (isPaid && !isOwned) { btnClass = 'market-btn buy'; btnText = 'Buy'; }
  if (isOwned) {
    if (isArchived) { btnClass = 'market-btn get'; btnText = '✅ Activate'; btnAction = 'activate-course'; }
    else { btnClass = 'market-btn'; btnText = '📦 Archive'; btnAction = 'archive-course'; }
  }

  const card = document.createElement('div');
  card.className = `market-card ${isPaid ? 'premium' : ''}`;
  if (!isPublished) card.style.opacity = '0.85';

  let adminActions = '';
  if (isAdmin) {
    const publishLabel = isPublished ? 'Unpublish' : 'Publish';
    const publishColor = isPublished ? '#f39c12' : '#27ae60';
    adminActions = `
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="market-btn" data-action="toggle-publish" data-id="${course.id}" data-status="${isPublished}"
          style="background-color:${publishColor}; border:none; flex:1;">${publishLabel}</button>
        <button class="market-btn" data-action="delete-course" data-id="${course.id}"
          style="background-color:#e74c3c; border:none; flex:1;">Delete</button>
      </div>
    `;
  }

  const tagsHtml = (course.tags || []).map(t => `<span class="card-meta-pill">${escapeHtml(t)}</span>`).join('');

  card.innerHTML = `
    <div class="pattern-preview-thumb">
      <img class="pattern-preview-img" data-preview-img src="${DEFAULT_PREVIEW_IMG}" alt="">
      <div class="pattern-preview-overlay" data-preview-overlay></div>
      <div class="price-badge ${badgeClass}">${badgeText}</div>
      <div class="pattern-scale-label" data-scale-label>Made for: ${escapeHtml(course.intended_scale || Object.keys(SCALES)[0])}</div>
      <button class="pattern-play-btn" data-action="play-preview" title="Play preview">${PLAY_ICON_SVG}</button>
      <button class="pattern-myhandpan-toggle" data-action="toggle-myhandpan" title="Preview with my selected handpan">🎹 My Handpan</button>
    </div>
    <div class="card-content">
      <div class="card-meta-row">${course.category ? `<span class="card-meta-pill">${escapeHtml(course.category)}</span>` : ''}${tagsHtml}</div>
      <h3 class="card-title">${escapeHtml(course.title)} ${(!isPublished && isAdmin) ? '(Draft)' : ''}</h3>
      <div class="card-desc">${escapeHtml(course.description || 'No description provided.')}</div>
      <button class="${btnClass}" data-action="${btnAction}" data-id="${course.id}" data-paid="${isPaid}">${btnText}</button>
      ${adminActions}
    </div>
  `;

  const overlayEl = card.querySelector('[data-preview-overlay]');
  const patternData = previewByCourse.get(course.id);
  if (overlayEl && patternData) {
    const controller = mountHandpanPreview(overlayEl, patternData, { scaleName: course.intended_scale, autoplay });
    activePreviews.push(controller);

    const playBtn = card.querySelector('[data-action="play-preview"]');
    playBtn.onclick = (e) => {
      e.stopPropagation();
      const wasPlaying = playBtn.classList.contains('playing');

      // Only one card animates/plays at a time — pause every card first
      // (including this one, and including the default-autoplaying first
      // card even if its own button was never clicked).
      for (const p of activePreviews) p.pause();
      document.querySelectorAll('.pattern-play-btn.playing').forEach(b => {
        b.classList.remove('playing');
        b.innerHTML = PLAY_ICON_SVG;
      });

      if (wasPlaying) return; // this button's own click just stopped it

      controller.play();
      playBtn.classList.add('playing');
      playBtn.innerHTML = STOP_ICON_SVG;

      // Brief highlight flash, then fade back to the transparent base state.
      playBtn.classList.add('flash');
      setTimeout(() => playBtn.classList.remove('flash'), 220);
    };

    const myHandpanBtn = card.querySelector('[data-action="toggle-myhandpan"]');
    const scaleLabelEl = card.querySelector('[data-scale-label]');
    const imgEl = card.querySelector('[data-preview-img]');
    const intendedScaleLabel = course.intended_scale || Object.keys(SCALES)[0];
    const cardRef = { myHandpanBtn, scaleLabelEl, imgEl, controller, intendedScaleLabel };
    activeCards.push(cardRef);

    myHandpanBtn.onclick = (e) => {
      e.stopPropagation();
      applyMineMode(cardRef, !myHandpanBtn.classList.contains('active'));
    };
  }

  return card;
}

function applyMineMode(cardRef, usingMine) {
  const { myHandpanBtn, scaleLabelEl, imgEl, controller, intendedScaleLabel } = cardRef;
  myHandpanBtn.classList.toggle('active', usingMine);
  controller.setScaleSource(usingMine ? 'mine' : 'intended');
  scaleLabelEl.textContent = `Previewing: ${usingMine ? getCurrentScaleLabel() : intendedScaleLabel}`;
  imgEl.src = usingMine ? (getCurrentHandpanImageSrc() || DEFAULT_PREVIEW_IMG) : DEFAULT_PREVIEW_IMG;
}

// Mirrors #scaleSelect's own options (system scales + the viewer's custom
// handpans) rather than rebuilding that list — it's already correctly
// grouped/labeled by handpanmap.js's renderCustomOptions.
function syncScaleSelect() {
  const mainSelect = document.getElementById('scaleSelect');
  if (!mainSelect || !scaleSelectEl) return;
  scaleSelectEl.innerHTML = mainSelect.innerHTML;
  scaleSelectEl.value = mainSelect.value;
}

// #scaleSelect already shows the friendly name for whatever's active — a
// system scale name, or a custom handpan's own name (see handpanmap.js's
// renderCustomOptions) — so read it directly rather than re-deriving it.
function getCurrentScaleLabel() {
  const selectEl = document.getElementById('scaleSelect');
  const selected = selectEl?.options[selectEl.selectedIndex];
  return selected?.textContent?.trim() || 'My Handpan';
}

const DEFAULT_PREVIEW_IMG = `${BASE_PATH}assets/images/handpan-for-groovepan.png`;

// #handpanImg is the actual studio <img> — its .src always reflects
// whatever's currently mounted (default Bronze/Sketch model, or a custom
// handpan's own uploaded photo), so it's simplest to read directly rather
// than re-deriving which case is active.
function getCurrentHandpanImageSrc() {
  return document.getElementById('handpanImg')?.src || null;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function closePatternsModal() {
  for (const p of activePreviews) p.stop();
  activePreviews = [];
  activeCards = [];
  patternsPanel?.close();
}

export function initPatternsModal() {
  patternsModal = document.getElementById('patternsModal');
  if (!patternsModal) return;

  patternsPanel = new Modal(patternsModal, { onClose: () => {
    for (const p of activePreviews) p.stop();
    activePreviews = [];
    activeCards = [];
  }});
  gridEl = document.getElementById('patternsGrid');
  pillsEl = document.getElementById('patternsCategoryPills');
  closeBtn = document.getElementById('closePatternsBtn');
  scaleSelectEl = document.getElementById('patternsScaleSelect');

  closeBtn?.addEventListener('click', closePatternsModal);

  scaleSelectEl?.addEventListener('change', () => {
    const mainSelect = document.getElementById('scaleSelect');
    if (!mainSelect) return;
    mainSelect.value = scaleSelectEl.value;
    mainSelect.dispatchEvent(new Event('change'));

    // handpanmap.js's own change handler (custom-handpan fetch, sample
    // preload, image swap) is async with no completion signal to hook into
    // — a short delay before refreshing already-"mine" cards is a pragmatic
    // stand-in rather than adding cross-module event plumbing for this.
    setTimeout(() => {
      for (const cardRef of activeCards) {
        if (cardRef.myHandpanBtn.classList.contains('active')) applyMineMode(cardRef, true);
      }
    }, 500);
  });

  gridEl.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;
    const status = target.dataset.status === 'true';
    const isPaid = target.dataset.paid === 'true';

    if (action === 'toggle-publish') togglePublish(id, status).then(openPatternsModal);
    else if (action === 'delete-course') deleteCourse(id).then(openPatternsModal);
    else if (action === 'archive-course') archiveCourse(id).then(openPatternsModal);
    else if (action === 'unlock-course') { await unlockCourse(id, isPaid, target); closePatternsModal(); }
    else if (action === 'activate-course') { await activateCourse(id); closePatternsModal(); }
  });

  document.body.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action="open-patterns"]');
    if (target) openPatternsModal();
  });
}
