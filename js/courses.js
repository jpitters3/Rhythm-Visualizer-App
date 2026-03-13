import { Bus, BUS_EVENT } from './bus.js';
import { currentUser, isAdminUser } from './state.js';
import { applyPattern, serializePattern, dbSavePattern, refreshPatternSelect, hasUnsavedChanges, snapshotCurrentState } from './pattern-crud.js';
import { stop } from './noteplayer.js';
import { supabase } from './supabase-client.js';
import { updateAdminUI } from './auth.js';
import { isItemInPractice, togglePracticeItem } from './practice.js';
import { loadCourseToEdit } from './course-creator.js';
import { openMarketplace } from './course-marketplace.js';
import { autoLinkText } from './glossary.js';

// ===== SIDEBAR LOGIC (OWNED COURSES) =====

let activeCourseId = null;
export let allCourses = [];
export let allSections = [];
export let allLessons = [];
export let currentLesson = null;
export let completedLessonIds = new Set();

export async function fetchCourses() {
  if (!currentUser) return;

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
      supabase.from('user_courses').select('course_id').eq('user_id', currentUser.id),
      supabase.from('user_lesson_progress').select('lesson_id').eq('user_id', currentUser.id)
    ]);

    const enrolledIds = new Set(enrollRes.data?.map(e => e.course_id) || []);
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
      const canView = c.is_published || (isOwner && isAdmin);

      return (isOwner || isEnrolled) && canView;
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

export function renderCourseSidebar(courses) {
  const list = document.getElementById('courseList');
  const header = document.querySelector('.sidebar-header');
  if (!list || !header) return;

  // 1. Setup Header Button
  // If no courses, show Empty State
  if (courses.length === 0) {
    list.innerHTML = `
      <div class="empty-courses">
        <h4>No courses yet</h4>
        <p>Browse the marketplace to start learning.</p>
        <button class="browse-big-btn" data-action="open-marketplace">Browse Courses</button>
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

  // 3. Render
  list.innerHTML = sortedCourses.map(course => {
    const isActive = course.id === activeCourseId;

    if (isActive) {
      // === EXPANDED (ACTIVE) ===
      let adminActions = '';
      if (isAdminUser(currentUser)) {
        adminActions = `
          <div class="lesson-admin-actions" style="display:flex; gap:10px; margin-top:10px;">
          </div>
        `;
      }

      return `
        <div class="course-item active" data-id="${course.id}">
          <div class="course-header" style="justify-content: flex-start; gap: 8px;">
            <button class="toggle-course-btn" data-action="toggle-course" data-id="${course.id}" style="background: none; border: none; cursor: pointer; padding: 0; display: flex; align-items: center; color: currentColor;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(90deg); transition: transform 0.2s;"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
            <h4 style="margin: 0; flex-grow: 1;">${course.title}</h4>
            ${(isAdminUser(currentUser)) ? `<div class="edit-course" data-action="edit-course" data-id="${course.id}" title="Edit Course">
               <svg width="16px" height="16px" style="pointer-events: none;" fill="currentColor" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/></svg>
             </div>` : ''}
          </div>
          <div class="course-body">
            ${course.sections
          .filter(s => {
            const isAdmin = isAdminUser(currentUser);
            const isOwner = course.owner_id === currentUser?.id;
            return s.is_published || isAdmin || isOwner;
          })
          .sort((a, b) => a.order_index - b.order_index).map(section => `
              <div class="section-title" style="${!section.is_published ? 'opacity: 0.8; font-style: italic;' : ''}">
                ${section.title} ${!section.is_published ? '(Draft)' : ''}
              </div>
              ${section.lessons.sort((a, b) => a.order_index - b.order_index).map(lesson => {
            const isComplete = completedLessonIds.has(lesson.id);
            return `
                <div class="lesson-link" data-action="load-lesson" data-id="${lesson.id}">
                  ${isComplete
                ? '<span style="color:#4CAF50; margin-right:6px; font-weight:bold;">✓</span>'
                : '<span style="opacity:0.6; margin-right:6px;">•</span>'}
                  ${lesson.title}
                </div>
              `}).join('')}
            `).join('')}
            ${adminActions}
          </div>
        </div>
      `;
    } else {
      // === COLLAPSED (INACTIVE) ===
      return `
        <div class="course-item collapsed" data-id="${course.id}" >
          <div class="course-header" style="justify-content: flex-start; gap: 8px; cursor: pointer;" data-action="toggle-course" data-id="${course.id}">
            <button class="toggle-course-btn" style="background: none; border: none; cursor: pointer; padding: 0; display: flex; align-items: center; color: currentColor; pointer-events: none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s;"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
            <h4 style="margin: 0; flex-grow: 1;">${course.title}</h4>
            <span class="collapsed-hint">Click to expand</span>
          </div>
        </div>
      `;
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
  if (activeCourseId === courseId) return;

  activeCourseId = courseId;

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

export function loadLesson(lessonId) {
  try {
    // Check unsaved changes
    if (hasUnsavedChanges()) {
      if (!confirm('You have unsaved changes. Discard them?')) return;
    }

    const lesson = allLessons.find(l => l.id === lessonId);
    if (!lesson) {
      alert(`DEBUG ERROR: Lesson not found! ID: ${lessonId}. Total lessons loaded: ${allLessons.length}`);
      return;
    }
    currentLesson = lesson;

    // 1. Apply the groove to the grid
    if (lesson.pattern_json) {
      applyPattern(lesson.pattern_json);
      // Update last saved state to prevent false dirty check
      snapshotCurrentState();
    }

    // 2. Show UI info
    const player = document.getElementById('lessonPlayer');
    if (!player) return;

    // Force visible
    player.style.display = 'block';

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
      secTitleEl.innerHTML = `<span class="clickable-nav-title" data-action="open-sidebar-course" data-course-id="${courseId}" title="Open course sidebar">${courseTitle} • ${sectionTitle}</span>`;
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

      let pBtn = document.getElementById('addPracticeBtn');
      if (!pBtn) {
        pBtn = document.createElement('button');
        pBtn.id = 'addPracticeBtn';
        pBtn.className = 'practice-btn';
        header.appendChild(pBtn);
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
          uBtn.className = 'practice-btn'; // Use same styling
          uBtn.style.marginLeft = "8px";
          uBtn.style.color = "#8b5cf6"; // Purplish tint
          uBtn.style.borderColor = "rgba(139, 92, 246, 0.3)";
          header.appendChild(uBtn);
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
          videoCont.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?rel=0" frameborder="0" allowfullscreen></iframe>`;
        } else {
          // Direct URL (Supabase storage or other)
          videoCont.innerHTML = `<video src="${lesson.video_url}" controls playsinline style="width: 100%; border-radius: 8px;"></video>`;
        }
        videoCont.style.display = 'block';
      } else {
        videoCont.style.display = 'none';
      }
    }

    // On Mobile, maybe close sidebar? On desktop, keep open?
    if (window.innerWidth < 768) closeSidebar();

  } catch (err) {
    console.error("loadLesson Error:", err);
    alert("Error loading lesson: " + err.message);
  }
}

