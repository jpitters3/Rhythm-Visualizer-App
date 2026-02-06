/* Handpan Calibration Logic */
import { supabase } from './supabase-client.js';

const CAL_PITCHES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

let currentHandpanId = null;
let currentHandpanData = null; // Store full record to access image_rotation
let currentNoteMap = []; // Array of objects { id, x, y, r, note, octave, width, height, rotation }
let selectedTonefieldId = null;
let lastAssignedPitchIndex = 2; // Default starting at D (Index 2)
let lastAssignedOctave = 3;     // Default starting at 3

let saveTimeout = null;
let onCalibrationDone = null; // Callback for when "Done" is clicked

// DOM Elements
const calOverlay = document.getElementById('calibrationOverlay');
const calHandpanName = document.getElementById('calHandpanName');
const calHandpanImage = document.getElementById('calHandpanImage');
const calTonefieldsLayer = document.getElementById('calTonefieldsLayer');
const calPropertiesPanel = document.getElementById('calPropertiesPanel');
const calPitchSelect = document.getElementById('calPitchSelect');
const calOctaveSelect = document.getElementById('calOctaveSelect');
const calNumberSelect = document.getElementById('calNumberSelect');
const calSaveStatus = document.getElementById('calSaveStatus');
const calImgRotInput = document.getElementById('calImgRotInput');
const valImgRot = document.getElementById('valImgRot');
const calPropTitle = document.getElementById('calPropTitle');
const calNoteProps = document.getElementById('calNoteProps');
const calGlobalProps = document.getElementById('calGlobalProps');
const calSizeInput = document.getElementById('calSizeInput');
const valSize = document.getElementById('valSize');
const calShapeInput = document.getElementById('calShapeInput');
const valShape = document.getElementById('valShape');
const calRotInput = document.getElementById('calRotInput');
const valRot = document.getElementById('valRot');
const addTonefieldBtn = document.getElementById('addTonefieldBtn');
const deleteTonefieldBtn = document.getElementById('deleteTonefieldBtn');
const calDoneBtn = document.getElementById('calDoneBtn');

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
  currentNoteMap = handpanData.note_map || [];

  // Reset UI
  if (calHandpanName) calHandpanName.textContent = `Calibrating: ${handpanData.name}`;

  // Resize container to match image aspect ratio
  if (calHandpanImage) {
    calHandpanImage.onload = function () {
      const ratio = this.naturalHeight / this.naturalWidth;
      const container = document.getElementById('calCanvasContainer');
      if (!container) return;

      // Max dimension 800px
      let w = 800;
      let h = 800;

      if (ratio > 1) {
        // Portrait: Constrain Height
        h = 800;
        w = 800 / ratio;
      } else {
        // Landscape: Constrain Width
        w = 800;
        h = 800 * ratio;
      }

      container.style.width = `${w}px`;
      container.style.height = `${h}px`;
    };

    calHandpanImage.src = handpanData.top_image_url;

    // Apply Image Rotation
    const imgRot = handpanData.image_rotation || 0;
    calHandpanImage.style.transform = `rotate(${imgRot}deg)`;
    if (calImgRotInput) calImgRotInput.value = imgRot;
    if (valImgRot) valImgRot.textContent = imgRot + '°';
  }

  // Render existing dots
  renderTonefields();

  // Show Overlay
  if (calOverlay) calOverlay.style.display = 'flex';

  // Reset selection (Show Global Props by default)
  selectTonefield(null);
}

function renderTonefields() {
  if (!calTonefieldsLayer) return;
  calTonefieldsLayer.innerHTML = '';
  currentNoteMap.forEach((tf, index) => {
    createTonefieldDOM(tf, index);
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
  el.addEventListener('mousedown', (e) => onTonefieldMouseDown(e, tf.id));

  calTonefieldsLayer.appendChild(el);
}

function updateTonefieldVisuals(el, tf) {
  el.style.left = `${tf.x}%`;
  el.style.top = `${tf.y}%`;

  // Logic: 'r' was radius in percent. 
  // New logic: Use width/height/rotation if available, else fallback to 'r'
  let w = tf.width || (tf.r * 2) || 12;
  let h = tf.height || (tf.r * 2) || 12;
  let rot = tf.rotation || 0;

  el.style.width = `${w}%`;
  el.style.height = `${h}%`;
  el.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
}

// === INTERACTION ===

function onTonefieldMouseDown(e, id) {
  e.stopPropagation();
  selectTonefield(id);

  const el = document.getElementById(`tf-${id}`);
  const container = document.getElementById('calCanvasContainer');
  if (!el || !container) return;

  const rect = container.getBoundingClientRect();

  const startX = e.clientX;
  const startY = e.clientY;
  const startLeft = parseFloat(el.style.left);
  const startTop = parseFloat(el.style.top);

  el.classList.add('dragging');

  function onMouseMove(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    // Convert px delta to percent
    const dxPct = (dx / rect.width) * 100;
    const dyPct = (dy / rect.height) * 100;

    const newX = Math.max(0, Math.min(100, startLeft + dxPct));
    const newY = Math.max(0, Math.min(100, startTop + dyPct));

    // Update live only visuals first
    el.style.left = `${newX}%`;
    el.style.top = `${newY}%`;

    // Update data model
    const tf = currentNoteMap.find(t => t.id === id);
    if (tf) {
      tf.x = newX;
      tf.y = newY;
    }
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    el.classList.remove('dragging');
    triggerAutoSave();
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
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

// === ACTIONS ===

if (addTonefieldBtn) {
  addTonefieldBtn.addEventListener('click', () => {
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
      assignedNumber: nextNum
    };

    currentNoteMap.push(newTf);
    createTonefieldDOM(newTf, currentNoteMap.length - 1);
    selectTonefield(newId);
    triggerAutoSave();
  });
}

if (deleteTonefieldBtn) {
  deleteTonefieldBtn.addEventListener('click', () => {
    if (!selectedTonefieldId) return;
    currentNoteMap = currentNoteMap.filter(t => t.id !== selectedTonefieldId);
    renderTonefields();
    selectTonefield(null);
    triggerAutoSave();
  });
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

if (calPitchSelect) calPitchSelect.addEventListener('change', () => updateSelectedTf('note', calPitchSelect.value));
if (calOctaveSelect) calOctaveSelect.addEventListener('change', () => updateSelectedTf('octave', parseInt(calOctaveSelect.value)));
if (calNumberSelect) calNumberSelect.addEventListener('change', () => updateSelectedTf('assignedNumber', calNumberSelect.value));

// New Inputs
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

// Global Image Rotation
calImgRotInput?.addEventListener('input', () => {
  const rot = parseInt(calImgRotInput.value);
  if (valImgRot) valImgRot.textContent = rot + '°';

  if (calHandpanImage) calHandpanImage.style.transform = `rotate(${rot}deg)`;

  if (currentHandpanData) {
    currentHandpanData.image_rotation = rot;
    triggerAutoSave(true); // Save Handpan record
  }
});


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
      // Save Image Rotation to main record
      const { error: hpErr } = await supabase
        .from('user_handpans')
        .update({ image_rotation: currentHandpanData.image_rotation })
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

if (calDoneBtn) {
  calDoneBtn.addEventListener('click', () => {
    // Exit calibration
    if (calOverlay) calOverlay.style.display = 'none';

    if (onCalibrationDone) {
      onCalibrationDone(); // Custom exit (e.g. return to My Scales)
    } else {
      // Default: Reload handpans list or select this one
      alert("Setup Complete! Your custom handpan is ready.");
      location.reload();
    }
  });
}

