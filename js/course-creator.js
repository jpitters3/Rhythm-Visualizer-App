// ===== STATE =====
let currentCourseData = {
  title: "",
  description: "",
  sections: []
};

let availablePatterns = [];
const expandedSections = new Set();
const expandedLessons = new Set(); // Strings "sIdx-lIdx"

// Drag State
let dragEl = null;
let dragSrcData = null;

// Fetch patterns on load
async function loadPatternOptions() {
  try {
    if (currentUser) {
      availablePatterns = await dbListPatternNames();
    } else {
      const saved = getSavedPatterns();
      availablePatterns = Object.keys(saved).sort((a, b) => a.localeCompare(b));
    }
  } catch (err) {
    console.error("Failed to load pattern options:", err);
    availablePatterns = [];
  }
}

// Function to add a lesson to a section
function addLessonToSection(sectionIndex) {
  const lesson = {
    title: "New Lesson",
    description: "",
    video_url: "",
    pattern_json: serializePattern(), // Default to current grid
    pattern_name: "" // New field for dropdown selection
  };
  currentCourseData.sections[sectionIndex].lessons.push(lesson);

  // Auto-expand section and new lesson
  expandedSections.add(sectionIndex);
  expandedLessons.add(`${sectionIndex}-${currentCourseData.sections[sectionIndex].lessons.length - 1}`);

  renderCourseStructure();
}

// Function to handle pattern selection in dropdown
async function handlePatternSelect(selectEl, sIdx, lIdx) {
  const patternName = selectEl.value;
  if (!patternName) return;

  try {
    let patternData = null;

    if (currentUser) {
      patternData = await dbLoadPatternByName(patternName);
    } else {
      const saved = getSavedPatterns();
      patternData = saved[patternName];
    }

    if (patternData) {
      // SNAPSHOT: Store the full JSON in the lesson
      currentCourseData.sections[sIdx].lessons[lIdx].pattern_json = patternData;
      currentCourseData.sections[sIdx].lessons[lIdx].pattern_name = patternName;

      // Visual Feedback
      const btn = selectEl.nextElementSibling; // The 'Update' button
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = "Loaded!";
        setTimeout(() => btn.textContent = originalText, 1500);
      }
    } else {
      alert("Could not load pattern data. It may have been deleted.");
    }
  } catch (err) {
    console.error("Error loading pattern for lesson:", err);
    alert("Error loading pattern data.");
  }
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

// Function to add a new section
function addSection() {
  currentCourseData.sections.push({
    title: `Section ${currentCourseData.sections.length + 1}`,
    lessons: []
  });
  // Auto-expand new section
  expandedSections.add(currentCourseData.sections.length - 1);
  renderCourseStructure();
}

function toggleSection(sIdx) {
  if (expandedSections.has(sIdx)) {
    expandedSections.delete(sIdx);
  } else {
    expandedSections.add(sIdx);
  }
  renderCourseStructure();
}

function toggleLesson(sIdx, lIdx) {
  const key = `${sIdx}-${lIdx}`;
  if (expandedLessons.has(key)) expandedLessons.delete(key);
  else expandedLessons.add(key);
  renderCourseStructure();
}

// --- DRAG AND DROP HANDLERS ---

function courseDragStart(e, type, sIdx, lIdx = null) {
  dragEl = e.target; // The element being dragged
  dragSrcData = { type, sIdx, lIdx };

  e.dataTransfer.effectAllowed = 'move';
  // Use a dummy text for Firefox/others to allow drag
  e.dataTransfer.setData('text/plain', JSON.stringify({ type, sIdx, lIdx }));

  // Add dragging class for visuals
  setTimeout(() => e.target.classList.add('dragging'), 0);
}

