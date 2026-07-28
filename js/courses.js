import { alert, confirm, prompt } from './alert.js';
import { Sidepanel, updateBodySidebarClass, setLastSidebarType, registerPanelOpener, toggleLastSidebar } from './sidepanel.js';
import { Bus, BUS_EVENT } from './bus.js';
import { currentUser, isAdminUser } from './state.js';
import { applyPattern, serializePattern, dbSavePattern, refreshPatternSelect, hasUnsavedChanges, snapshotCurrentState } from './pattern-crud.js';
import { stop } from './noteplayer.js';
import { supabase } from './supabase-client.js';
import { updateAdminUI } from './auth.js';
import { isItemInPractice, togglePracticeItem, closePracticeSidebar } from './practice.js';
import { loadCourseToEdit } from './course-creator.js';
import { updateCurrentPhraseName } from './controls.js';
import { openMarketplace } from './course-marketplace.js';
import { autoLinkText } from './glossary.js';
import { openAuthModal } from './auth.js';
import { extractYouTubeId } from './utils.js';
import { renderThumbnail } from './pattern-thumbnail.js';

// ===== SIDEBAR LOGIC (OWNED COURSES) =====

let activeCourseId = null;
let activeCourseCollapsed = false; // true = active course is visually folded
export let allCourses = [];
export let allSections = [];
export let allLessons = [];
export let currentLesson = null;
export let completedLessonIds = new Set();

