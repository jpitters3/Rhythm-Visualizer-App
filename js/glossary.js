import { alert, confirm } from './alert.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';

let glossaryTerms = [];
let availableCourses = [];

// DOM Elements - Admin
let adminModal, openAdminBtn, closeAdminBtn, newTermBtn, saveTermBtn, deleteTermBtn, termListEl, searchInput, saveStatus;

// Form Inputs
let idInput, termInput, defInput, videoInput, courseSelector;

// DOM Elements - Viewer
let viewerModal, closeViewerBtn, gvTitle, gvDefinition, gvVideoContainer, gvVideoFrame, gvVideoPlayer, gvRelatedCoursesSection, gvRelatedCoursesList;

export async function initGlossary() {
  // Global event delegation for glossary links
  document.body.addEventListener('click', (e) => {
    // 1. Check if clicking a glossary link in text
    const link = e.target.closest('.glossary-link');
    if (link) {
      e.preventDefault(); // Prevent default anchor jump
      const slug = link.getAttribute('data-slug');
      if (slug) {
        openGlossaryTerm(slug);
      }
      return;
    }

    // 2. Check Admin Open Button
    if (e.target.id === 'openGlossaryModalBtn' || e.target.closest('#openGlossaryModalBtn')) {
      const modal = document.getElementById('glossaryAdminModal');
      if (modal) {
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        loadCoursesForSelector().then(() => {
          clearForm();
          renderTermList();
        });
      }
      return;
    }
  });

  // Grab standard DOM elements
  adminModal = document.getElementById('glossaryAdminModal');
  openAdminBtn = document.getElementById('openGlossaryModalBtn');
  closeAdminBtn = document.getElementById('closeGlossaryAdminBtn');
  newTermBtn = document.getElementById('newGlossaryTermBtn');
  saveTermBtn = document.getElementById('saveGlossaryTermBtn');
  deleteTermBtn = document.getElementById('deleteGlossaryTermBtn');
  termListEl = document.getElementById('glossaryTermList');
  searchInput = document.getElementById('glossarySearchInput');
  saveStatus = document.getElementById('glossarySaveStatus');

  idInput = document.getElementById('glossaryId');
  termInput = document.getElementById('glossaryTermInput');
  defInput = document.getElementById('glossaryDefinitionInput');
  videoInput = document.getElementById('glossaryVideoInput');
  courseSelector = document.getElementById('glossaryCourseSelector');

  viewerModal = document.getElementById('glossaryViewerModal');
  closeViewerBtn = document.getElementById('closeGlossaryViewerBtn');
  gvTitle = document.getElementById('gvTitle');
  gvDefinition = document.getElementById('gvDefinition');
  gvVideoContainer = document.getElementById('gvVideoContainer');
  gvVideoFrame = document.getElementById('gvVideoFrame');
  gvVideoPlayer = document.getElementById('gvVideoPlayer');
  gvRelatedCoursesSection = document.getElementById('gvRelatedCoursesSection');
  gvRelatedCoursesList = document.getElementById('gvRelatedCoursesList');

  await fetchGlossaryTerms();
  setupAdminEventListeners();
  setupViewerEventListeners();

  // Attempt auto-open if hash is present
  if (window.location.hash.startsWith('#glossary-')) {
    const slug = window.location.hash.replace('#glossary-', '');
    openGlossaryTerm(slug);
  }
}

async function fetchGlossaryTerms() {
  try {
    const { data, error } = await supabase
      .from('glossary_terms')
      .select('*')
      .order('term', { ascending: true });

    if (error) throw error;
    glossaryTerms = data || [];
    renderTermList();
  } catch (err) {
    console.error("Error fetching glossary terms:", err);
  }
}

// --- Text Auto-Linker Engine ---

/**
 * Takes raw text, finds the longest glossary terms, and converts them to clickable links.
 */
export function autoLinkText(text) {
  if (!text || glossaryTerms.length === 0) return text;

  // 1. Sort terms by length descending. 
  // This prevents "chord" from matching inside "chord progression".
  const sortedTerms = [...glossaryTerms].sort((a, b) => b.term.length - a.term.length);

  let linkedText = text;

  // 2. Wrap terms with a special marker first to avoid re-replacing inside HTML attributes
  // e.g. We don't want to replace "chord" if it's already inside <a href="...chord...">
  const placeholders = [];

  sortedTerms.forEach((termObj) => {
    // Escape regex special characters in the term
    const escapedTerm = termObj.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Word boundary \b ensures we match "pan" but not "hand*pan*"
    // We use 'gi' for global, case-insensitive match
    const regex = new RegExp(`\\b(${escapedTerm})\\b`, 'gi');

    linkedText = linkedText.replace(regex, (match) => {
      const index = placeholders.length;
      placeholders.push({
        match: match,
        slug: termObj.slug
      });
      return `%%GLOSSARY_${index}%%`;
    });
  });

  // 3. Replace placeholders with actual HTML anchor tags
  placeholders.forEach((placeholder, i) => {
    const regex = new RegExp(`%%GLOSSARY_${i}%%`, 'g');
    const linkHTML = `<a href="#glossary-${placeholder.slug}" class="glossary-link" data-slug="${placeholder.slug}">${placeholder.match}</a>`;
    linkedText = linkedText.replace(regex, linkHTML);
  });

  return linkedText;
}


