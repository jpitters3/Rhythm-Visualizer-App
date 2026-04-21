/* Handpan Calibration Logic */
import { supabase } from './supabase-client.js';
import { alert } from './alert.js';

const CAL_PITCHES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

let currentHandpanId = null;
let currentHandpanData = null; // Store full record to access image_rotation
let currentNoteMap = []; // Array of objects { id, x, y, r, note, octave, width, height, rotation }
let selectedTonefieldId = null;
let lastAssignedPitchIndex = 2; // Default starting at D (Index 2)
let lastAssignedOctave = 3;     // Default starting at 3

let saveTimeout = null;
let onCalibrationDone = null; // Callback for when "Done" is clicked

let currentWizardStep = 1;

// DOM Elements
let calOverlay = null;
let calHandpanName = null;
let calHandpanImage = null;
let calTonefieldsLayer = null;
let calPropertiesPanel = null;
let calPitchSelect = null;
let calOctaveSelect = null;
let calNumberSelect = null;
let calSaveStatus = null;
let calImgRotInput = null;
let valImgRot = null;
let calPropTitle = null;
let calNoteProps = null;
let calGlobalProps = null;
let calSizeInput = null;
let valSize = null;
let calShapeInput = null;
let valShape = null;
let calRotInput = null;
let valRot = null;
let addTonefieldBtn = null;
let autoDetectBtn = null;
let deleteTonefieldBtn = null;
let calDoneBtn = null;

// Initialize Dropdowns
function initCalDropdowns() {
  if (!calPitchSelect) return;
  calPitchSelect.innerHTML = CAL_PITCHES.map(p => `<option value="${p}">${p}</option>`).join('');

  // Custom Numbers: D, 1..20
  if (calNumberSelect) {
    const opts = ['Ding'];
    for (let i = 1; i <= 20; i++) opts.push(String(i));
    calNumberSelect.innerHTML = opts.map(n => `<option value="${n}">${n}</option>`).join('');
  }
}

// === ENTRY POINT ===
export async function enterCalibrationMode(handpanData, onDone = null) {
  if (!handpanData) return;
  initCalDropdowns();

  onCalibrationDone = onDone;

  currentHandpanData = handpanData;
  currentHandpanId = handpanData.id;
  currentHandpanId = handpanData.id;
  currentNoteMap = handpanData.note_map || [];
  currentCalibrationSide = 'top'; // Reset

  // Reset UI
  if (calHandpanName) calHandpanName.textContent = `Calibrating: ${handpanData.name}`;

  // Helper to load image
  loadCalibrationImage(handpanData.top_image_url);

  // Show/Hide Flip Button
  const flipBtn = document.getElementById('calFlipBtn');
  if (flipBtn) {
    flipBtn.style.display = handpanData.bottom_image_url ? 'block' : 'none';
    flipBtn.onclick = () => toggleCalibrationSide();
  }
}

let currentCalibrationSide = 'top';

function toggleCalibrationSide() {
  if (!currentHandpanData || !currentHandpanData.bottom_image_url) return;

  // Save current selection before flip?
  selectTonefield(null);

  currentCalibrationSide = (currentCalibrationSide === 'top') ? 'bottom' : 'top';

  const imgUrl = (currentCalibrationSide === 'top') ? currentHandpanData.top_image_url : currentHandpanData.bottom_image_url;
  loadCalibrationImage(imgUrl);

  renderTonefields();
}

function loadCalibrationImage(src) {
  if (calHandpanImage) {
    calHandpanImage.crossOrigin = 'anonymous';
    calHandpanImage.onload = function () {
      if (!this.naturalWidth || !this.naturalHeight) return;

      const container = document.getElementById('calCanvasContainer');
      if (!container) return;

      // Sync container aspect ratio to image
      container.style.aspectRatio = `${this.naturalWidth} / ${this.naturalHeight}`;
    };

    calHandpanImage.src = src;

    // Apply Image Rotation (separate per side)
    const imgRot = currentCalibrationSide === 'bottom'
      ? (currentHandpanData.bottom_image_rotation || 0)
      : (currentHandpanData.image_rotation || 0);
    calHandpanImage.style.transform = `rotate(${imgRot}deg)`;
    if (calImgRotInput) calImgRotInput.value = imgRot;
    if (valImgRot) valImgRot.textContent = imgRot + '°';
  }

  // Render existing dots
  renderTonefields();

  // Show Overlay
  if (calOverlay) {
    calOverlay.style.display = 'flex';
    calOverlay.setAttribute('aria-hidden', 'false');
  }

  // Reset selection (Show Global Props by default)
  selectTonefield(null);
}

