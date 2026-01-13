async function fetchCourses() {
  const { data: courses, error } = await supabase1
    .from('courses')
    .select(`
      id, title, description,
      sections (
        id, title, order_index,
        lessons (
          id, title, description, video_url, pattern_json, order_index
        )
      )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Error fetching courses:", error);
    return;
  }
  renderCourseLibrary(courses);
  window.allCourses = courses; // Store globally for editing
}

function renderCourseLibrary(courses) {
  const list = document.getElementById('courseList');
  list.innerHTML = courses.map(course => `
    <div class="course-item">
      <div class="grid-container">
        <div class="grid-child">
          <h4>${course.title}</h4>
        </div>
        <div class="grid-child edit-course" onclick="editCourse('${course.id}')" style="font-size:11px; padding:4px 4px">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil-square" viewBox="0 0 16 16">
            <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/>
            <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/>
          </svg>
        </div>
      </div>
      ${course.sections.sort((a, b) => a.order_index - b.order_index).map(section => `
        <div class="section-title">${section.title}</div>
        ${section.lessons.sort((a, b) => a.order_index - b.order_index).map(lesson => `
          <div class="lesson-link" onclick="loadLesson('${lesson.id}')">
            • ${lesson.title}
          </div>
        `).join('')}
      `).join('')}
    </div>
  `).join('');

  // Store lessons globally for quick access
  window.allLessons = courses.flatMap(c => c.sections.flatMap(s => s.lessons));
}

function loadLesson(lessonId) {
  const lesson = window.allLessons.find(l => l.id === lessonId);
  if (!lesson) return;

  // 1. Apply the groove to the grid!
  applyPattern(lesson.pattern_json);

  // 2. Show UI info
  document.getElementById('lessonPlayer').style.display = 'block';
  document.getElementById('activeLessonTitle').textContent = lesson.title;
  document.getElementById('lessonDescription').textContent = lesson.description;

  // 3. Handle Video Embed
  const videoCont = document.getElementById('videoContainer');
  if (lesson.video_url) {
    const videoId = extractYouTubeId(lesson.video_url);
    videoCont.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`;
    videoCont.style.display = 'block';
  } else {
    videoCont.style.display = 'none';
  }

  closeSidebar();
}

function editCourse(courseId) {
  const course = window.allCourses.find(c => c.id === courseId);
  if (!course) return;
  loadCourseToEdit(course);
  closeSidebar();
}

function closeSidebar() {
  sidebar.classList.remove('open');
}

function extractYouTubeId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Sidebar Toggles
const sidebar = document.getElementById('courseSidebar');
document.getElementById('toggleSidebarBtn').onclick = () => sidebar.classList.toggle('open');
document.getElementById('closeSidebar').onclick = () => closeSidebar();
document.getElementById('closeLessonBtn').onclick = () => document.getElementById('lessonPlayer').style.display = 'none';

// Initial Load
fetchCourses();


// ==== SEARCH ===== //

const searchInput = document.getElementById('courseSearchInput');

searchInput?.addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();
  const lessonCards = document.querySelectorAll('.lesson-link');
  const sectionTitles = document.querySelectorAll('.section-title');
  const courseItems = document.querySelectorAll('.course-item');

  lessonCards.forEach(card => {
    const text = card.textContent.toLowerCase();
    // Show card if it matches search
    const isMatch = text.includes(term);
    card.style.display = isMatch ? 'flex' : 'none';
  });

  // UX Polish: Hide Section/Course titles if all their lessons are hidden
  courseItems.forEach(item => {
    const visibleLessons = item.querySelectorAll('.lesson-link[style="display: flex;"]');
    item.style.display = visibleLessons.length > 0 ? 'flex' : 'none';
  });
});