function courseDragOver(e) {
  if (e.preventDefault) e.preventDefault(); // Necessary to allow dropping
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function courseDragEnter(e) {
  // Add visual cue
  const target = e.target.closest(dragSrcData.type === 'section' ? '.section-builder' : '.lesson-builder');
  if (target && target !== dragEl) {
    target.classList.add('drop-target');
  }
}

function courseDragLeave(e) {
  const target = e.target.closest(dragSrcData.type === 'section' ? '.section-builder' : '.lesson-builder');
  if (target) {
    target.classList.remove('drop-target');
  }
}

function courseDragEnd(e) {
  // Cleanup classes
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  dragEl = null;
  dragSrcData = null;
}

function courseDrop(e, type, targetSIdx, targetLIdx = null) {
  if (e.stopPropagation) e.stopPropagation();

  // Source Data
  const src = dragSrcData;
  if (!src) return false;

  // Logic for swapping
  if (src.type !== type) return false; // Can't drop section on lesson or vice versa (for now)

  if (src.type === 'section') {
    // Reorder Sections
    if (src.sIdx !== targetSIdx) {
      const sections = currentCourseData.sections;
      const [moved] = sections.splice(src.sIdx, 1);
      sections.splice(targetSIdx, 0, moved);

      // Fix expanded Set indices maps (bit complex, so just clear or re-calc?)
      // Simplest: If the moved one was expanded, track it.
      // Actually, indices change, so the Set is now invalid.
      // Let's just clear expanded state or try to be smart.
      // Being dumb is safer: clear expanded to avoid confusion
      expandedSections.clear();
      expandedLessons.clear();
      // Or maybe expand the one we just moved
      expandedSections.add(targetSIdx);

      renderCourseStructure();
    }
  } else if (src.type === 'lesson') {
    // Reorder Lessons
    // Allow cross-section drops
    const sections = currentCourseData.sections;
    const sourceList = sections[src.sIdx].lessons;
    const targetList = sections[targetSIdx].lessons;

    // Remove from source
    const [moved] = sourceList.splice(src.lIdx, 1);

    // Add to target
    // If dropping onto a specific lesson, insert at that index
    // If targetLIdx is null (e.g. dropped on section header), append?
    // But our drop targets are ONLY lessons (handleDrop called from lesson-builder)

    if (targetLIdx !== null) {
      targetList.splice(targetLIdx, 0, moved);
    } else {
      // Should verify where it was dropped. For now, we only bind drop on .lesson-builder
      targetList.push(moved);
    }

    // Ensure new host section is expanded
    expandedSections.add(targetSIdx);
    expandedLessons.clear(); // Reset lesson expansion on drop to avoid mismatch

    renderCourseStructure();
  }

  return false;
}


// Function to render the UI for the course builder
function renderCourseStructure() {
  const container = document.getElementById('courseStructure');
  container.innerHTML = '';

  currentCourseData.sections.forEach((section, sIdx) => {
    const isExpanded = expandedSections.has(sIdx);

    const sectionEl = document.createElement('div');
    sectionEl.className = 'section-builder';
    sectionEl.setAttribute('draggable', 'true');

    // Drag Events
    sectionEl.addEventListener('dragstart', (e) => courseDragStart(e, 'section', sIdx));
    sectionEl.addEventListener('dragover', courseDragOver);
    sectionEl.addEventListener('dragenter', courseDragEnter);
    sectionEl.addEventListener('dragleave', courseDragLeave);
    sectionEl.addEventListener('drop', (e) => courseDrop(e, 'section', sIdx));
    sectionEl.addEventListener('dragend', courseDragEnd);


    sectionEl.innerHTML = `
      <div class="section-header-bar">
          <div class="drag-handle" title="Drag to reorder section">☰</div>
          <button class="toggle-btn" onclick="toggleSection(${sIdx})">
             ${isExpanded ? '▼' : '▶'}
          </button>
          <div class="section-title-input">
             <input type="text" value="${section.title}" onchange="currentCourseData.sections[${sIdx}].title = this.value" placeholder="Section Title">
          </div>
          <button class="icon-btn remove-section-btn" onclick="removeSection(${sIdx})" title="Remove Section">&times;</button>
      </div>
      
      <div class="lessons-container ${isExpanded ? 'active' : ''}" id="section-${sIdx}-lessons"></div>
      
      ${isExpanded ? `<button class="add-lesson-btn" onclick="addLessonToSection(${sIdx})">+ Add Lesson</button>` : ''}
    `;

    const lessonsContainer = sectionEl.querySelector('.lessons-container');

    if (isExpanded) {
      section.lessons.forEach((lesson, lIdx) => {
        const isLessonExpanded = expandedLessons.has(`${sIdx}-${lIdx}`);

        // Generate Pattern Options
        const patternOptions = availablePatterns.map(name =>
          `<option value="${name}" ${lesson.pattern_name === name ? 'selected' : ''}>${name}</option>`
        ).join('');

        const lessonEl = document.createElement('div');
        lessonEl.className = 'lesson-builder';
        lessonEl.setAttribute('draggable', 'true');

        // Drag Events (Lesson)
        lessonEl.addEventListener('dragstart', (e) => {
          e.stopPropagation(); // Don't drag section!
          courseDragStart(e, 'lesson', sIdx, lIdx);
        });
        lessonEl.addEventListener('dragover', courseDragOver);
        lessonEl.addEventListener('dragenter', courseDragEnter);
        lessonEl.addEventListener('dragleave', courseDragLeave);
        lessonEl.addEventListener('drop', (e) => {
          e.stopPropagation();
          courseDrop(e, 'lesson', sIdx, lIdx);
        });
        lessonEl.addEventListener('dragend', courseDragEnd);

        lessonEl.innerHTML = `
            <div class="lesson-header-bar" onclick="if(event.target.tagName !== 'INPUT' && event.target.tagName !== 'BUTTON') toggleLesson(${sIdx}, ${lIdx})">
                <div class="lesson-drag-handle" title="Drag to reorder lesson">::</div>
                <button class="toggle-btn lesson-toggle-btn" onclick="event.stopPropagation(); toggleLesson(${sIdx}, ${lIdx})">
                     ${isLessonExpanded ? '▼' : '▶'}
                </button>
                <input type="text" class="lesson-title-input" value="${lesson.title}" placeholder="Lesson Title" onclick="event.stopPropagation()" onchange="currentCourseData.sections[${sIdx}].lessons[${lIdx}].title = this.value">
                <button class="icon-btn remove-btn-small" onclick="event.stopPropagation(); handleRemoveClick(this, ${sIdx}, ${lIdx})" title="Remove Lesson">&times;</button>
            </div>

            <div class="lesson-content ${isLessonExpanded ? 'active' : ''}">
                <textarea placeholder="Description" onchange="currentCourseData.sections[${sIdx}].lessons[${lIdx}].description = this.value">${lesson.description}</textarea>
                <div class="input-with-icon">
                    <span>📺</span>
                    <input type="text" value="${lesson.video_url}" placeholder="YouTube URL" onchange="currentCourseData.sections[${sIdx}].lessons[${lIdx}].video_url = this.value">
                </div>
                
                <div class="lesson-meta-box">
                  <div class="meta-label">ASSOCIATED PATTERN</div>
                  <div class="pattern-control-row">
                    <select class="pattern-select" onchange="handlePatternSelect(this, ${sIdx}, ${lIdx})">
                      <option value="">-- Capture Current Grid --</option>
                      ${patternOptions}
                    </select>
                    <button class="small-capture-btn" onclick="capturePatternForLesson(${sIdx}, ${lIdx})" title="Save current grid as pattern">📸</button>
                  </div>
                </div>
            </div>
          `;
        lessonsContainer.appendChild(lessonEl);
      });
    }

    container.appendChild(sectionEl);
  });
}

function removeSection(sIdx) {
  if (confirm("Delete section and all its lessons?")) {
    currentCourseData.sections.splice(sIdx, 1);
    renderCourseStructure();
  }
}

function capturePatternForLesson(sIdx, lIdx) {
  // Manual capture fallback
  currentCourseData.sections[sIdx].lessons[lIdx].pattern_json = serializePattern();
  currentCourseData.sections[sIdx].lessons[lIdx].pattern_name = ""; // Clear name since it's manual
  renderCourseStructure(); // Re-render to show "Capture Current Grid" selected
  alert("Lesson pattern updated to current grid state!");
}


// ===== Event listeners ===== //

const courseModal = document.getElementById('courseModal');
const openCourseBtn = document.getElementById('openCourseModalBtn');
const closeCourseBtn = document.getElementById('closeCourseModal');

async function openCourseCreator() {
  await loadPatternOptions(); // Fetch patterns before opening

  courseModal.classList.add('open');
  courseModal.setAttribute('aria-hidden', 'false');
  // Initialize with one empty section if new
  if (currentCourseData.sections.length === 0 && !currentCourseData.id) {
    currentCourseData.sections.push({ title: "Section 1", lessons: [] });
    expandedSections.add(0);
  }
  renderCourseStructure();
}

window.loadCourseToEdit = async function (course) {
  await loadPatternOptions(); // Fetch patterns first

  currentCourseData = JSON.parse(JSON.stringify(course)); // Deep copy to avoid mutating original
  document.getElementById('courseTitle').value = course.title;
  document.getElementById('courseDesc').value = course.description;

  const saveBtn = document.getElementById('saveCourseBtn');
  saveBtn.textContent = "Update Course";

  // Collapse all by default on edit
  expandedSections.clear();

  openCourseCreator();
};

function closeCourseCreator() {
  courseModal.classList.remove('open');
  courseModal.setAttribute('aria-hidden', 'true');
}

// Listeners
openCourseBtn?.addEventListener('click', openCourseCreator);
closeCourseBtn?.addEventListener('click', closeCourseCreator);

// Close on clicking the dark overlay
courseModal?.addEventListener('click', (e) => {
  if (e.target === courseModal) {
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
        pattern_name: lesson.pattern_name,
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