function renderTonefields() {
  if (!calTonefieldsLayer) return;
  calTonefieldsLayer.innerHTML = '';
  currentNoteMap.forEach((tf, index) => {
    const side = tf.side || 'top';
    if (side === currentCalibrationSide) {
      createTonefieldDOM(tf, index);
    }
  });
}

function createTonefieldDOM(tf, index) {
  if (!calTonefieldsLayer) return;
  const el = document.createElement('div');
  el.className = 'tonefield';
  el.id = `tf-${tf.id}`;

  updateTonefieldVisuals(el, tf);

  // Label
  const label = document.createElement('span');
  label.className = 'tf-label';
  label.textContent = `${tf.note}${tf.octave}`;
  el.appendChild(label);

  // Events
  el.addEventListener('pointerdown', (e) => onTonefieldPointerDown(e, tf.id));

  calTonefieldsLayer.appendChild(el);
}

function updateTonefieldVisuals(el, tf) {
  el.style.left = `${tf.x}%`;
  el.style.top = `${tf.y}%`;

  let w = tf.width || (tf.r * 2) || 12;
  let h = tf.height || (tf.r * 2) || 12;
  let rot = tf.rotation || 0;

  el.style.width = `${w}%`;
  el.style.height = 'auto'; // Let aspect-ratio handle height
  el.style.aspectRatio = `${w} / ${h}`;
  el.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
}

// === INTERACTION ===

let activePointers = new Map();
let initialPinchDist = 0;
let initialPinchAngle = 0;
let initialTfState = null;

function onTonefieldPointerDown(e, id) {
  e.stopPropagation();
  e.preventDefault();

  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);

  selectTonefield(id);
  activePointers.set(e.pointerId, e);

  const tf = currentNoteMap.find(t => t.id === id);
  if (!tf) return;

  const container = document.getElementById('calCanvasContainer');
  const rect = container.getBoundingClientRect();

  // Initial State for Dragging
  const startX = e.clientX;
  const startY = e.clientY;
  const startLeft = tf.x;
  const startTop = tf.y;

  if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    initialPinchDist = Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY);
    initialPinchAngle = Math.atan2(pts[1].clientY - pts[0].clientY, pts[1].clientX - pts[0].clientX);
    initialTfState = { width: tf.width, height: tf.height, rotation: tf.rotation };
  }

  el.classList.add('dragging');

  function onMove(ev) {
    if (!activePointers.has(ev.pointerId)) return;
    activePointers.set(ev.pointerId, ev);

    if (activePointers.size === 1) {
      // DRAG LOGIC
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const w = rect.width || 1;
      const h = rect.height || 1;

      tf.x = Math.max(0, Math.min(100, startLeft + (dx / w) * 100));
      tf.y = Math.max(0, Math.min(100, startTop + (dy / h) * 100));

      updateTonefieldVisuals(el, tf);
    }
    else if (activePointers.size === 2 && initialTfState) {
      // PINCH & ROTATE LOGIC
      const pts = Array.from(activePointers.values());
      const currentDist = Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY);
      const currentAngle = Math.atan2(pts[1].clientY - pts[0].clientY, pts[1].clientX - pts[0].clientX);

      const distRatio = currentDist / (initialPinchDist || 1);
      const angleDiff = (currentAngle - initialPinchAngle) * (180 / Math.PI);

      tf.width = Math.max(5, Math.min(50, initialTfState.width * distRatio));
      tf.height = Math.max(5, Math.min(50, initialTfState.height * distRatio));
      tf.rotation = (initialTfState.rotation + angleDiff) % 360;

      updateTonefieldVisuals(el, tf);
    }
  }

  function onUp(ev) {
    activePointers.delete(ev.pointerId);
    if (activePointers.size < 2) {
      initialTfState = null;
    }
    if (activePointers.size === 0) {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.classList.remove('dragging');
      triggerAutoSave();
    }
  }

  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

