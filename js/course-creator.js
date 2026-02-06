import { currentUser, isAdminUser } from './auth.js';
import { dbListPatternNames, dbLoadPatternByName, getSavedPatterns, serializePattern } from './pattern-crud.js';
import { supabase } from './supabase-client.js';

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

export function initCourseCreator() {
  const list = document.getElementById('courseStructure');
  if (list) {
    // Centralized Event Delegation
    list.addEventListener('click', handleCourseCreatorClick);
    list.addEventListener('change', handleCourseCreatorChange);
    // Drag events need careful handling, might keep direct listeners in render or delegate
    // Delegation for drag is tricky due to dragstart needing the element.
    // We can attach drag listeners in render or use delegation if we are careful.
    // Keeping render-attached drag listeners is fine for now as they are specific.
  }

  // Bind main buttons
  document.getElementById('openCourseModalBtn')?.addEventListener('click', openCourseCreator);
  document.getElementById('closeCourseModal')?.addEventListener('click', closeCourseCreator);
  document.getElementById('courseModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'courseModal') closeCourseCreator();
  });
  document.getElementById('addSectionBtn')?.addEventListener('click', addSection);

  document.getElementById('saveCourseBtn')?.addEventListener('click', () => handleCourseSave(true));
  document.getElementById('saveAndContinueBtn')?.addEventListener('click', () => handleCourseSave(false));
}


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

// --- Event Delegation Handlers ---

function handleCourseCreatorClick(e) {
  const target = e.target.closest('button, .lesson-header-bar');
  if (!target) return;

  // Prevent event bubbling issues if clicking nested elements
  if (e.target.closest('input') || e.target.closest('select') || e.target.closest('textarea')) return;

  const action = target.dataset.action;
  const sIdx = parseInt(target.dataset.sidx);
  const lIdx = parseInt(target.dataset.lidx);

  if (action === 'toggleSection') {
    toggleSection(sIdx);
  } else if (action === 'removeSection') {
    removeSection(sIdx);
  } else if (action === 'addLesson') {
    addLessonToSection(sIdx);
  } else if (action === 'toggleLesson' || action === 'toggleLessonHeader') {
    // If header clicked, ensure we didn't click a button inside it (which is handled separately by closest)
    // But closest finds the outer div too.
    // If we clicked the button, target is button. If we clicked div, target is div.
    // We only want to toggle if action is explicitly set.
    toggleLesson(sIdx, lIdx);
  } else if (action === 'removeLesson') {
    handleRemoveClick(target, sIdx, lIdx);
  } else if (action === 'uploadVideo') {
    triggerLessonVideoUpload(sIdx, lIdx);
  } else if (action === 'capturePattern') {
    capturePatternForLesson(sIdx, lIdx);
  }
}

