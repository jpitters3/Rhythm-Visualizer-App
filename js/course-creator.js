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

// Function to handle remove click (2-step verification)
function handleRemoveClick(btn, sIdx, lIdx) {
  if (btn.getAttribute('data-confirm') === 'true') {
    // Second click: actually remove
    currentCourseData.sections[sIdx].lessons.splice(lIdx, 1);
    renderCourseStructure();
  } else {
    // First click: ask for confirmation
    btn.setAttribute('data-confirm', 'true');
    btn.textContent = "Confirm?";
    btn.style.borderColor = "#c0392b";
    btn.style.color = "#c0392b";
    btn.style.fontWeight = "bold";

    // Reset after 3 seconds if not clicked
    setTimeout(() => {
      // Check if button still exists in DOM (it might be gone if other updates happened)
      if (document.body.contains(btn)) {
        btn.setAttribute('data-confirm', 'false');
        btn.textContent = "Remove";
        btn.style = ""; // Clear inline styles
      }
    }, 3000);
  }
}

// Function to remove a lesson
function removeLesson(sectionIndex, lessonIndex) {
  // Deprecated in favor of handleRemoveClick
}

// Function to add a new section
function addSection() {
  currentCourseData.sections.push({
    title: `Section ${currentCourseData.sections.length + 1}`,
    lessons: []
  });
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
      </div>
      <div class="lessons-container" id="section-${sIdx}-lessons"></div>
      <button class="add-lesson-btn" onclick="addLessonToSection(${sIdx})">+ Add Lesson</button>
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
          <div class="lesson-actions">
            <button class="remove-btn" onclick="handleRemoveClick(this, ${sIdx}, ${lIdx})">Remove</button>
            <button class="small-btn" onclick="capturePatternForLesson(${sIdx}, ${lIdx})">Update to Current Groove</button>
          </div>
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
  if (currentCourseData.sections.length === 0 && !currentCourseData.id) {
    currentCourseData.sections.push({ title: "Section 1", lessons: [] });
  }
  renderCourseStructure();
}

window.loadCourseToEdit = function (course) {
  currentCourseData = JSON.parse(JSON.stringify(course)); // Deep copy to avoid mutating original
  document.getElementById('courseTitle').value = course.title;
  document.getElementById('courseDesc').value = course.description;

  const saveBtn = document.getElementById('saveCourseBtn');
  saveBtn.textContent = "Update Course";

  openCourseCreator();
};

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


const addSectionBtn = document.getElementById('addSectionBtn');
addSectionBtn?.addEventListener('click', addSection);

// ===== SAVE ===== //


const saveCourseBtn = document.getElementById('saveCourseBtn');

saveCourseBtn?.addEventListener('click', async () => {
  console.log("Save clicked!");

  if (!currentUser) {
    console.warn("Save aborted: No currentUser");
    alert("Please sign in to save courses.");
    return;
  }

  const title = document.getElementById('courseTitle').value.trim();
  const description = document.getElementById('courseDesc').value.trim();

  // Debug: Log what we are trying to save
  console.log("Saving Course:", { title, description, currentCourseData });

  if (!title) {
    alert("Please enter a course title.");
    return;
  }

  saveCourseBtn.disabled = true;
  saveCourseBtn.textContent = "Saving...";

  try {
    // 1. Check if Updating or Creating
    let courseId = currentCourseData.id;
    console.log("Course ID:", courseId, courseId ? "UPDATE MODE" : "CREATE MODE");

    if (courseId) {
      // === UPDATE MODE ===
      // Update metadata
      console.log("Updating course metadata...");
      const { error: uErr } = await supabase1
        .from('courses')
        .update({ title, description })
        .eq('id', courseId);

      if (uErr) {
        console.error("Error updating course metadata:", uErr);
        throw uErr;
      }

      // Delete old sections
      console.log("Deleting old sections for course:", courseId);
      const { data: oldSections } = await supabase1.from('sections').select('id').eq('course_id', courseId);
      if (oldSections && oldSections.length > 0) {
        const oldSecIds = oldSections.map(s => s.id);
        console.log("Old section IDs to delete:", oldSecIds);

        await supabase1.from('lessons').delete().in('section_id', oldSecIds);
        await supabase1.from('sections').delete().in('id', oldSecIds);
      }

    } else {
      // === CREATE MODE ===
      console.log("Creating new course...");
      const { data: newCourse, error: cErr } = await supabase1
        .from('courses')
        .insert([{
          title,
          description,
          owner_id: currentUser.id
        }])
        .select()
        .single();

      if (cErr) {
        console.error("Error creating course:", cErr);
        throw cErr;
      }
      courseId = newCourse.id;
      console.log("New Course ID:", courseId);
    }

    // 2. Save Sections and Lessons (Re-insertion strategy)
    console.log("Inserting sections and lessons...");
    for (let sIdx = 0; sIdx < currentCourseData.sections.length; sIdx++) {
      const sectionData = currentCourseData.sections[sIdx];
      const { data: section, error: sErr } = await supabase1
        .from('sections')
        .insert([{
          course_id: courseId,
          title: sectionData.title,
          order_index: sIdx
        }])
        .select()
        .single();

      if (sErr) throw sErr;

      const lessonsToInsert = sectionData.lessons.map((lesson, lIdx) => ({
        section_id: section.id,
        title: lesson.title,
        description: lesson.description || "",
        video_url: lesson.video_url || "",
        pattern_json: lesson.pattern_json,
        order_index: lIdx
      }));

      if (lessonsToInsert.length > 0) {
        const { error: lErr } = await supabase1.from('lessons').insert(lessonsToInsert);
        if (lErr) throw lErr;
      }
    }

    console.log("Save successful!");
    alert("Course saved successfully!");
    closeCourseCreator();

    // Reset form
    currentCourseData = { title: "", description: "", sections: [] };
    document.getElementById('courseTitle').value = "";
    document.getElementById('courseDesc').value = "";
    saveCourseBtn.textContent = "Save Course"; // Reset button text
    if (window.fetchCourses) window.fetchCourses(); // Refresh list

  } catch (err) {
    console.error("Error saving course (catch block):", err);
    alert(`Failed to save course: ${err.message}`);
  } finally {
    saveCourseBtn.disabled = false;
    saveCourseBtn.textContent = "Save Course";
  }
});