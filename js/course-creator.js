let currentCourseData = {
  title: "",
  description: "",
  sections: []
};

// Function to add a lesson to a section
function addLessonToSection(sectionIndex) {
  const lesson = {
    title: "New Lesson",
    description: "",
    video_url: "",
    pattern_json: serializePattern() // Captures the current grid state instantly!
  };
  currentCourseData.sections[sectionIndex].lessons.push(lesson);
  renderCourseStructure();
}

// Function to render the UI for the course builder
function renderCourseStructure() {
  const container = document.getElementById('courseStructure');
  container.innerHTML = '';

  currentCourseData.sections.forEach((section, sIdx) => {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'section-builder';
    sectionEl.innerHTML = `
      <div class="section-header">
        <input type="text" value="${section.title}" onchange="currentCourseData.sections[${sIdx}].title = this.value">
        <button onclick="addLessonToSection(${sIdx})">+ Add Lesson</button>
      </div>
      <div class="lessons-container" id="section-${sIdx}-lessons"></div>
    `;

    section.lessons.forEach((lesson, lIdx) => {
      const lessonEl = document.createElement('div');
      lessonEl.className = 'lesson-builder';
      lessonEl.innerHTML = `
        <input type="text" value="${lesson.title}" placeholder="Lesson Title" onchange="currentCourseData.sections[${sIdx}].lessons[${lIdx}].title = this.value">
        <textarea placeholder="Description" onchange="currentCourseData.sections[${sIdx}].lessons[${lIdx}].description = this.value">${lesson.description}</textarea>
        <input type="text" value="${lesson.video_url}" placeholder="YouTube URL" onchange="currentCourseData.sections[${sIdx}].lessons[${lIdx}].video_url = this.value">
        <div class="lesson-meta">
          <span>Pattern Captured ✓</span>
          <button class="small-btn" onclick="capturePatternForLesson(${sIdx}, ${lIdx})">Update to Current Groove</button>
        </div>
      `;
      sectionEl.querySelector('.lessons-container').appendChild(lessonEl);
    });

    container.appendChild(sectionEl);
  });
}

function capturePatternForLesson(sIdx, lIdx) {
  currentCourseData.sections[sIdx].lessons[lIdx].pattern_json = serializePattern();
  alert("Lesson pattern updated to current grid state!");
}


// ===== Event listeners ===== //

const courseModal = document.getElementById('courseModal');
const openCourseBtn = document.getElementById('openCourseModalBtn');
const closeCourseBtn = document.getElementById('closeCourseModal');

function openCourseCreator() {
  courseModal.classList.add('open');
  courseModal.setAttribute('aria-hidden', 'false');
  // Initialize with one empty section if new
  if (currentCourseData.sections.length === 0) {
    currentCourseData.sections.push({ title: "Section 1", lessons: [] });
  }
  renderCourseStructure();
}

function closeCourseCreator() {
  courseModal.classList.remove('open');
  // courseModal.setAttribute('aria-hidden', 'true');
}

// Listeners
openCourseBtn?.addEventListener('click', openCourseCreator);
closeCourseBtn?.addEventListener('click', closeCourseCreator);

// Close on clicking the dark overlay
courseModal?.addEventListener('click', (e) => {
  if (e.target === courseModal) {
    e.target.inert = true;
    closeCourseCreator();
  }
});


// ===== SAVE ===== //


const saveCourseBtn = document.getElementById('saveCourseBtn');

saveCourseBtn?.addEventListener('click', async () => {
  if (!currentUser) {
    alert("Please sign in to save courses.");
    return;
  }

  const title = document.getElementById('courseTitle').value.trim();
  const description = document.getElementById('courseDesc').value.trim();

  if (!title) {
    alert("Please enter a course title.");
    return;
  }

  saveCourseBtn.disabled = true;
  saveCourseBtn.textContent = "Saving...";

  try {
    // 1. Save the Course
    const { data: course, error: cErr } = await supabase1
      .from('courses')
      .insert([{ 
        title, 
        description, 
        owner_id: currentUser.id 
      }])
      .select()
      .single();

    if (cErr) throw cErr;

    // 2. Save Sections and Lessons
    for (let sIdx = 0; sIdx < currentCourseData.sections.length; sIdx++) {
      const sectionData = currentCourseData.sections[sIdx];
      
      const { data: section, error: sErr } = await supabase1
        .from('sections')
        .insert([{
          course_id: course.id,
          title: sectionData.title,
          order_index: sIdx
        }])
        .select()
        .single();

      if (sErr) throw sErr;

      // 3. Save Lessons for this section
      const lessonsToInsert = sectionData.lessons.map((lesson, lIdx) => ({
        section_id: section.id,
        title: lesson.title,
        description: lesson.description,
        video_url: lesson.video_url,
        pattern_json: lesson.pattern_json, // Captured via serializePattern()
        order_index: lIdx
      }));

      if (lessonsToInsert.length > 0) {
        const { error: lErr } = await supabase1
          .from('lessons')
          .insert(lessonsToInsert);
        
        if (lErr) throw lErr;
      }
    }

    alert("Course saved successfully!");
    closeCourseCreator();
    
    // Optional: Reset form
    currentCourseData = { title: "", description: "", sections: [] };
    document.getElementById('courseTitle').value = "";
    document.getElementById('courseDesc').value = "";

  } catch (err) {
    console.error("Error saving course:", err);
    alert(`Failed to save course: ${err.message}`);
  } finally {
    saveCourseBtn.disabled = false;
    saveCourseBtn.textContent = "Save Course";
  }
});