function selectTonefield(id) {
  selectedTonefieldId = id;

  // Show Panel
  if (calPropertiesPanel) calPropertiesPanel.style.display = 'block';

  // Toggle Selection Visuals
  document.querySelectorAll('.tonefield').forEach(el => el.classList.remove('selected'));

  if (id) {
    // === NOTE MODE ===
    if (calPropTitle) calPropTitle.textContent = "Note Settings";
    if (calNoteProps) calNoteProps.style.display = 'block';
    if (calGlobalProps) calGlobalProps.style.display = 'none';

    // Reset Wizard to Step 1
    currentWizardStep = 1;
    updateWizardUI();

    const el = document.getElementById(`tf-${id}`);
    if (el) el.classList.add('selected');

    const tf = currentNoteMap.find(t => t.id === id);
    if (tf) {
      if (calPitchSelect) calPitchSelect.value = tf.note;
      if (calOctaveSelect) calOctaveSelect.value = tf.octave;
      if (calNumberSelect) calNumberSelect.value = tf.assignedNumber || '1';

      // Load Advanced Props (with defaults)
      const r = tf.r || 6;
      const w = tf.width || (r * 2);
      const h = tf.height || (r * 2);

      // Size = Width
      if (calSizeInput) calSizeInput.value = w;
      if (valSize) valSize.textContent = Math.round(w);

      // Shape = Width / Height ratio? Or just direct H manipulation?
      // Let's define Shape as Aspect Ratio (Height / Width). 1 = Circle. < 1 = Squashed.
      const ratio = w > 0 ? (h / w) : 1; // Avoid division by zero
      if (calShapeInput) calShapeInput.value = ratio;
      if (valShape) valShape.textContent = ratio.toFixed(2);

      // Rotation
      const rot = tf.rotation || 0;
      if (calRotInput) calRotInput.value = rot;
      if (valRot) valRot.textContent = rot + '°';
    }
  } else {
    // === GLOBAL MODE ===
    if (calPropTitle) calPropTitle.textContent = "Handpan Settings";
    if (calNoteProps) calNoteProps.style.display = 'none';
    if (calGlobalProps) calGlobalProps.style.display = 'block';

    // Load Global Props
    const imgRot = currentHandpanData?.image_rotation || 0;
    if (calImgRotInput) calImgRotInput.value = imgRot;
    if (valImgRot) valImgRot.textContent = imgRot + '°';
  }
}

function updateWizardUI() {
  const steps = document.querySelectorAll('.wizard-step');
  steps.forEach(s => {
    const stepNum = parseInt(s.getAttribute('data-step'));
    s.classList.toggle('active', stepNum === currentWizardStep);
  });

  const info = document.getElementById('wizardStepInfo');
  if (info) info.textContent = `Step ${currentWizardStep}/5`;

  const backBtn = document.getElementById('wizardBack');
  const nextBtn = document.getElementById('wizardNext');

  if (backBtn) backBtn.disabled = (currentWizardStep === 1);
  if (nextBtn) {
    if (currentWizardStep === 5) {
      nextBtn.textContent = 'Finish';
      nextBtn.style.background = 'rgba(0, 200, 83, 0.4)';
    } else {
      nextBtn.textContent = 'Next';
      nextBtn.style.background = '';
    }
  }
}

// Update Note Prop
function updateSelectedTf(prop, value) {
  if (!selectedTonefieldId) return;
  const tf = currentNoteMap.find(t => t.id === selectedTonefieldId);
  if (!tf) return;

  tf[prop] = value;

  if (prop === 'note' || prop === 'octave') {
    updateTonefieldLabel(selectedTonefieldId, tf);
    if (prop === 'note') lastAssignedPitchIndex = CAL_PITCHES.indexOf(value);
    if (prop === 'octave') lastAssignedOctave = value;
  }

  // Re-calc dimensions if size/shape changed
  if (prop === 'width' || prop === 'height' || prop === 'rotation') {
    const el = document.getElementById(`tf-${selectedTonefieldId}`);
    if (el) updateTonefieldVisuals(el, tf);
  }

  triggerAutoSave();
}