export async function fetchCourses() {
  if (!currentUser) renderCourseSidebar(null);

  try {
    // 1. Fetch User Profile for Active Course ID
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_course_id')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    activeCourseId = profile?.current_course_id;

    // 2. Fetch User's Enrolled Courses AND Completed Lessons
    const [enrollRes, progressRes] = await Promise.all([
      supabase.from('user_courses').select('course_id, is_archived').eq('user_id', currentUser.id),
      supabase.from('user_lesson_progress').select('lesson_id').eq('user_id', currentUser.id)
    ]);

    const enrolledIds = new Set(enrollRes.data?.filter(e => !e.is_archived).map(e => e.course_id) || []);
    const archivedIds = new Set(enrollRes.data?.filter(e => e.is_archived).map(e => e.course_id) || []);
    completedLessonIds = new Set(progressRes.data?.map(p => p.lesson_id) || []);

    // 3. Fetch ALL courses (we filter in memory or complicated query)
    const { data: allCoursesData, error } = await supabase
      .from('courses')
      .select(`
        id, title, description, owner_id, is_published,
        sections (
          id, title, order_index, is_published,
          lessons (
            id, title, description, video_url, pattern_json, pattern_name, order_index, section_id
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Filter: User Owns (Creator) OR User Enrolled
    // AND: Must be Published, UNLESS User is Owner+Admin
    const isAdmin = isAdminUser(currentUser);

    const myCourses = allCoursesData.filter(c => {
      const isOwner = c.owner_id === currentUser.id;
      const isEnrolled = enrolledIds.has(c.id);
      const isArchived = archivedIds.has(c.id);
      const canView = c.is_published || (isOwner && isAdmin);

      // Owners can always see their own courses (not archived);  enrolled must not be archived
      return (isOwner || isEnrolled) && canView && !isArchived;
    });

    allCourses = myCourses;

    allSections = myCourses.flatMap(c => {
      const isOwner = c.owner_id === currentUser?.id;
      return c.sections
        .filter(s => s.is_published || isAdmin || isOwner)
        .map(s => ({ ...s, courseTitle: c.title, courseId: c.id }));
    });

    allLessons = allSections.flatMap(s => s.lessons);

    renderCourseSidebar(myCourses);

  } catch (err) {
    console.error("Error fetching my courses:", err);
  }
}

// ── Course sidebar helpers ──────────────────────────────────────────────────

function courseStatusSVG(state) {
  if (state === 'complete') return `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" class="status-icon">
      <circle cx="10" cy="10" r="9" fill="#22c55e"/>
      <path d="M6 10.5l2.5 2.5 5.5-5.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  if (state === 'inprogress') return `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" class="status-icon">
      <circle cx="10" cy="10" r="9" fill="#e5e7eb" stroke="#d1d5db" stroke-width="1"/>
      <path d="M10 1A9 9 0 0 0 10 19Z" fill="#6b7280"/>
    </svg>`;
  return `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" class="status-icon">
      <circle cx="10" cy="10" r="9" stroke="#d1d5db" stroke-width="1.5"/>
    </svg>`;
}

function lessonCompleteSVG() {
  return `
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" class="lesson-check-icon">
      <circle cx="10" cy="10" r="9" fill="#22c55e"/>
      <path d="M6 10.5l2.5 2.5 5.5-5.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

function lessonTypeInfo(lesson) {
  if (lesson.video_url) return {
    icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
    label: 'Video'
  };
  if (lesson.pattern_json) return {
    icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
    label: 'Pattern'
  };
  return {
    icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    label: 'Reading'
  };
}

function courseState(course) {
  const all = course.sections.flatMap(s => s.lessons);
  if (all.length === 0) return 'empty';
  if (all.every(l => completedLessonIds.has(l.id))) return 'complete';
  if (all.some(l => completedLessonIds.has(l.id))) return 'inprogress';
  return 'empty';
}

function sectionState(section) {
  const ls = section.lessons;
  if (ls.length === 0) return 'empty';
  if (ls.every(l => completedLessonIds.has(l.id))) return 'complete';
  if (ls.some(l => completedLessonIds.has(l.id))) return 'inprogress';
  return 'empty';
}

// ── Render ─────────────────────────────────────────────────────────────────

export function renderCourseSidebar(courses) {

  const list = document.getElementById('courseList');
  const header = document.querySelector('#courseSidebar .sidebar-header');
  if (!list || !header) return;

  if (!currentUser) {
    list.innerHTML = `
      <div class="empty-courses">
        <!-- <h4>Not signed in.</h4> -->
        <h4>Please sign in to access courses.</h4>
        <button class="primary-btn" data-action="sign-in">Sign In</button>
      </div>
    `;

    // Clean header action
    if (header.querySelector('.browse-icon-btn')) {
      header.querySelector('.browse-icon-btn').remove();
    }
    return;
  }

  // 1. Setup Header Button
  // If no courses, show Empty State
  if (courses.length === 0) {
    list.innerHTML = `
      <div class="empty-courses">
        <h4>No courses yet</h4>
        <p>Browse the marketplace to start learning.</p>
        <button class="browse-big-btn" data-action="open-marketplace">Browse Course Marketplace</button>
      </div>
    `;
    // Clean header action
    if (header.querySelector('.browse-icon-btn')) {
      header.querySelector('.browse-icon-btn').remove();
    }
    return;
  }

  // If we have courses, ensure small Browse button exists in header
  if (!header.querySelector('.browse-icon-btn')) {
    const btn = document.createElement('button');
    btn.className = 'browse-icon-btn';
    btn.dataset.action = 'open-marketplace';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v8m-4-4h8"></path></svg> Marketplace`;

    // Insert before the close button so 'X' is always on the right
    const closeBtn = document.getElementById('closeSidebar');
    if (closeBtn) {
      header.insertBefore(btn, closeBtn);
    } else {
      header.appendChild(btn); // Fallback
    }
  }

  // 2. Sort: Active Course First
  // If no activeCourseId set, pick the first one
  if (!activeCourseId && courses.length > 0) {
    activeCourseId = courses[0].id;
    activeCourseCollapsed = false; // auto-picked courses start expanded
  }

  const sortedCourses = [...courses].sort((a, b) => {
    if (a.id === activeCourseId) return -1;
    if (b.id === activeCourseId) return 1;
    return 0;
  });

  // --- FLIP ANIMATION: PRE-CALCULATE ---
  const firstPositions = {};
  const currentItems = list.querySelectorAll('.course-item');
  currentItems.forEach(item => {
    const id = item.getAttribute('data-id');
    if (id) firstPositions[id] = item.getBoundingClientRect().top;
  });

  // 3. Progress bar — scoped to the active course
  const activeCourse = courses.find(c => c.id === activeCourseId);
  const activeLessons = activeCourse ? activeCourse.sections.flatMap(s => s.lessons) : [];
  const pct = activeLessons.length > 0
    ? Math.round(activeLessons.filter(l => completedLessonIds.has(l.id)).length / activeLessons.length * 100)
    : 0;
  const progressHtml = `
    <div class="course-progress">
      <span class="course-progress-label"><strong>${pct}%</strong> Completed</span>
      <div class="course-progress-bar"><div class="course-progress-fill" style="width:${pct}%"></div></div>
    </div>`;

  // 4. Render
  const chevronDown = `<svg class="course-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  const chevronRight = `<svg class="course-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

  list.innerHTML = progressHtml + sortedCourses.map(course => {
    const isActive = course.id === activeCourseId && !activeCourseCollapsed;

    if (isActive) {
      // === EXPANDED (ACTIVE) ===
      const isAdmin = isAdminUser(currentUser);
      const isOwner = course.owner_id === currentUser?.id;

      const sectionsHtml = course.sections
        .filter(s => s.is_published || isAdmin || isOwner)
        .sort((a, b) => a.order_index - b.order_index)
        .map(section => {
          const state = sectionState(section);
          const draftBadge = !section.is_published ? '<span class="draft-badge">Draft</span>' : '';
          const lessonsHtml = section.lessons
            .sort((a, b) => a.order_index - b.order_index)
            .map(lesson => {
              const isComplete = completedLessonIds.has(lesson.id);
              const { icon, label } = lessonTypeInfo(lesson);
              const leftIcon = isComplete
                ? lessonCompleteSVG()
                : `<span class="lesson-type-icon">${icon}</span>`;
              return `
                <div class="lesson-link" data-action="load-lesson" data-id="${lesson.id}">
                  ${leftIcon}
                  <div class="lesson-text">
                    <span class="lesson-title">${lesson.title}</span>
                    <span class="lesson-meta">${label}</span>
                  </div>
                </div>`;
            }).join('');

          return `
            <div class="course-section">
              <div class="section-header">
                ${courseStatusSVG(state)}
                <span class="section-header-title">${section.title}${draftBadge}</span>
              </div>
              <div class="lesson-list">${lessonsHtml}</div>
            </div>`;
        }).join('');

      const editBtn = isAdmin ? `
        <button class="edit-course secondary-btn" data-action="edit-course" data-id="${course.id}" title="Edit Course" style="background:none;border:none;cursor:pointer;padding:4px;display:flex;align-items:center;color:#9ca3af;">
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/></path></svg>
        </button>` : '';

      return `
        <div class="course-item active" data-id="${course.id}">
          <div class="course-header" data-action="toggle-course" data-id="${course.id}">
            <h4>${course.title}</h4>
            ${editBtn}
            ${chevronDown}
          </div>
          <div class="course-body">${sectionsHtml}</div>
        </div>`;

    } else {
      // === COLLAPSED (INACTIVE) ===
      const state = courseState(course);
      return `
        <div class="course-item collapsed" data-id="${course.id}">
          <div class="course-header" data-action="toggle-course" data-id="${course.id}">
            ${courseStatusSVG(state)}
            <h4>${course.title}</h4>
            ${chevronRight}
          </div>
        </div>`;
    }
  }).join('');

  // --- FLIP ANIMATION: PLAY ---
  const newItems = list.querySelectorAll('.course-item');
  newItems.forEach(item => {
    const id = item.getAttribute('data-id');
    const oldTop = firstPositions[id];

    if (oldTop !== undefined) {
      const newTop = item.getBoundingClientRect().top;
      const delta = oldTop - newTop;

      if (Math.abs(delta) > 0) {
        // Invert: fake position to be where it was
        item.style.transform = `translateY(${delta}px)`;
        item.style.transition = 'none';

        // Play: slide to new position
        requestAnimationFrame(() => {
          // Force layout
          item.getBoundingClientRect();
          item.style.transition = 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
          item.style.transform = '';
        });
      }
    } else {
      // Item is new (e.g. just unlocked), maybe fade it in?
      item.style.opacity = '0';
      item.style.transform = 'translateY(10px)';
      requestAnimationFrame(() => {
        item.style.transition = 'all 0.4s ease';
        item.style.opacity = '1';
        item.style.transform = '';
      });
    }
  });

  // Re-apply admin UI because we just injected new admin-only elements
  updateAdminUI();
}

export async function setActiveCourse(courseId) {
  activeCourseId = courseId;
  activeCourseCollapsed = false; // always expand when switching courses

  // Optimistic Render
  renderCourseSidebar(allCourses);

  // Persist
  if (currentUser) {
    await supabase
      .from('profiles')
      .update({ current_course_id: courseId })
      .eq('user_id', currentUser.id);
  }
}

export async function loadLesson(lessonId) {
  try {
    if (hasUnsavedChanges()) {
      if (!await confirm('You have unsaved changes. Discard them?')) return;
    }

    const lesson = allLessons.find(l => l.id === lessonId);
    if (!lesson) {
      await alert(`Lesson unavailable. Please try again or return to the course.`);
      return;
    }
    currentLesson = lesson;

    // 1. Apply the groove to the grid
    if (lesson.pattern_json) {
      await applyPattern(lesson.pattern_json);
      updateCurrentPhraseName(lesson.title || 'Lesson');
      // Update last saved state to prevent false dirty check
      snapshotCurrentState();
    }

    // 2. Show UI info
    const player = document.getElementById('lessonPlayer');
    if (!player) return;

    // Force visible as a sidebar
    openLessonSidebar();

    // Add active lesson style to lesson-link
    const lessonLink = document.querySelector(`.lesson-link[data-id="${lessonId}"]`);
    if (lessonLink) {
      lessonLink.classList.add('active-lesson');
    }

    // Remove active lesson style from other lesson-links
    const otherLessonLinks = document.querySelectorAll('.lesson-link:not([data-id="' + lessonId + '"])');
    otherLessonLinks.forEach(link => {
      link.classList.remove('active-lesson');
    });

    const section = allSections.find(s => s.id === lesson.section_id);
    const sectionTitle = section ? section.title : 'Unknown Section';

    // Also update the separate section header if it exists (for layout flexibility)
    const secTitleEl = document.getElementById('activeSectionTitle');
    const courseTitle = section ? section.courseTitle : 'Unknown Course';
    const courseId = section ? section.courseId : null;

    if (secTitleEl) {
      secTitleEl.innerHTML = `<span class="clickable-nav-title" data-action="open-sidebar-course" data-course-id="${courseId}" title="Open course sidebar">← ${courseTitle} • ${sectionTitle}</span>`;
    }

    const titleEl = document.getElementById('activeLessonTitle');
    if (titleEl) {
      // Format: "▲ Lesson Title • Section Title"
      titleEl.textContent = `▲ ${lesson.title}`;
    }

    // Inject Practice Button into Header
    const header = titleEl?.parentElement;
    if (header) {
      if (!header.classList.contains('lesson-header')) header.classList.add('lesson-header');

      let btnGroup = document.getElementById('lessonBtnGroup');
      if (!btnGroup) {
        btnGroup = document.createElement('div');
        btnGroup.id = 'lessonBtnGroup';
        btnGroup.className = 'lesson-btn-group';
        header.appendChild(btnGroup);
      }

      let pBtn = document.getElementById('addPracticeBtn');
      if (!pBtn) {
        pBtn = document.createElement('button');
        pBtn.id = 'addPracticeBtn';
        pBtn.className = 'practice-btn';
        btnGroup.appendChild(pBtn);
      }

      // Set Initial State
      const updateBtnState = () => {
        const isAdded = isItemInPractice('lesson', lesson.id);
        pBtn.innerHTML = isAdded ? '⛔️ Remove' : '➕ Add to Plan';
        pBtn.dataset.action = "toggle-practice";
        pBtn.dataset.lessonId = lesson.id;
        pBtn.dataset.lessonTitle = lesson.title;

        if (isAdded) {
          pBtn.style.borderColor = 'rgba(255,0,0,0.2)';
          pBtn.style.backgroundColor = 'rgba(255,0,0,0.02)';
        } else {
          pBtn.style.borderColor = 'var(--panel-border)';
          pBtn.style.backgroundColor = 'transparent';
        }
      };
      updateBtnState();

      // == ADMIN ONLY: Update Lesson from Grid Button ==
      if (isAdminUser(currentUser)) {
        let uBtn = document.getElementById('updateLessonBtn');
        if (!uBtn) {
          uBtn = document.createElement('button');
          uBtn.id = 'updateLessonBtn';
          uBtn.className = 'practice-btn';
          uBtn.style.color = "#8b5cf6";
          uBtn.style.borderColor = "rgba(139, 92, 246, 0.3)";
          btnGroup.appendChild(uBtn);
        }
        uBtn.innerHTML = '✏️ Update Lesson';
        uBtn.dataset.action = "update-lesson-grid";
        uBtn.dataset.lessonId = lesson.id;
      } else {
        document.getElementById('updateLessonBtn')?.remove();
      }
    }

    const descEl = document.getElementById('lessonDescription');
    if (descEl) {
      const rawDesc = lesson.description || '';

      // Ensure we have an edit textarea available
      let editArea = document.getElementById('editLessonDescription');
      if (!editArea) {
        editArea = document.createElement('textarea');
        editArea.id = 'editLessonDescription';
        editArea.style.width = '100%';
        editArea.style.minHeight = '150px';
        editArea.style.padding = '12px';
        editArea.style.borderRadius = '8px';
        editArea.style.border = '1px dashed var(--accent-glow)';
        editArea.style.background = 'rgba(0,0,0,0.1)';
        editArea.style.color = 'var(--text)';
        editArea.style.fontFamily = 'inherit';
        editArea.style.fontSize = '15px';
        editArea.style.resize = 'vertical';
        descEl.parentNode.insertBefore(editArea, descEl.nextSibling);
      }

      // Toggle edit mode vs view mode based on admin status
      if (isAdminUser(currentUser)) {
        descEl.style.display = 'none';
        editArea.style.display = 'block';
        editArea.value = rawDesc;
      } else {
        editArea.style.display = 'none';
        descEl.style.display = 'block';
        descEl.setAttribute('contenteditable', 'false');

        // Render Glossary Links and preserve newlines for students!
        let formattedDesc = rawDesc;
        if (typeof autoLinkText === 'function') {
          formattedDesc = autoLinkText(formattedDesc);
        }
        descEl.innerHTML = formattedDesc.replace(/\n/g, '<br>');
      }
    }

    const lessonContentEl = document.getElementsByClassName('lesson-content')[0];
    if (lessonContentEl) lessonContentEl.style.display = 'block';

    // Pattern preview
    const videoContainer = document.getElementById('videoContainer');
    let previewCanvas = document.getElementById('lessonPatternPreview');
    if (lesson.pattern_name && lesson.pattern_json?.labels?.length > 0) {
      if (!previewCanvas) {
        previewCanvas = document.createElement('canvas');
        previewCanvas.id = 'lessonPatternPreview';
        previewCanvas.width = 320;
        previewCanvas.height = 180;
        previewCanvas.className = 'lesson-pattern-preview';

        if (window.innerWidth < 768) {
          const openInStudio = () => {
            closeSidebar();
            if (window.location.hash !== '#studio' && window.location.hash !== '') {
              window.location.hash = '#studio';
            }
          };
          previewCanvas.addEventListener('click', openInStudio);

          const previewHint = document.createElement('p');
          previewHint.id = 'lessonPatternHint';
          previewHint.className = 'lesson-pattern-hint';
          previewHint.addEventListener('click', openInStudio);
          previewHint.textContent = 'Tap to open in studio';
          videoContainer?.after(previewHint);
        }

        videoContainer?.after(previewCanvas);
      }
      requestAnimationFrame(() => renderThumbnail(previewCanvas, lesson.pattern_json));
    } else {
      previewCanvas?.remove();
      document.getElementById('lessonPatternHint')?.remove();
    }

    // Completion Button
    const btn = document.getElementById('lessonCompleteBtn');
    const isComplete = completedLessonIds.has(lesson.id);

    if (btn) {
      btn.textContent = isComplete ? '✅ Completed' : 'Mark as Complete';
      btn.dataset.action = "toggle-completion";
      btn.dataset.lessonId = lesson.id;
      btn.style.display = 'inline-flex';
    }

    // Navigation Logic (Prev / Next)
    const nextBtn = document.getElementById('nextLessonBtn');
    const prevBtn = document.getElementById('prevLessonBtn');

    if (nextBtn || prevBtn) {
      // Find the course this lesson belongs to
      const course = allCourses.find(c => c.sections.some(s => s.lessons.some(l => l.id === lessonId)));

      let nextLesson = null;
      let prevLesson = null;

      if (course) {
        // Flatten lessons for THIS course only (respecting section draft rules)
        const isAdmin = isAdminUser(currentUser);
        const isOwner = course.owner_id === currentUser?.id;

        const courseLessons = course.sections
          .filter(s => s.is_published || isAdmin || isOwner)
          .sort((a, b) => a.order_index - b.order_index)
          .flatMap(s => s.lessons.sort((l1, l2) => l1.order_index - l2.order_index));

        const idx = courseLessons.findIndex(l => l.id === lessonId);

        if (idx !== -1) {
          if (idx < courseLessons.length - 1) nextLesson = courseLessons[idx + 1];
          if (idx > 0) prevLesson = courseLessons[idx - 1];
        }
      }

      // NEXT BUTTON
      if (nextBtn) {
        if (nextLesson) {
          nextBtn.style.display = 'inline-flex';
          nextBtn.dataset.action = 'load-lesson';
          nextBtn.dataset.id = nextLesson.id;
          nextBtn.title = `Next: ${nextLesson.title}`;

          // Visual cue : Faded if current lesson not complete
          if (completedLessonIds.has(lesson.id)) {
            nextBtn.classList.remove('faded');
          } else {
            nextBtn.classList.add('faded');
          }
        } else {
          nextBtn.style.display = 'none';
        }
      }

      // PREV BUTTON
      if (prevBtn) {
        if (prevLesson) {
          prevBtn.style.display = 'inline-flex';
          prevBtn.dataset.action = 'load-lesson';
          prevBtn.dataset.id = prevLesson.id;
          prevBtn.title = `Previous: ${prevLesson.title}`;
        } else {
          prevBtn.style.display = 'none';
        }
      }
    }

    // 3. Handle Video
    const videoCont = document.getElementById('videoContainer');
    if (videoCont) {
      if (lesson.video_url) {
        const videoId = extractYouTubeId(lesson.video_url);
        if (videoId) {
          videoCont.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?rel=0" frameborder="0" allowfullscreen></iframe>`;
        } else {
          // Direct URL (Supabase storage or other)
          videoCont.innerHTML = `<video src="${lesson.video_url}" controls playsinline style="width: 100%; border-radius: 8px;"></video>`;
        }
        videoCont.style.display = 'block';
      } else {
        videoCont.style.display = 'none';
      }
    }

  } catch (err) {
    console.error("loadLesson Error:", err);
    await alert("Error loading lesson: " + err.message);
  }
}

export async function editCourse(courseId) {
  const course = allCourses.find(c => c.id === courseId);
  if (!course) return;
  loadCourseToEdit(course);
  if (window.innerWidth < 768) closeSidebar();
}

export function closeSidebar(options = {}) {
  Sidepanel.closeAll();

  // Emit event so other systems (like Coaching Mode) can respond
  Bus.emit(BUS_EVENT.SIDEBAR_CLOSE_ALL, {
    reason: options.reason || 'generic',
    source: options.source || 'courses'
  });

  updateBodySidebarClass();
}

export function openLessonSidebar() {
  setLastSidebarType('lesson');
  closeSidebar({ reason: 'lesson-player', source: 'courses' }); // mutually exclusive
  lessonSidePanel.open();
  updateBodySidebarClass();
}

export function closeLessonSidebar() {
  lessonSidePanel.close();
}

export function openSidebar() {
  setLastSidebarType('course');
  closeSidebar({ reason: 'course-list', source: 'courses' }); // mutually exclusive
  if (!courseSidePanel.isOpen) {
    courseSidePanel.open();
    if (allCourses.length === 0) fetchCourses();
  }
  updateBodySidebarClass();
}

export function toggleSidebar() {
  if (courseSidePanel.isOpen) {
    closeSidebar();
  } else {
    // Note: openSidebar already calls closeSidebar
    openSidebar();
  }
}

export async function toggleLessonCompletion(lessonId) {
  if (!currentUser) {
    await alert("Please sign in to track progress.");
    return;
  }

  const isComplete = completedLessonIds.has(lessonId);

  if (isComplete) {
    const { error } = await supabase
      .from('user_lesson_progress')
      .delete()
      .eq('lesson_id', lessonId)
      .eq('user_id', currentUser.id);

    if (!error) completedLessonIds.delete(lessonId);
  } else {
    const { error } = await supabase
      .from('user_lesson_progress')
      .insert({ user_id: currentUser.id, lesson_id: lessonId });

    if (!error) {
      completedLessonIds.add(lessonId);

      // Check for Course Completion
      const course = allCourses.find(c => c.sections.some(s => s.lessons.some(l => l.id === lessonId)));
      if (course) {
        const courseLessonIds = course.sections.flatMap(s => s.lessons).map(l => l.id);
        const allComplete = courseLessonIds.every(id => completedLessonIds.has(id));
        if (allComplete) {
          triggerCourseCompletionCelebration(course.title);
        }
      }
    }
  }

  // Refresh UI
  renderCourseSidebar(allCourses);

  // Also update current button if viewing that lesson
  const btn = document.getElementById('lessonCompleteBtn');
  const nextBtn = document.getElementById('nextLessonBtn');

  if (btn) {
    const newState = completedLessonIds.has(lessonId);
    btn.textContent = newState ? '✅ Completed' : 'Mark as Complete';

    if (nextBtn) {
      if (newState) nextBtn.classList.remove('faded');
      else nextBtn.classList.add('faded');
    }
  }
}

function triggerCourseCompletionCelebration(courseTitle) {
  let overlay = document.getElementById('celebrationOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'celebrationOverlay';
    overlay.style.cssText = `
            position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 9999;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.5s ease; color: white; text-align: center;
        `;
    overlay.innerHTML = `
            <div style="transform: scale(0.8); animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;">
                <h1 style="font-size: 3rem; margin-bottom: 20px;">🎉 Course Completed! 🎉</h1>
                <h2 id="celCourseTitle" style="font-size: 2rem; color: #ffd166; margin-bottom: 40px;"></h2>
                <div style="font-size: 4rem; margin-bottom: 30px;">🏆</div>
                <button class="primary-btn" style="font-size:1.2rem; padding: 12px 32px;" data-action="dismiss-celebration">Continue</button>
            </div>
            <style>
                @keyframes popIn { to { transform: scale(1); } }
            </style>
        `;
    document.body.appendChild(overlay);
  }

  document.getElementById('celCourseTitle').textContent = courseTitle;
  requestAnimationFrame(() => overlay.style.opacity = '1');
}

export async function updateLessonFromGrid(lessonId) {
  const lesson = allLessons.find(l => l.id === lessonId);
  if (!lesson) {
    await alert("Lesson not found.");
    return;
  }

  if (!await confirm(`Are you sure you want to update the pattern for "${lesson.title}" with the current grid?`)) {
    return;
  }

  const newName = await prompt("Pattern name (saves to library and lesson):", lesson.pattern_name || lesson.title);
  if (newName === null) return; // Cancelled
  const trimmedName = newName.trim();
  if (!trimmedName) {
    await alert("Name cannot be empty.");
    return;
  }

  try {
    const pattern_json = serializePattern();
    const editArea = document.getElementById('editLessonDescription');
    const newDescription = editArea ? editArea.value : (lesson.description || '');

    // 1. Save to User Pattern Library
    if (typeof dbSavePattern === 'function') {
      await dbSavePattern(trimmedName, pattern_json);
      // 1b. Refresh main pattern dropdown
      if (typeof refreshPatternSelect === 'function') {
        await refreshPatternSelect(trimmedName);
      }
    } else {
      console.warn("dbSavePattern not found, skipping library save");
    }

    // 2. Update Lesson in Supabase (Pattern + Description)
    const { error } = await supabase
      .from('lessons')
      .update({
        pattern_json: pattern_json,
        pattern_name: trimmedName,
        description: newDescription
      })
      .eq('id', lessonId);

    if (error) throw error;

    // 3. Update local state
    lesson.pattern_json = pattern_json;
    lesson.pattern_name = trimmedName;
    lesson.description = newDescription;

    // Visual Feedback
    const uBtn = document.getElementById('updateLessonBtn');
    if (uBtn) {
      const originalText = uBtn.innerHTML;
      uBtn.innerHTML = '✅ Updated!';
      setTimeout(() => uBtn.innerHTML = originalText, 2000);
    }

    // sync lastSavedState to avoid "unsaved changes" warnings
    snapshotCurrentState();

    console.log(`Lesson ${lessonId} and Pattern "${trimmedName}" updated successfully.`);
  } catch (err) {
    console.error("Failed to update lesson/pattern:", err);
    await alert("Error updating: " + err.message);
  }
}

// ==== EVENT DELEGATION ====

document.body.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id; // generic ID

  switch (action) {
    case 'sign-in':
      openAuthModal();
      break;
    case 'open-marketplace':
      openMarketplace();
      break;
    case 'edit-course':
      if (id) editCourse(id);
      break;
    case 'load-lesson':
      if (id) {
        if (typeof stop === 'function') stop(); // ensure we stop playback
        loadLesson(id);
      }
      break;
    case 'set-active-course':
      const cid = target.dataset.courseId || target.dataset.id;
      if (cid) setActiveCourse(cid);
      break;
    case 'toggle-course':
      const toggleId = target.dataset.id;
      if (toggleId) {
        if (activeCourseId === toggleId) {
          // Toggle collapsed state of already-active course
          activeCourseCollapsed = !activeCourseCollapsed;
          renderCourseSidebar(allCourses);
        } else {
          // Switch to a different course (always expand it)
          activeCourseCollapsed = false;
          setActiveCourse(toggleId);
        }
      }
      break;
    case 'toggle-completion':
      const lid = target.dataset.lessonId;
      if (lid) toggleLessonCompletion(lid);
      break;
    case 'update-lesson-grid':
      const updateLid = target.dataset.lessonId;
      if (updateLid) updateLessonFromGrid(updateLid);
      break;
    case 'open-sidebar-course':
      closeLessonSidebar();
      openSidebar();
      break;
    case 'toggle-practice':
      const pLid = target.dataset.lessonId;
      const pTitle = target.dataset.lessonTitle;
      if (pLid) {
        e.stopPropagation();
        await togglePracticeItem('lesson', pLid, pTitle);
        const pBtn = document.getElementById('addPracticeBtn');
        if (pBtn) {
          const isAdded = isItemInPractice('lesson', pLid);
          pBtn.innerHTML = isAdded ? '⛔️ Remove' : '➕ Add to Plan';
          if (isAdded) {
            pBtn.style.borderColor = 'rgba(255,0,0,0.2)';
            pBtn.style.backgroundColor = 'rgba(255,0,0,0.02)';
          } else {
            pBtn.style.borderColor = 'var(--panel-border)';
            pBtn.style.backgroundColor = 'transparent';
          }
        }
      }
      break;
    case 'toggle-sidebar':
      e.stopPropagation();
      closePracticeSidebar();
      toggleSidebar();
      break;
    case 'toggle-last-sidebar':
      e.stopPropagation();
      closePracticeSidebar();
      toggleLastSidebar();
      break;
    case 'dismiss-celebration':
      const overlay = document.getElementById('celebrationOverlay');
      if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);
      }
      break;
  }
});