export async function editCourse(courseId) {
  const course = allCourses.find(c => c.id === courseId);
  if (!course) return;
  loadCourseToEdit(course);
  if (window.innerWidth < 768) closeSidebar();
}

export function closeSidebar() {
  const sb = document.getElementById('courseSidebar');
  if (sb) {
    sb.classList.remove('open');
    sb.setAttribute('aria-hidden', 'true');
  }
}

export function openSidebar() {
  const sb = document.getElementById('courseSidebar');
  if (sb && !sb.classList.contains('open')) {
    sb.classList.add('open');
    sb.removeAttribute('aria-hidden');
    if (allCourses.length === 0) fetchCourses();
  }
}

function extractYouTubeId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}


export async function toggleLessonCompletion(lessonId) {
  if (!currentUser) {
    alert("Please sign in to track progress.");
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
    alert("Lesson not found.");
    return;
  }

  if (!confirm(`Are you sure you want to update the pattern for "${lesson.title}" with the current grid?`)) {
    return;
  }

  const newName = prompt("Pattern name (saves to library and lesson):", lesson.pattern_name || lesson.title);
  if (newName === null) return; // Cancelled
  const trimmedName = newName.trim();
  if (!trimmedName) {
    alert("Name cannot be empty.");
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
    alert("Error updating: " + err.message);
  }
}

// ==== EVENT DELEGATION ====

document.body.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id; // generic ID

  switch (action) {
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
          // Collapse if currently active
          setActiveCourse(null);
        } else {
          // Expand
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
      const sideCid = target.dataset.courseId;
      if (sideCid) setActiveCourse(sideCid);
      openSidebar();
      break;
    case 'toggle-practice':
      const pLid = target.dataset.lessonId;
      const pTitle = target.dataset.lessonTitle;
      if (pLid) {
        e.stopPropagation();
        await togglePracticeItem('lesson', pLid, pTitle);
        // Refresh state is tricky without re-rendering or accessing local variable function
        // We can just rely on the button click handler updating itself if we kept the `onclick` but we removed it.
        // Wait. loadLesson created the button with specific logic.
        // The button in `loadLesson` is dynamic.
        // Let's re-run the check logic or just update that button directly here?
        // Simplest is to re-call `loadLesson` or extract the `updateBtnState` logic.
        // Actually, the button in `loadLesson` is re-created on load.
        // If we want it to update visually:
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
    case 'dismiss-celebration':
      const overlay = document.getElementById('celebrationOverlay');
      if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);
      }
      break;
  }
});

// Sidebar Toggles (Existing ID-based, can stay or move to delegation)
const navbarToggle = document.getElementById('toggleSidebarBtn');
if (navbarToggle) {
  navbarToggle.addEventListener('click', () => {
    // Close Practice Sidebar if open
    const practiceSb = document.getElementById('practiceSidebar');
    if (practiceSb && practiceSb.classList.contains('open')) {
      practiceSb.classList.remove('open');
      practiceSb.setAttribute('aria-hidden', 'true');
    }

    const sidebarEl = document.getElementById('courseSidebar');
    if (sidebarEl) {
      const isOpen = sidebarEl.classList.toggle('open');
      if (isOpen) {
        sidebarEl.removeAttribute('aria-hidden');
        if (allCourses.length === 0) fetchCourses();
      } else {
        sidebarEl.setAttribute('aria-hidden', 'true');
      }
    }
  });
}

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
  closeLessonBtn.addEventListener('click', () => {
    const player = document.getElementById('lessonPlayer');
    if (player) player.style.display = 'none';
  });
}

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
  const toggleBtn = document.getElementById('toggleSidebarBtn');
  toggleBtn?.addEventListener('click', toggleSidebar);

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

  Bus.on(BUS_EVENT.COURSE_UNLOCKED, () => {
    fetchCourses();
  });

  Bus.on(BUS_EVENT.REQUEST_LOAD_LESSON, (e) => {
    if (e.detail?.lessonId) {
      loadLesson(e.detail.lessonId);
    }
  });

  Bus.on(BUS_EVENT.OPEN_COURSE, (e) => {
    if (e.detail?.courseId) {
      setActiveCourse(e.detail.courseId);
      openSidebar();
    }
  });
}