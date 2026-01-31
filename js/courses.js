// ===== SIDEBAR LOGIC (OWNED COURSES) =====

let activeCourseId = null;
window.allCourses = [];
window.allSections = [];
window.allLessons = [];
window.currentLesson = null;

async function fetchCourses() {
  if (!currentUser) return; // Wait for auth

  try {
    // 1. Fetch User Profile for Active Course ID
    const { data: profile } = await supabase1
      .from('profiles')
      .select('current_course_id')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    activeCourseId = profile?.current_course_id;

    // 2. Fetch User's Enrolled Courses AND Completed Lessons
    const [enrollRes, progressRes] = await Promise.all([
      supabase1.from('user_courses').select('course_id').eq('user_id', currentUser.id),
      supabase1.from('user_lesson_progress').select('lesson_id').eq('user_id', currentUser.id)
    ]);

    const enrolledIds = new Set(enrollRes.data?.map(e => e.course_id) || []);
    window.completedLessonIds = new Set(progressRes.data?.map(p => p.lesson_id) || []);

    // 3. Fetch ALL courses (we filter in memory or complicated query)
    // A simplified approach: Fetch all, then filter. 
    // Optimization: In real app, use a join or RPC. 
    const { data: allCourses, error } = await supabase1
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
    const isAdmin = typeof isAdminUser === 'function' && isAdminUser(currentUser);

    const myCourses = allCourses.filter(c => {
      const isOwner = c.owner_id === currentUser.id;
      const isEnrolled = enrolledIds.has(c.id);
      const canView = c.is_published || (isOwner && isAdmin);

      return (isOwner || isEnrolled) && canView;
    });

    window.allCourses = myCourses;
    window.allSections = myCourses.flatMap(c => {
      const isOwner = c.owner_id === currentUser?.id;
      return c.sections
        .filter(s => s.is_published || isAdmin || isOwner)
        .map(s => ({ ...s, courseTitle: c.title, courseId: c.id }));
    });
    window.allLessons = window.allSections.flatMap(s => s.lessons);

    renderCourseSidebar(myCourses);

  } catch (err) {
    console.error("Error fetching my courses:", err);
  }
}