// === ACTIONS ===
let isInitialized = false;

export function initCalibration() {
  if (isInitialized) return;

  calOverlay = document.getElementById('calibrationOverlay');
  if (!calOverlay) return; // Guard if DOM not ready

  isInitialized = true;

  calHandpanName = document.getElementById('calHandpanName');
  calHandpanImage = document.getElementById('calHandpanImage');
  calTonefieldsLayer = document.getElementById('calTonefieldsLayer');
  calPropertiesPanel = document.getElementById('calPropertiesPanel');
  calPitchSelect = document.getElementById('calPitchSelect');
  calOctaveSelect = document.getElementById('calOctaveSelect');
  calNumberSelect = document.getElementById('calNumberSelect');
  calSaveStatus = document.getElementById('calSaveStatus');
  calImgRotInput = document.getElementById('calImgRotInput');
  valImgRot = document.getElementById('valImgRot');
  calPropTitle = document.getElementById('calPropTitle');
  calNoteProps = document.getElementById('calNoteProps');
  calGlobalProps = document.getElementById('calGlobalProps');
  calSizeInput = document.getElementById('calSizeInput');
  valSize = document.getElementById('valSize');
  calShapeInput = document.getElementById('calShapeInput');
  valShape = document.getElementById('valShape');
  calRotInput = document.getElementById('calRotInput');
  valRot = document.getElementById('valRot');
  addTonefieldBtn = document.getElementById('headerAddTonefieldBtn');
  autoDetectBtn = document.getElementById('autoDetectBtn');
  deleteTonefieldBtn = document.getElementById('deleteTonefieldBtn');
  calDoneBtn = document.getElementById('calDoneBtn');

  // Wizard Nav
  const wizardBack = document.getElementById('wizardBack');
  const wizardNext = document.getElementById('wizardNext');

  wizardBack?.addEventListener('click', () => {
    if (currentWizardStep > 1) {
      currentWizardStep--;
      updateWizardUI();
    }
  });

  wizardNext?.addEventListener('click', () => {
    if (currentWizardStep < 5) {
      currentWizardStep++;
      updateWizardUI();
    } else {
      // Finish clicked
      selectTonefield(null);
    }
  });

  // Click away to deselect
  calCanvasContainer?.addEventListener('click', (e) => {
    if (!e.target.closest('.tonefield')) {
      selectTonefield(null);
    }
  });

  addTonefieldBtn?.addEventListener('click', () => {
    // Smart Logic: Increment Semitone
    let nextPitchIndex = lastAssignedPitchIndex;
    let nextOctave = lastAssignedOctave;

    // Smart Logic: Number (Default D if first, else last + 1)
    let nextNum = 'Ding';

    if (currentNoteMap.length === 0) {
      nextPitchIndex = CAL_PITCHES.indexOf('Ding');
      nextOctave = 3;
      nextNum = 'Ding';
    } else {
      // Pitch Logic
      nextPitchIndex += 2;
      if (nextPitchIndex >= CAL_PITCHES.length) {
        nextPitchIndex -= CAL_PITCHES.length;
        nextOctave++;
      }

      // Number Logic: Find max number assigned so far
      let maxNum = 0;
      currentNoteMap.forEach(t => {
        if (t.assignedNumber && t.assignedNumber !== 'Ding') {
          const val = parseInt(t.assignedNumber);
          if (!isNaN(val) && val > maxNum) maxNum = val;
        }
      });
      nextNum = String(maxNum + 1);
    }

    // Update Tracking
    lastAssignedPitchIndex = nextPitchIndex;
    lastAssignedOctave = nextOctave;

    const newId = Date.now();
    const newTf = {
      id: newId,
      x: 50,
      y: 50,
      width: 12,
      height: 12,
      rotation: 0,
      note: CAL_PITCHES[nextPitchIndex],
      octave: nextOctave,
      assignedNumber: nextNum,
      side: currentCalibrationSide
    };

    currentNoteMap.push(newTf);
    createTonefieldDOM(newTf, currentNoteMap.length - 1);
    selectTonefield(newId);
    triggerAutoSave();
  });

  deleteTonefieldBtn?.addEventListener('click', () => {
    if (!selectedTonefieldId) return;
    currentNoteMap = currentNoteMap.filter(t => t.id !== selectedTonefieldId);
    renderTonefields();
    selectTonefield(null);
    triggerAutoSave();
  });

  calPitchSelect?.addEventListener('change', () => updateSelectedTf('note', calPitchSelect.value));
  calOctaveSelect?.addEventListener('change', () => updateSelectedTf('octave', parseInt(calOctaveSelect.value)));
  calNumberSelect?.addEventListener('change', () => updateSelectedTf('assignedNumber', calNumberSelect.value));

  calSizeInput?.addEventListener('input', () => {
    const size = parseFloat(calSizeInput.value);
    if (valSize) valSize.textContent = size;

    // Update Width/Height based on current ratio
    if (!selectedTonefieldId) return;
    const tf = currentNoteMap.find(t => t.id === selectedTonefieldId);
    if (!tf) return;

    const currentRatio = parseFloat(calShapeInput.value);
    tf.width = size;
    tf.height = size * currentRatio;

    const el = document.getElementById(`tf-${selectedTonefieldId}`);
    if (el) updateTonefieldVisuals(el, tf);
    triggerAutoSave(); // Debounced
  });

  calShapeInput?.addEventListener('input', () => {
    const ratio = parseFloat(calShapeInput.value);
    if (valShape) valShape.textContent = ratio.toFixed(2);

    if (!selectedTonefieldId) return;
    const tf = currentNoteMap.find(t => t.id === selectedTonefieldId);
    if (!tf) return;

    // Keep width, update height
    tf.height = tf.width * ratio;

    const el = document.getElementById(`tf-${selectedTonefieldId}`);
    if (el) updateTonefieldVisuals(el, tf);
    triggerAutoSave();
  });

  calRotInput?.addEventListener('input', () => {
    const rot = parseInt(calRotInput.value);
    if (valRot) valRot.textContent = rot + '°';
    updateSelectedTf('rotation', rot);
  });

  calImgRotInput?.addEventListener('input', () => {
    const rot = parseInt(calImgRotInput.value);
    if (valImgRot) valImgRot.textContent = rot + '°';

    if (calHandpanImage) calHandpanImage.style.transform = `rotate(${rot}deg)`;

    if (currentHandpanData) {
      if (currentCalibrationSide === 'bottom') {
        currentHandpanData.bottom_image_rotation = rot;
      } else {
        currentHandpanData.image_rotation = rot;
      }
      triggerAutoSave(true); // Save Handpan record
    }
  });

  calDoneBtn?.addEventListener('click', async () => {
    // Exit calibration
    if (calOverlay) {
      calOverlay.style.display = 'none';
      calOverlay.setAttribute('aria-hidden', 'true');
    }

    if (onCalibrationDone) {
      onCalibrationDone(); // Custom exit (e.g. return to My Scales)
    } else {
      // Default: Reload handpans list or select this one
      await alert("Setup Complete! Your custom handpan is ready.");
      location.reload();
    }
  });

  // Magic Auto-Detect
  document.getElementById('autoDetectBtn')?.addEventListener('click', () => autoDetectTonefields());
}