// --- Admin Panel Logic ---

function setupAdminEventListeners() {
  if (closeAdminBtn) {
    closeAdminBtn.addEventListener('click', () => {
      adminModal.classList.remove('open');
      adminModal.setAttribute('aria-hidden', 'true');
    });
  }

  if (newTermBtn) {
    newTermBtn.addEventListener('click', clearForm);
  }

  if (searchInput) {
    searchInput.addEventListener('input', renderTermList);
  }

  if (saveTermBtn) {
    saveTermBtn.addEventListener('click', async () => await saveTerm());
  }

  if (deleteTermBtn) {
    deleteTermBtn.addEventListener('click', async () => await deleteTerm());
  }

  // Video Upload
  const uploadBtn = document.getElementById('uploadGlossaryVideoBtn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', triggerVideoUpload);
  }
}

async function loadCoursesForSelector() {
  if (availableCourses.length === 0) {
    const { data: courses, error } = await supabase
      .from('courses')
      .select('id, title')
      .eq('is_published', true)
      .order('title', { ascending: true });

    if (error) {
      console.error("Error fetching courses for glossary:", error);
    }
    availableCourses = courses || [];
  }

  courseSelector.innerHTML = '';
  availableCourses.forEach(course => {
    const label = document.createElement('label');
    label.className = 'glossary-course-checkbox';
    label.innerHTML = `
            <input type="checkbox" value="${course.id}">
            <span>${course.title}</span>
        `;
    courseSelector.appendChild(label);
  });
}

function renderTermList() {
  termListEl.innerHTML = '';
  const query = searchInput.value.toLowerCase();

  glossaryTerms
    .filter(t => t.term.toLowerCase().includes(query))
    .forEach(termObj => {
      const div = document.createElement('div');
      div.className = 'glossary-term-item';
      div.textContent = termObj.term;
      if (idInput.value === termObj.id) {
        div.classList.add('active');
      }
      div.addEventListener('click', () => loadTermIntoForm(termObj));
      termListEl.appendChild(div);
    });
}

function clearForm() {
  idInput.value = '';
  termInput.value = '';
  defInput.value = '';
  videoInput.value = '';
  deleteTermBtn.style.display = 'none';

  document.querySelectorAll('#glossaryCourseSelector input').forEach(cb => {
    cb.checked = false;
  });

  renderTermList(); // Update active state
}

function loadTermIntoForm(termObj) {
  idInput.value = termObj.id;
  termInput.value = termObj.term;
  defInput.value = termObj.definition;
  videoInput.value = termObj.video_url || '';

  // Check related courses
  const relatedIds = termObj.related_course_ids || [];
  document.querySelectorAll('#glossaryCourseSelector input').forEach(cb => {
    cb.checked = relatedIds.includes(cb.value);
  });

  deleteTermBtn.style.display = 'block';
  renderTermList();
}

function generateSlug(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start of text
    .replace(/-+$/, '');            // Trim - from end of text
}

async function saveTerm() {
  const term = termInput.value.trim();
  const definition = defInput.value.trim();
  if (!term || !definition) {
    await alert("Term Name and Definition are required.");
    return;
  }

  const slug = generateSlug(term);
  const video_url = videoInput.value.trim();

  const selectedCourseIds = Array.from(document.querySelectorAll('#glossaryCourseSelector input:checked'))
    .map(cb => cb.value);

  const payload = {
    term,
    slug,
    definition,
    video_url,
    related_course_ids: selectedCourseIds
  };

  saveTermBtn.disabled = true;
  saveTermBtn.textContent = 'Saving...';

  try {
    if (idInput.value) {
      // Update Existing
      const { error } = await supabase
        .from('glossary_terms')
        .update(payload)
        .eq('id', idInput.value);
      if (error) throw error;
    } else {
      // Insert New
      const { data, error } = await supabase
        .from('glossary_terms')
        .insert([payload])
        .select().single();
      if (error) throw error;
      idInput.value = data.id; // Switch to edit mode
    }

    // Show success status
    saveStatus.style.opacity = '1';
    setTimeout(() => saveStatus.style.opacity = '0', 3000);

    // Refresh local array
    await fetchGlossaryTerms();

  } catch (err) {
    console.error("Save failed:", err);
    await alert("Save failed: " + err.message);
  } finally {
    saveTermBtn.disabled = false;
    saveTermBtn.textContent = 'Save Term';
  }
}

async function deleteTerm() {
  if (!idInput.value) return;
  if (!await confirm("Are you sure you want to delete this term? This cannot be undone.")) return;

  try {
    const { error } = await supabase
      .from('glossary_terms')
      .delete()
      .eq('id', idInput.value);
    if (error) throw error;

    clearForm();
    await fetchGlossaryTerms();
  } catch (err) {
    console.error("Delete failed:", err);
    await alert("Failed to delete term.");
  }
}

