// ===== SIDEBAR LOGIC (OWNED COURSES) =====

let activeCourseId = null;

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

    // 2. Fetch User's Enrolled Course IDs
    const { data: enrollments } = await supabase1
      .from('user_courses')
      .select('course_id')
      .eq('user_id', currentUser.id);

    const enrolledIds = new Set(enrollments?.map(e => e.course_id) || []);

    // 3. Fetch ALL courses (we filter in memory or complicated query)
    // A simplified approach: Fetch all, then filter. 
    // Optimization: In real app, use a join or RPC. 
    const { data: allCourses, error } = await supabase1
      .from('courses')
      .select(`
        id, title, description, owner_id,
        sections (
          id, title, order_index,
          lessons (
            id, title, description, video_url, pattern_json, order_index
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Filter: User Owns (Creator) OR User Enrolled
    const myCourses = allCourses.filter(c =>
      c.owner_id === currentUser.id || enrolledIds.has(c.id)
    );

    window.allCourses = myCourses;
    window.allLessons = myCourses.flatMap(c => c.sections.flatMap(s => s.lessons));

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
             <div class="edit-course" onclick="editCourse('${course.id}')" title="Edit Course">
               <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/></svg>
             </div>
          </div>
          <div class="course-body">
            ${course.sections.sort((a, b) => a.order_index - b.order_index).map(section => `
              <div class="section-title">${section.title}</div>
              ${section.lessons.sort((a, b) => a.order_index - b.order_index).map(lesson => `
                <div class="lesson-link" onclick="loadLesson('${lesson.id}')">
                  <span style="opacity:0.6; margin-right:6px;">•</span> ${lesson.title}
                </div>
              `).join('')}
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
  const lesson = window.allLessons.find(l => l.id === lessonId);
  if (!lesson) return;

  // 1. Apply the groove to the grid
  if (lesson.pattern_json) applyPattern(lesson.pattern_json);

  // 2. Show UI info
  document.getElementById('lessonPlayer').style.display = 'block';
  document.getElementById('activeLessonTitle').textContent = lesson.title;
  document.getElementById('lessonDescription').textContent = lesson.description;

  // 3. Handle Video
  const videoCont = document.getElementById('videoContainer');
  if (lesson.video_url) {
    const videoId = extractYouTubeId(lesson.video_url);
    videoCont.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`;
    videoCont.style.display = 'block';
  } else {
    videoCont.style.display = 'none';
  }

  // On Mobile, maybe close sidebar? On desktop, keep open?
  if (window.innerWidth < 768) closeSidebar();
}

function editCourse(courseId) {
  if (event) event.stopPropagation(); // Prevent collapsing/expanding if clicking edit
  const course = window.allCourses.find(c => c.id === courseId);
  if (!course) return;
  loadCourseToEdit(course);
  if (window.innerWidth < 768) closeSidebar();
}

function closeSidebar() {
  const sb = document.getElementById('courseSidebar');
  sb.classList.remove('open');
  sb.setAttribute('aria-hidden', 'true');
}

function extractYouTubeId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Sidebar Toggles
const sidebarEl = document.getElementById('courseSidebar');
document.getElementById('toggleSidebarBtn').onclick = () => {
  const isOpen = sidebarEl.classList.toggle('open');
  if (isOpen) {
    sidebarEl.removeAttribute('aria-hidden');
    fetchCourses();
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