/**
 * The "Magic" Algorithm: 
 * Uses Computer Vision (CCL) to find note blobs in the image.
 */
async function autoDetectTonefields() {
  if (!calHandpanImage || !calHandpanImage.src) return;

  const statusEl = document.getElementById('calSaveStatus');
  if (statusEl) {
    statusEl.textContent = "AI Detecting...";
    statusEl.classList.remove('error');
    statusEl.style.opacity = '1';
  }

  try {
    // 1. Get Image Blob from Canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = calHandpanImage.naturalWidth;
    canvas.height = calHandpanImage.naturalHeight;
    ctx.drawImage(calHandpanImage, 0, 0);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

    // 2. Invoke Backend AI Detect Function
    const { data, error: fnError } = await supabase.functions.invoke('detect-tonefields', {
      body: blob,
    });

    if (fnError) {
      if (fnError.message?.includes('GOOGLE_AI_API_KEY')) {
        throw new Error("AI Setup Required: Please set your GOOGLE_AI_API_KEY in Supabase secrets.");
      }
      throw new Error(fnError.message || 'Server AI failed');
    }

    if (!data || !data.tonefields || data.tonefields.length === 0) {
      throw new Error("AI could not identify any tonefields in this image.");
    }

    const tfs = data.tonefields;

    // 3. Convert to internal format and sort
    const newNoteMap = [];

    // Separate Ding
    const ding = tfs.find(t => t.note?.toLowerCase() === 'ding') || tfs[0];
    const others = tfs.filter(t => t !== ding);

    // Add Ding
    const dId = Date.now();
    newNoteMap.push({
      id: dId,
      x: ding.x,
      y: ding.y,
      width: (ding.r * 2) || 12,
      height: (ding.r * 2) || 12,
      rotation: 0,
      note: 'D',
      octave: 3,
      assignedNumber: 'Ding',
      side: currentCalibrationSide
    });

    // Add Others
    others.forEach((n, i) => {
      newNoteMap.push({
        id: Date.now() + i + 1,
        x: n.x,
        y: n.y,
        width: (n.r * 2) || 10,
        height: (n.r * 2) || 10,
        rotation: 0,
        note: n.note !== 'Ding' ? n.note : 'C',
        octave: n.octave || (lastAssignedOctave + Math.floor((lastAssignedPitchIndex + (i + 1) * 2) / CAL_PITCHES.length)),
        assignedNumber: String(i + 1),
        side: currentCalibrationSide
      });
    });

    // 4. Update UI
    currentNoteMap = newNoteMap;
    renderTonefields();
    selectTonefield(null);
    triggerAutoSave();

    if (statusEl) {
      statusEl.textContent = `AI Detected ${newNoteMap.length} points!`;
      setTimeout(() => statusEl.style.opacity = '0', 2000);
    }

  } catch (err) {
    console.error("AI Detection error:", err);
    if (statusEl) {
      statusEl.textContent = "AI Failed";
      statusEl.classList.add('error');
    }
    alert(err.message);
  }
}