function handleCourseCreatorChange(e) {
  const target = e.target;
  const field = target.dataset.field;
  const sIdx = parseInt(target.dataset.sidx);
  const lIdx = parseInt(target.dataset.lidx);

  if (!field) return;

  if (field === 'section-title') {
    currentCourseData.sections[sIdx].title = target.value;
  } else if (field === 'section-published') {
    currentCourseData.sections[sIdx].is_published = target.checked;
    renderCourseStructure();
  } else if (field === 'lesson-title') {
    currentCourseData.sections[sIdx].lessons[lIdx].title = target.value;
  } else if (field === 'lesson-desc') {
    currentCourseData.sections[sIdx].lessons[lIdx].description = target.value;
  } else if (field === 'lesson-video') {
    currentCourseData.sections[sIdx].lessons[lIdx].video_url = target.value;
  } else if (field === 'lesson-pattern') {
    handlePatternSelect(target, sIdx, lIdx);
  }
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
      const btn = selectEl.nextElementSibling; // The 'Update' button (capture btn)
      // Actually capture btn is unrelated to select feedback, but maybe useful to flash something?
      selectEl.style.backgroundColor = '#dff0d8';
      setTimeout(() => selectEl.style.backgroundColor = '', 500);
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
    lessons: [],
    is_published: false // Default to draft
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
  if (!container) return;
  container.innerHTML = '';

  currentCourseData.sections.forEach((section, sIdx) => {
    const isExpanded = expandedSections.has(sIdx);

    const sectionEl = document.createElement('div');
    sectionEl.className = 'section-builder';
    sectionEl.setAttribute('draggable', 'true');
    sectionEl.dataset.sidx = sIdx;

    // Drag Events (Keep specific handlers for now to ensure correct data transfer)
    sectionEl.addEventListener('dragstart', (e) => courseDragStart(e, 'section', sIdx));
    sectionEl.addEventListener('dragover', courseDragOver);
    sectionEl.addEventListener('dragenter', courseDragEnter);
    sectionEl.addEventListener('dragleave', courseDragLeave);
    sectionEl.addEventListener('drop', (e) => courseDrop(e, 'section', sIdx));
    sectionEl.addEventListener('dragend', courseDragEnd);


    sectionEl.innerHTML = `
      <div class="section-header-bar" style="${!section.is_published ? 'border-bottom: 2px dashed #f39c12;' : ''}">
          <div class="drag-handle" title="Drag to reorder section">☰</div>
          <button class="toggle-btn" data-action="toggleSection" data-sidx="${sIdx}">
             ${isExpanded ? '▼' : '▶'}
          </button>
          <div class="section-title-input">
             <input type="text" value="${section.title}" data-field="section-title" data-sidx="${sIdx}" placeholder="Section Title">
          </div>
          
          <div class="section-publish-toggle" style="margin-right: 10px; display: flex; align-items: center; gap: 5px;">
             <input type="checkbox" id="sec-pub-${sIdx}" 
                ${section.is_published ? 'checked' : ''} 
                data-field="section-published" data-sidx="${sIdx}">
             <label for="sec-pub-${sIdx}" style="font-size: 0.8rem; cursor: pointer; color: ${section.is_published ? '#2ecc71' : '#f39c12'};">
                ${section.is_published ? 'Published' : 'Draft'}
             </label>
          </div>

          <button class="icon-btn remove-section-btn" data-action="removeSection" data-sidx="${sIdx}" title="Remove Section">&times;</button>
      </div>
      
      <div class="lessons-container ${isExpanded ? 'active' : ''}" id="section-${sIdx}-lessons" style="${!section.is_published ? 'opacity: 0.8;' : ''}"></div>
      
      ${isExpanded ? `<button class="add-lesson-btn" data-action="addLesson" data-sidx="${sIdx}">+ Add Lesson</button>` : ''}
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
        lessonEl.dataset.sidx = sIdx;
        lessonEl.dataset.lidx = lIdx;

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
            <div class="lesson-header-bar" data-action="toggleLessonHeader" data-sidx="${sIdx}" data-lidx="${lIdx}">
                <div class="lesson-drag-handle" title="Drag to reorder lesson">::</div>
                <button class="toggle-btn lesson-toggle-btn" data-action="toggleLesson" data-sidx="${sIdx}" data-lidx="${lIdx}">
                     ${isLessonExpanded ? '▼' : '▶'}
                </button>
                <input type="text" class="lesson-title-input" value="${lesson.title}" placeholder="Lesson Title" data-field="lesson-title" data-sidx="${sIdx}" data-lidx="${lIdx}">
                <button class="icon-btn remove-btn-small" data-action="removeLesson" data-sidx="${sIdx}" data-lidx="${lIdx}" title="Remove Lesson">&times;</button>
            </div>

            <div class="lesson-content ${isLessonExpanded ? 'active' : ''}">
                <textarea placeholder="Description" data-field="lesson-desc" data-sidx="${sIdx}" data-lidx="${lIdx}">${lesson.description}</textarea>
                <div class="input-with-icon">
                    <span>📺</span>
                    <input type="text" value="${lesson.video_url}" placeholder="YouTube URL or Uploaded Video" data-field="lesson-video" data-sidx="${sIdx}" data-lidx="${lIdx}">
                    <button class="small-upload-btn" data-action="uploadVideo" data-sidx="${sIdx}" data-lidx="${lIdx}" title="Upload Video File">📤</button>
                </div>
                
                <div class="lesson-meta-box">
                  <div class="meta-label">ASSOCIATED PATTERN</div>
                  <div class="pattern-control-row">
                    <select class="pattern-select" data-field="lesson-pattern" data-sidx="${sIdx}" data-lidx="${lIdx}">
                      <option value="">-- Capture Current Grid --</option>
                      ${patternOptions}
                    </select>
                    <button class="small-capture-btn" data-action="capturePattern" data-sidx="${sIdx}" data-lidx="${lIdx}" title="Save current grid as pattern">📸</button>
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

async function triggerLessonVideoUpload(sIdx, lIdx) {
  if (!currentUser) return alert("Please sign in to upload videos.");
  if (typeof isAdminUser === 'function' && !isAdminUser(currentUser)) {
    return alert("Only admins can upload videos.");
  }

  // Using existing mediaInput if possible, or create a temporary one
  let fileInput = document.getElementById('lessonVideoInput');
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'lessonVideoInput';
    fileInput.style.display = 'none';
    fileInput.accept = 'video/*';
    document.body.appendChild(fileInput);
  }

  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Size limit check (e.g. 50MB)
    if (file.size > 50 * 1024 * 1024) {
      alert("Video file is too large. Max 50MB.");
      return;
    }

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${currentUser.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      console.log("Uploading video...", fileName);
      // We can't easily show "Uploading..." in the input without triggering a save/render loop if we modified data.
      // But we CAN modify the input value in DOM if we find it.
      const inputs = document.querySelectorAll(`[data-field="lesson-video"]`);
      let inputEl = null;
      inputs.forEach(el => {
        if (parseInt(el.dataset.sidx) === sIdx && parseInt(el.dataset.lidx) === lIdx) inputEl = el;
      });

      if (inputEl) inputEl.value = "Uploading...";

      const { data, error } = await supabase.storage // Updated to use imported supabase
        .from('lesson-videos')
        .upload(fileName, file);

      if (error) throw error;

      const { data: publicData } = supabase.storage.from('lesson-videos').getPublicUrl(fileName); // Updated
      const publicUrl = publicData.publicUrl;

      // Update state
      currentCourseData.sections[sIdx].lessons[lIdx].video_url = publicUrl;

      // Update UI
      renderCourseStructure(); // Safest to just re-render

      console.log("Upload successful:", publicUrl);

    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload failed: " + err.message);
      renderCourseStructure(); // Revert
    }
  };

  fileInput.click();
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
  const contBtn = document.getElementById('saveAndContinueBtn');
  if (saveBtn) saveBtn.textContent = "Update Course";
  if (contBtn) contBtn.textContent = "Update & Continue";

  // Collapse all by default on edit
  expandedSections.clear();

  openCourseCreator();
};

export function closeCourseCreator() {
  courseModal.classList.remove('open');
  courseModal.setAttribute('aria-hidden', 'true');
}

window.closeCourseCreator = closeCourseCreator;

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


// ===== SAVE ===== //


const saveCourseBtn = document.getElementById('saveCourseBtn');
const saveAndContinueBtn = document.getElementById('saveAndContinueBtn');

async function handleCourseSave(shouldClose = true) {
  const activeBtn = shouldClose ? saveCourseBtn : saveAndContinueBtn;
  const originalText = activeBtn.textContent;

  console.log("Save clicked! shouldClose:", shouldClose);

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

  activeBtn.disabled = true;
  activeBtn.textContent = "Saving...";

  try {
    // 1. Check if Updating or Creating
    let courseId = currentCourseData.id;
    console.log("Course ID:", courseId, courseId ? "UPDATE MODE" : "CREATE MODE");

    if (courseId) {
      // === UPDATE Metatdata ===
      const { error: uErr } = await supabase
        .from('courses')
        .update({ title, description })
        .eq('id', courseId);
      if (uErr) throw uErr;
    } else {
      // === CREATE New Course ===
      const { data: newCourse, error: cErr } = await supabase
        .from('courses')
        .insert([{
          title,
          description,
          owner_id: currentUser.id,
          is_published: false // Explicitly draft
        }])
        .select().single();
      if (cErr) throw cErr;
      courseId = newCourse.id;
      // Update local ref
      currentCourseData.id = courseId;
    }

    // 2. Upsert Sections & Lessons
    console.log("Upserting sections and lessons...");
    const keptSectionIds = [];
    const keptLessonIds = [];

    for (let sIdx = 0; sIdx < currentCourseData.sections.length; sIdx++) {
      const sData = currentCourseData.sections[sIdx];
      let sId = sData.id;

      if (sId) {
        // Update Existing Section
        const { error: sUpdErr } = await supabase
          .from('sections')
          .update({
            title: sData.title,
            order_index: sIdx,
            is_published: sData.is_published
          })
          .eq('id', sId);
        if (sUpdErr) throw sUpdErr;
      } else {
        // Insert New Section
        const { data: newSec, error: sInsErr } = await supabase
          .from('sections')
          .insert([{
            course_id: courseId,
            title: sData.title,
            order_index: sIdx,
            is_published: sData.is_published ?? false
          }])
          .select().single();
        if (sInsErr) throw sInsErr;
        sId = newSec.id;
        sData.id = sId; // Update local state
      }
      keptSectionIds.push(sId);

      // Handle Lessons for this Section
      for (let lIdx = 0; lIdx < sData.lessons.length; lIdx++) {
        const lData = sData.lessons[lIdx];
        let lId = lData.id;
        const lPayload = {
          section_id: sId,
          title: lData.title,
          description: lData.description || "",
          video_url: lData.video_url || "",
          pattern_json: lData.pattern_json,
          pattern_name: lData.pattern_name,
          order_index: lIdx
        };

        if (lId) {
          // Update Existing Lesson
          const { error: lUpdErr } = await supabase
            .from('lessons')
            .update(lPayload)
            .eq('id', lId);
          if (lUpdErr) throw lUpdErr;
        } else {
          // Insert New Lesson
          const { data: newLes, error: lInsErr } = await supabase
            .from('lessons')
            .insert([lPayload])
            .select().single();
          if (lInsErr) throw lInsErr;
          lId = newLes.id;
          lData.id = lId; // Update local state
        }
        keptLessonIds.push(lId);
      }
    }

    // 3. Prune Orphans
    console.log("Pruning orphans...");

    // A. Delete Removed Lessons (from kept sections)
    if (keptSectionIds.length > 0) {
      const { data: existingLessons } = await supabase
        .from('lessons')
        .select('id')
        .in('section_id', keptSectionIds);

      if (existingLessons) {
        const toDeleteIds = existingLessons
          .map(l => l.id)
          .filter(id => !keptLessonIds.includes(id));

        if (toDeleteIds.length > 0) {
          console.log("Deleting orphaned lessons:", toDeleteIds);
          await supabase.from('lessons').delete().in('id', toDeleteIds);
        }
      }
    }

    // B. Delete Removed Sections
    const { data: existingSections } = await supabase
      .from('sections')
      .select('id')
      .eq('course_id', courseId);

    if (existingSections) {
      const secToDelete = existingSections
        .map(s => s.id)
        .filter(id => !keptSectionIds.includes(id));

      if (secToDelete.length > 0) {
        console.log("Deleting orphaned sections:", secToDelete);
        await supabase.from('lessons').delete().in('section_id', secToDelete);
        await supabase.from('sections').delete().in('id', secToDelete);
      }
    }

    console.log("Save successful!");

    if (shouldClose) {
      alert("Course saved successfully!");
      closeCourseCreator();
      // Reset form
      currentCourseData = { title: "", description: "", sections: [] };
      document.getElementById('courseTitle').value = "";
      document.getElementById('courseDesc').value = "";
      saveCourseBtn.textContent = "Save Course";
    } else {
      // Show flashing "Saved!" message for 3 seconds
      const statusSpan = document.getElementById('courseSaveStatus');
      if (statusSpan) {
        statusSpan.style.opacity = "1";
        setTimeout(() => {
          statusSpan.style.opacity = "0";
        }, 3000);
      }

      // Update button labels to "Update" since it's no longer a brand new course
      if (saveCourseBtn) saveCourseBtn.textContent = "Update Course";
      if (saveAndContinueBtn) saveAndContinueBtn.textContent = "Update & Continue";

      setTimeout(() => {
        // Restore button text after "Saving..."
        activeBtn.textContent = shouldClose ? "Update Course" : "Update & Continue";
      }, 1500);
      // We do NOT reset currentCourseData or title/desc
    }

    // Dispatch event to notify other modules (like courses.js) to refresh
    window.dispatchEvent(new CustomEvent('course-data-changed'));

  } catch (err) {
    console.error("Error saving course (catch block):", err);
    alert(`Failed to save course: ${err.message}`);
  } finally {
    activeBtn.disabled = false;
    if (shouldClose) {
      activeBtn.textContent = originalText;
    }
  }
}

// Remove window assignments except where absolutely necessary (e.g. debugging)
// All handlers should be bound via initCourseCreator or event delegation.