function renderCourseSidebar(courses) {
  const list = document.getElementById('courseList');
  const header = document.querySelector('.sidebar-header');

  // 1. Setup Header Button
  // Remove existing Browse button if any to avoid dupes logic (simplified: overwrite header content?)
  // Better: Just check logic.

  // If no courses, show Empty State
  if (courses.length === 0) {
    list.innerHTML = `
      <div class="empty-courses">
        <h4>No courses yet</h4>
        <p>Browse the marketplace to start learning.</p>
        <button class="browse-big-btn" onclick="openMarketplace()">Browse Courses</button>
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
    btn.onclick = () => window.openMarketplace();
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
      return `
        <div class="course-item active" data-id="${course.id}">
          <div class="course-header">
            <h4>${course.title}</h4>
            ${(typeof isAdminUser === 'function' && isAdminUser(currentUser)) ? `<div class="edit-course" onclick="editCourse('${course.id}')" title="Edit Course">
               <svg width="16px" height="16px" cursor="pointer" fill="currentColor" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/></svg>
             </div>` : ''}
          </div>
          <div class="course-body">
            ${course.sections
          .filter(s => {
            const isAdmin = typeof isAdminUser === 'function' ? isAdminUser(currentUser) : false;
            const isOwner = course.owner_id === currentUser?.id;
            return s.is_published || isAdmin || isOwner;
          })
          .sort((a, b) => a.order_index - b.order_index).map(section => `
              <div class="section-title" style="${!section.is_published ? 'opacity: 0.8; font-style: italic;' : ''}">
                ${section.title} ${!section.is_published ? '(Draft)' : ''}
              </div>
              ${section.lessons.sort((a, b) => a.order_index - b.order_index).map(lesson => {
            const isComplete = window.completedLessonIds?.has(lesson.id);
            return `
                <div class="lesson-link" onclick="loadLesson('${lesson.id}')">
                  ${isComplete
                ? '<span style="color:#4CAF50; margin-right:6px; font-weight:bold;">✓</span>'
                : '<span style="opacity:0.6; margin-right:6px;">•</span>'}
                  ${lesson.title}
                </div>
              `}).join('')}
            `).join('')}
          </div>
        </div>
      `;
    } else {
      // === COLLAPSED (INACTIVE) ===
      return `
        <div class="course-item collapsed" data-id="${course.id}" onclick="setActiveCourse('${course.id}')">
          <div class="course-header">
            <h4>${course.title}</h4>
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
  if (typeof updateAdminUI === 'function') updateAdminUI();
}

async function setActiveCourse(courseId) {
  if (activeCourseId === courseId) return;

  activeCourseId = courseId;

  // Optimistic Render
  renderCourseSidebar(window.allCourses);

  // Persist
  if (currentUser) {
    await supabase1
      .from('profiles')
      .update({ current_course_id: courseId })
      .eq('user_id', currentUser.id);
  }
}


function loadLesson(lessonId) {
  try {
    // Check unsaved changes
    if (typeof window.hasUnsavedChanges === 'function' && window.hasUnsavedChanges()) {
      if (!confirm('You have unsaved changes. Discard them?')) return;
    }

    // DEBUG: Trace execution
    // alert(`DEBUG: Loading lesson ID: ${lessonId}`);

    const lesson = window.allLessons.find(l => l.id === lessonId);
    if (!lesson) {
      alert(`DEBUG ERROR: Lesson not found! ID: ${lessonId}. Total lessons loaded: ${window.allLessons.length}`);
      return;
    }
    window.currentLesson = lesson;

    // alert(`DEBUG: Found lesson: ${lesson.title}`);

    // 1. Apply the groove to the grid
    if (lesson.pattern_json) {
      if (typeof applyPattern === 'function') {
        applyPattern(lesson.pattern_json);
      } else {
        console.error("applyPattern function missing");
      }

      // Explicitly sync lastSavedState to the *serialized* version of what we just loaded
      // This prevents false positives if the saved JSON differs slightly from fresh serialization
      if (typeof serializePattern === 'function') {
        window.lastSavedState = JSON.stringify(serializePattern());
      }
    }

    // 2. Show UI info
    const player = document.getElementById('lessonPlayer');
    if (!player) {
      alert("DEBUG ERROR: #lessonPlayer element not found in DOM!");
      return;
    }

    // Force visible
    player.style.display = 'block';

    const section = window.allSections.find(s => s.id === lesson.section_id);
    const sectionTitle = section ? section.title : 'Unknown Section';

    // Also update the separate section header if it exists (for layout flexibility)
    const secTitleEl = document.getElementById('activeSectionTitle');
    const courseTitle = section ? section.courseTitle : 'Unknown Course';
    const courseId = section ? section.courseId : null;

    if (secTitleEl) {
      secTitleEl.innerHTML = `<span class="clickable-nav-title" title="Open course sidebar">${courseTitle} • ${sectionTitle}</span>`;
      const navSpan = secTitleEl.querySelector('.clickable-nav-title');
      if (navSpan && courseId) {
        navSpan.onclick = () => {
          if (typeof setActiveCourse === 'function') setActiveCourse(courseId);
          openSidebar();
        };
      }
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
        const isAdded = (typeof window.isItemInPractice === 'function') && window.isItemInPractice('lesson', lesson.id);
        pBtn.innerHTML = isAdded ? '⛔️ Remove' : '➕ Add to Plan';
        if (isAdded) {
          pBtn.style.borderColor = 'rgba(255,0,0,0.2)';
          pBtn.style.backgroundColor = 'rgba(255,0,0,0.02)';
        } else {
          pBtn.style.borderColor = 'var(--panel-border)';
          pBtn.style.backgroundColor = 'transparent';
        }
      };
      updateBtnState();

      pBtn.onclick = async (e) => {
        e.stopPropagation();
        if (window.togglePracticeItem) {
          await window.togglePracticeItem('lesson', lesson.id, lesson.title);
          updateBtnState();
        }
      };

      // == ADMIN ONLY: Update Lesson from Grid Button ==
      if (typeof isAdminUser === 'function' && isAdminUser(currentUser)) {
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
        uBtn.onclick = (e) => {
          e.stopPropagation();
          window.updateLessonFromGrid(lesson.id);
        };
      } else {
        document.getElementById('updateLessonBtn')?.remove();
      }
    }

    const descEl = document.getElementById('lessonDescription');
    if (descEl) {
      descEl.textContent = lesson.description || '';
      // Toggle readonly based on admin status
      if (typeof isAdminUser === 'function' && isAdminUser(currentUser)) {
        descEl.setAttribute('contenteditable', 'true');
      } else {
        descEl.setAttribute('contenteditable', 'false');
      }
    }

    const lessonContentEl = document.getElementsByClassName('lesson-content')[0];
    if (lessonContentEl) lessonContentEl.style.display = 'block';

    // Completion Button
    const btn = document.getElementById('lessonCompleteBtn');
    const isComplete = window.completedLessonIds?.has(lesson.id);

    if (btn) {
      btn.textContent = isComplete ? '✅ Completed' : 'Mark as Complete';
      btn.onclick = () => toggleLessonCompletion(lesson.id);
      btn.style.display = 'inline-flex';
    }

    // Navigation Logic (Prev / Next)
    const nextBtn = document.getElementById('nextLessonBtn');
    const prevBtn = document.getElementById('prevLessonBtn');

    if (nextBtn || prevBtn) {
      // Find the course this lesson belongs to
      const course = window.allCourses.find(c => c.sections.some(s => s.lessons.some(l => l.id === lessonId)));

      let nextLesson = null;
      let prevLesson = null;

      if (course) {
        // Flatten lessons for THIS course only (respecting section draft rules)
        const isAdmin = typeof isAdminUser === 'function' ? isAdminUser(currentUser) : false;
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
          nextBtn.onclick = () => {
            if (typeof stop === 'function') stop();
            loadLesson(nextLesson.id);
          };
          nextBtn.title = `Next: ${nextLesson.title}`;

          // Visual cue : Faded if current lesson not complete
          if (window.completedLessonIds?.has(lesson.id)) {
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
          prevBtn.onclick = () => {
            if (typeof stop === 'function') stop();
            loadLesson(prevLesson.id);
          };
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
          videoCont.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`;
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

const titleEl = document.getElementById('activeLessonTitle');
const lessonHeader = document.getElementById('lessonHeader');
const lessonContent = document.getElementById('lessonContent')

lessonHeader.addEventListener('click', () => {
  if (lessonContent.style.display === 'none') {
    lessonContent.style.display = 'block';
    if (titleEl) titleEl.textContent = '▲ ' + titleEl.textContent.replace('▼ ', '');
  } else {
    lessonContent.style.display = 'none';
    if (titleEl) titleEl.textContent = '▼ ' + titleEl.textContent.replace('▲ ', '');
  }
});


// ============================================================================
// Sidebar Functions
// ============================================================================
function editCourse(courseId) {
  if (event) event.stopPropagation(); // Prevent collapsing/expanding if clicking edit
  const course = window.allCourses.find(c => c.id === courseId);
  if (!course) return;
  loadCourseToEdit(course);
  if (window.innerWidth < 768) closeSidebar();
}

function closeSidebar() {
  const sb = document.getElementById('courseSidebar');
  if (sb) {
    sb.classList.remove('open');
    sb.setAttribute('aria-hidden', 'true');
  }
}

function openSidebar() {
  const sb = document.getElementById('courseSidebar');
  if (sb && !sb.classList.contains('open')) {
    sb.classList.add('open');
    sb.removeAttribute('aria-hidden');
    if (!window.allCourses || window.allCourses.length === 0) fetchCourses();
  }
}

function extractYouTubeId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Sidebar Toggles
const sidebarEl = document.getElementById('courseSidebar');
document.getElementById('toggleSidebarBtn').onclick = () => {
  // Close Practice Sidebar if open
  const practiceSb = document.getElementById('practiceSidebar');
  if (practiceSb && practiceSb.classList.contains('open')) {
    practiceSb.classList.remove('open');
    practiceSb.setAttribute('aria-hidden', 'true');
  }

  const isOpen = sidebarEl.classList.toggle('open');
  if (isOpen) {
    sidebarEl.removeAttribute('aria-hidden');
    if (!window.allCourses || window.allCourses.length === 0) fetchCourses();
  } else {
    sidebarEl.setAttribute('aria-hidden', 'true');
  }
};
document.getElementById('closeSidebar').onclick = () => closeSidebar();
document.getElementById('closeLessonBtn').onclick = () => document.getElementById('lessonPlayer').style.display = 'none';

// Search
const searchInput = document.getElementById('courseSearchInput');
searchInput?.addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();
  // Filter active course items only? Or all?
  // Current implementation: Just simple DOM filtering on expanded items
  const lessonLinks = document.querySelectorAll('.lesson-link');
  lessonLinks.forEach(link => {
    const text = link.textContent.toLowerCase();
    link.style.display = text.includes(term) ? 'flex' : 'none';
  });
});

async function toggleLessonCompletion(lessonId) {
  if (!currentUser) {
    alert("Please sign in to track progress.");
    return;
  }

  const isComplete = window.completedLessonIds.has(lessonId);

  if (isComplete) {
    const { error } = await supabase1
      .from('user_lesson_progress')
      .delete()
      .eq('lesson_id', lessonId)
      .eq('user_id', currentUser.id);

    if (!error) window.completedLessonIds.delete(lessonId);
  } else {
    const { error } = await supabase1
      .from('user_lesson_progress')
      .insert({ user_id: currentUser.id, lesson_id: lessonId });

    if (!error) {
      window.completedLessonIds.add(lessonId);

      // Check for Course Completion
      const course = window.allCourses.find(c => c.sections.some(s => s.lessons.some(l => l.id === lessonId)));
      if (course) {
        const courseLessonIds = course.sections.flatMap(s => s.lessons).map(l => l.id);
        const allComplete = courseLessonIds.every(id => window.completedLessonIds.has(id));
        if (allComplete) {
          triggerCourseCompletionCelebration(course.title);
        }
      }
    }
  }

  // Refresh UI
  renderCourseSidebar(window.allCourses);

  // Also update current button if viewing that lesson
  const btn = document.getElementById('lessonCompleteBtn');
  const nextBtn = document.getElementById('nextLessonBtn');

  if (btn) {
    const newState = window.completedLessonIds.has(lessonId);
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
                <button class="primary-btn" style="font-size:1.2rem; padding: 12px 32px;" onclick="document.getElementById('celebrationOverlay').style.opacity='0'; setTimeout(()=>document.getElementById('celebrationOverlay').remove(), 500)">Continue</button>
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

window.toggleLessonCompletion = toggleLessonCompletion;

window.updateLessonFromGrid = async function (lessonId) {
  const lesson = window.allLessons.find(l => l.id === lessonId);
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
    const descEl = document.getElementById('lessonDescription');
    const newDescription = descEl ? descEl.textContent : (lesson.description || '');

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
    const { error } = await supabase1
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
    window.lastSavedState = JSON.stringify(pattern_json);

    console.log(`Lesson ${lessonId} and Pattern "${trimmedName}" updated successfully.`);
  } catch (err) {
    console.error("Failed to update lesson/pattern:", err);
    alert("Error updating: " + err.message);
  }
};