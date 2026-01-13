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
      <h4>${course.title}</h4>
      <button onclick="editCourse('${course.id}')" class="secondary-btn" style="font-size:11px; padding:4px 10px; margin-top:10px;">Edit Course</button>
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