function updateTonefieldLabel(id, tf) {
  const el = document.getElementById(`tf-${id}`);
  if (!el) return;
  const label = el.querySelector('.tf-label');
  if (label) label.textContent = `${tf.note}${tf.octave}`;
}

// === PERSISTENCE ===

function triggerAutoSave(saveHandpanRecord = false) {
  if (calSaveStatus) {
    calSaveStatus.textContent = "Saving...";
    calSaveStatus.className = 'cal-status saving'; // Reset classes, add saving
    calSaveStatus.style.opacity = '1';
  }

  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    if (!currentHandpanId) return;

    let error = null;

    if (saveHandpanRecord) {
      // Save Image Rotation to main record (both sides)
      const { error: hpErr } = await supabase
        .from('user_handpans')
        .update({
          image_rotation: currentHandpanData.image_rotation || 0,
          bottom_image_rotation: currentHandpanData.bottom_image_rotation || 0,
        })
        .eq('id', currentHandpanId);
      error = hpErr;
    } else {
      // Save Tonefields
      const { error: tfErr } = await supabase
        .from('user_handpans')
        .update({ note_map: currentNoteMap })
        .eq('id', currentHandpanId);
      error = tfErr;
    }

    if (error) {
      if (calSaveStatus) {
        calSaveStatus.textContent = "Error saving";
        calSaveStatus.className = 'cal-status error'; // Logic needed in CSS or reuse generic
      }
      console.error(error);
    } else {
      if (calSaveStatus) {
        calSaveStatus.textContent = "All changes saved";
        calSaveStatus.className = 'cal-status'; // Remove 'saving', keep base
        // Use styles to handle green color? 
        // Reuse the base styling (green by default in CSS for #calSaveStatus)
        calSaveStatus.style.opacity = '1';

        // Fade out after 2s
        setTimeout(() => {
          calSaveStatus.style.opacity = '0';
        }, 2000);
      }
    }
  }, 1000); // 1 sec debounce
}