async function triggerVideoUpload() {
  // Reusing the same logic from Course Creator
  let fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'video/*';
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) return await alert("Video file is too large. Max 50MB.");

    try {
      videoInput.value = "Uploading...";
      const fileExt = file.name.split('.').pop();
      const fileName = `glossary/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error } = await supabase.storage.from('lesson-videos').upload(fileName, file);
      if (error) throw error;

      const { data } = supabase.storage.from('lesson-videos').getPublicUrl(fileName);
      videoInput.value = data.publicUrl;
    } catch (err) {
      console.error(err);
      videoInput.value = "";
      await alert("Upload failed.");
    }
  };
  fileInput.click();
}


// --- Viewer Logic (Student Facing) ---

function setupViewerEventListeners() {
  if (closeViewerBtn) {
    closeViewerBtn.addEventListener('click', () => {
      viewerModal.classList.remove('open');
      viewerModal.setAttribute('aria-hidden', 'true');
      // Clean up hash
      history.pushState('', document.title, window.location.pathname + window.location.search);
      // Stop video
      gvVideoFrame.src = "";
      gvVideoPlayer.pause();
    });
  }

  // Listen for hash changes
  window.addEventListener('hashchange', () => {
    if (window.location.hash.startsWith('#glossary-')) {
      const slug = window.location.hash.replace('#glossary-', '');
      openGlossaryTerm(slug);
    }
  });
}

// Simple markdown to HTML converter for definitions
function parseMarkdown(text) {
  let html = text;
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Blockquote
  html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');
  // Newlines to P tags
  html = html.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  return html;
}

export async function openGlossaryTerm(slug) {
  // If terms aren't loaded yet, try fetching
  if (glossaryTerms.length === 0) {
    await fetchGlossaryTerms();
  }

  const termObj = glossaryTerms.find(t => t.slug === slug);
  if (!termObj) {
    console.warn("Glossary term not found for slug:", slug);
    return;
  }

  // Populate Data
  gvTitle.textContent = termObj.term;
  gvDefinition.innerHTML = parseMarkdown(termObj.definition);

  // Handle Video
  if (termObj.video_url) {
    gvVideoContainer.style.display = 'block';
    if (termObj.video_url.includes('youtube.com') || termObj.video_url.includes('youtu.be')) {
      gvVideoPlayer.style.display = 'none';
      gvVideoFrame.style.display = 'block';
      let embedUrl = termObj.video_url;
      if (embedUrl.includes('watch?v=')) {
        embedUrl = embedUrl.replace('watch?v=', 'embed/');
      } else if (embedUrl.includes('/shorts/')) {
        embedUrl = embedUrl.replace('/shorts/', '/embed/');
      }
      if (!embedUrl.includes('rel=0')) {
        embedUrl += (embedUrl.includes('?') ? '&' : '?') + 'rel=0';
      }
      gvVideoFrame.src = embedUrl;
    } else {
      gvVideoFrame.style.display = 'none';
      gvVideoPlayer.style.display = 'block';
      gvVideoPlayer.src = termObj.video_url;
    }
  } else {
    gvVideoContainer.style.display = 'none';
    gvVideoFrame.src = '';
  }

  // Handle Related Courses
  if (termObj.related_course_ids && termObj.related_course_ids.length > 0) {
    gvRelatedCoursesSection.style.display = 'block';
    gvRelatedCoursesList.innerHTML = '<div style="opacity: 0.7; font-size: 14px;">Loading related courses...</div>';

    // Fetch specific courses
    const { data: courses } = await supabase
      .from('courses')
      .select(`id, title, description`)
      .in('id', termObj.related_course_ids)
      .eq('is_published', true);

    if (courses && courses.length > 0) {
      gvRelatedCoursesList.innerHTML = '';
      courses.forEach(course => {
        const card = document.createElement('div');
        card.className = 'course-card'; // Reuse existing CSS
        card.style.background = 'rgba(255,255,255,0.03)';
        card.style.border = '1px solid var(--panel-border)';
        card.style.cursor = 'pointer';
        card.innerHTML = `
                    <div class="course-info">
                        <h3>${course.title}</h3>
                        <p style="font-size:13px; margin:5px 0 0 0;">${course.description}</p>
                    </div>
                    <button class="primary-btn" style="height: 32px; padding: 15px; font-size: 13px;">View</button>
                `;
        card.addEventListener('click', () => {
          // Close glossary modal
          document.getElementById('closeGlossaryViewerBtn').click();

          // Request courses.js to open this course
          Bus.emit(BUS_EVENT.OPEN_COURSE, { courseId: course.id });
        });
        gvRelatedCoursesList.appendChild(card);
      });
    } else {
      gvRelatedCoursesSection.style.display = 'none';
    }
  } else {
    gvRelatedCoursesSection.style.display = 'none';
  }

  // Open Modal
  viewerModal.classList.add('open');
  viewerModal.setAttribute('aria-hidden', 'false');

  // Ensure URL matches
  if (window.location.hash !== `#glossary-${slug}`) {
    history.pushState(null, null, `#glossary-${slug}`);
  }
}