// Sidepanel instances — onClose calls updateBodySidebarClass for ESC/auto-close
const courseSidePanel = new Sidepanel(document.getElementById('courseSidebar'), { onClose: updateBodySidebarClass });
const lessonSidePanel = new Sidepanel(document.getElementById('lessonPlayer'), { onClose: updateBodySidebarClass });

// Register openers so toggleLastSidebar can reopen the correct panel.
// The lesson opener falls back to the course list if no lesson is loaded.
registerPanelOpener('course', openSidebar);
registerPanelOpener('lesson', () => currentLesson ? openLessonSidebar() : openSidebar());

// Sidebar Toggles (Existing ID-based, can stay or move to delegation)

const sidebarCloseBtn = document.getElementById('closeSidebar');
if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);

const activeLessonHeader = document.getElementById('lessonHeader');
if (activeLessonHeader) {
  activeLessonHeader.addEventListener('click', () => {
    const lessonContent = document.getElementById('lessonContent');
    const titleEl = document.getElementById('activeLessonTitle');
    if (!lessonContent) return;

    if (lessonContent.style.display === 'none') {
      lessonContent.style.display = 'block';
      if (titleEl) titleEl.textContent = '▲ ' + titleEl.textContent.replace('▼ ', '');
    } else {
      lessonContent.style.display = 'none';
      if (titleEl) titleEl.textContent = '▼ ' + titleEl.textContent.replace('▲ ', '');
    }
  });
}

const closeLessonBtn = document.getElementById('closeLessonBtn');
if (closeLessonBtn) {
  closeLessonBtn.addEventListener('click', closeLessonSidebar);
}

// const lessonCoursesBtn = document.getElementById('lessonCoursesBtn');
// if (lessonCoursesBtn) {
//   lessonCoursesBtn.addEventListener('click', () => {
//     closeLessonSidebar();
//     openSidebar();
//   });
// }

// Cross-module Events
Bus.on(BUS_EVENT.COURSE_DATA_CHANGED, () => {
  fetchCourses();
});

Bus.on(BUS_EVENT.REQUEST_LOAD_LESSON, (e) => {
  if (e.detail && e.detail.lessonId) {
    if (allLessons.length === 0) {
      fetchCourses().then(() => {
        loadLesson(e.detail.lessonId);
      });
    } else {
      loadLesson(e.detail.lessonId);
    }
  }
});

export function initCourses() {
  const closeBtn = document.getElementById('closeSidebarBtn');
  closeBtn?.addEventListener('click', closeSidebar);

  const refreshBtn = document.getElementById('refreshCoursesBtn');
  refreshBtn?.addEventListener('click', fetchCourses);

  const openMarketBtn = document.getElementById('openMarketBtn');
  openMarketBtn?.addEventListener('click', () => {
    openMarketplace();
  });

  const searchInput = document.getElementById('courseSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      const lessonLinks = document.querySelectorAll('.lesson-link');
      lessonLinks.forEach(link => {
        const text = link.textContent.toLowerCase();
        link.style.display = text.includes(term) ? 'flex' : 'none';
      });
    });
  }

  // BUS LISTENERS
  Bus.on(BUS_EVENT.AUTH_LOGOUT, () => {
    activeCourseId = null;
    currentLesson = null;
    allCourses = [];
    allSections = [];
    allLessons = [];
    closeSidebar();
    const list = document.getElementById('courseList');
    if (list) list.innerHTML = '<p class="empty-state">Sign in to view your courses.</p>';
  });

  Bus.on(BUS_EVENT.AUTH_LOGIN, () => {
    fetchCourses();
  });

  Bus.on(BUS_EVENT.COURSE_UNLOCKED, async (e) => {
    const courseId = e.detail?.courseId;
    // Eagerly set the target course and open sidebar before the network fetch
    // so the user sees the response immediately.
    if (courseId) {
      activeCourseId = courseId;
      closeSidebar();
      openSidebar();
    }
    await fetchCourses();
    // fetchCourses overwrites activeCourseId from the profile — restore it.
    if (courseId) {
      activeCourseId = courseId;
      renderCourseSidebar(allCourses);
      // Persist without waiting
      if (currentUser) {
        supabase.from('profiles').update({ current_course_id: courseId }).eq('user_id', currentUser.id);
      }
    }
  });

  Bus.on(BUS_EVENT.OPEN_COURSE, (e) => {
    if (e.detail?.courseId) {
      setActiveCourse(e.detail.courseId);
      openSidebar();
    }
  });
}