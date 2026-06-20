import { setCaret } from './range-selection.js';
import { Modal } from './modal.js';
import { updateUserLabelPreference } from './profile.js';
import { writeToSession, clampIndex, getComposeOn } from './compose-mode.js';
import { preloadScaleSamples, noteForLabel, isDownbeatStep, registerHighlighter, playNoteByLabel, intervalMs } from './noteplayer.js';
import { SCALES, SCALE_KEY_LOCAL, BASE_PATH } from './config.js';
import { currentUser, getScale, getSelectedScaleName, setSelectedScaleName, setCurrentScale } from './state.js';
import { supabase } from './supabase-client.js';
import { enterCalibrationMode } from './calibration.js';
import { startGuidedCalibration } from './guided-calibration.js';
import { activeGrid } from './grid-context.js';
import { Bus, BUS_EVENT } from './bus.js';
import { setBeatToGhost, renderAllMeasures, updateGridLabels } from './notegrid.js';
import { isAuthed } from './auth.js';
import { canAccess, FEATURE } from './gated-feature.js';
import { alert, confirm } from './alert.js';

// DOM Elements (previously globals)
let handpanImg, scaleSelect, scaleStatus, handpanColorSelect, numberPitchSelect, showOctaveCheck, showOctaveRow, ghostBtn, ghostBackBtn, ghostFwdBtn, composeBtn, handpanSection, handpanOverlay;
let handpanWrapBottom, handpanImgBottom, handpanOverlayBottom;

/* Mapped to nine-note-handpan-numbered.png */
const HANDPAN_MAP_SKETCH = {
  "Ding": { x: 50.5, y: 47.8, r: 12 },
  "1": { x: 62.1, y: 76.2, r: 12 },
  "2": { x: 34.8, y: 74.5, r: 12 },
  "3": { x: 78.7, y: 57.5, r: 11 },
  "4": { x: 20.4, y: 54.8, r: 11 },
  "5": { x: 76.6, y: 35, r: 10 },
  "6": { x: 23.5, y: 32.3, r: 10 },
  "7": { x: 60.5, y: 18.5, r: 9 },
  "8": { x: 39.3, y: 18.2, r: 9 },
  "T_R": { x: 60.3, y: 56.9, r: 5 },
  "T_L": { x: 40.7, y: 56.9, r: 5 },
  "S_R": { x: 94.1, y: 45.7, r: 7 },
  "S_L": { x: 5.9,  y: 45.7, r: 7 },
};

const HANDPAN_MAP_BRONZE = {
  "Ding": { x: 48.1, y: 45.6, r: 12 },
  "1": { x: 58.9, y: 75.7, r: 10 },
  "2": { x: 34.4, y: 75.3, r: 10 },
  "3": { x: 77.9, y: 59.2, r: 10 },
  "4": { x: 17.9, y: 55.9, r: 10 },
  "5": { x: 77.5, y: 34.8, r: 9 },
  "6": { x: 21.1, y: 32.6, r: 9 },
  "7": { x: 60, y: 18.8, r: 8 },
  "8": { x: 38.3, y: 18.6, r: 8 },
  "T_R": { x: 61.1, y: 56.3, r: 7 },
  "T_L": { x: 38.9, y: 56.3, r: 7 },
  "S_R": { x: 93.3, y: 47.9, r: 6 },
  "S_L": { x: 6.7,  y: 47.9, r: 6 },
};

export let HANDPAN_MAP = HANDPAN_MAP_BRONZE;

// const HANDPAN_IMG_SKETCH = 'nine-note-handpan-numbered.png';
const HANDPAN_IMG_SKETCH_EMPTY = 'handpan-empty-notes.png';
const HANDPAN_IMG_BRONZE = 'handpan-for-groovepan.png';


const handpanDots = new Map();

let overlayPitches = false;
let overlayNumbers = false;
let hpMapSaveTimeout = null;
let currentHandpanSide = 'top'; // 'top' or 'bottom'
let mountedHandpanData = null; // Store current handpan data for flipping

// Custom Handpan Cache
let customHandpansCache = [];

let handpanLoadingOverlay = null;

function setHandpanLoading(on) {
  if (!handpanLoadingOverlay) handpanLoadingOverlay = document.getElementById('handpanLoading');
  if (handpanLoadingOverlay) {
    if (on) {
      handpanLoadingOverlay.classList.add('active');
      handpanImg?.classList.add('loading');
      handpanOverlay?.classList.add('loading');
    } else {
      handpanLoadingOverlay.classList.remove('active');
      handpanImg?.classList.remove('loading');
      handpanOverlay?.classList.remove('loading');
    }
  }
}

/**
 * Centralized helper to change handpan image with guaranteed synchronization.
 */
function changeHandpanImage(src, onDone) {
  setHandpanLoading(true);

  // Ensure we show the loading overlay for at least a brief moment for UX smoothness
  const minLoadingTime = 400;
  const startTime = Date.now();

  const finalize = () => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, minLoadingTime - elapsed);

    // Double rAF to ensure browser has processed the layout of the new image
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Extra tiny timeout to be absolutely sure the layout engine has updated height
        setTimeout(() => {
          if (onDone) onDone();
          buildHandpanOverlay();
          setHandpanLoading(false);
          handpanImg.onload = null;
          handpanImg.onerror = null;
        }, Math.max(remaining, 50));
      });
    });
  };


  handpanImg.onload = finalize;
  handpanImg.onerror = finalize; // Fallback on error
  handpanImg.src = src;
}

/* ==== Save and load scales locally and in db ==== */

export function saveScaleLocal(name) {
  if (!name || name === '') return;
  localStorage.setItem(SCALE_KEY_LOCAL, name);
}

export function loadScaleLocal() {
  return localStorage.getItem(SCALE_KEY_LOCAL);
}

export async function saveScaleRemote(name) {
  if (!currentUser) return;
  if (!supabase) return;

  await supabase.from('profiles').upsert(
    { user_id: currentUser.id, handpan_scale: name },
    { onConflict: 'user_id' }
  );
}

export async function loadScaleRemote() {
  if (!currentUser) return null;
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('handpan_scale')
    .eq('user_id', currentUser.id)
    .maybeSingle();
  if (error) return null;
  return data?.handpan_scale || null;
}

export async function loadAllUserCustomHandpans() {
  console.log('LOADING CUSTOM HANDPANDS...');
  if (!currentUser) return;

  const { data, error } = await supabase
    .from('user_handpans')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (data) {
    customHandpansCache = data;
    console.log('Render custom handpan options:', customHandpansCache);
    renderCustomOptions();

    // Only apply if the currently selected scale (from init/profile) is a custom one we just loaded.
    // This prevents overriding the user's choice on background refreshes,
    // while ensuring Custom Scales load correctly on initial startup.
    const currentSelection = getSelectedScaleName();
    if (currentSelection && currentSelection.startsWith('custom:')) {
      const id = currentSelection.split(':')[1];
      const target = data.find(h => h.id === id);
      if (target && currentSelection === `custom:${id}`) {
        applyCustomHandpan(target);
      }
    }
  }
}

async function renderCustomOptions() {
  // REORDER: Custom Scales First, then System Scales
  if (typeof SCALES === 'undefined') return;

  if (!scaleSelect || scaleSelect === 'undefined') {
    scaleSelect = document.getElementById('scaleSelect');
  }

  scaleSelect.innerHTML = '';

  // 1. My Scales
  if (customHandpansCache.length > 0) {
    const header = document.createElement('option');
    header.disabled = true;
    header.textContent = '── MY SCALES ──';
    scaleSelect.appendChild(header);

    customHandpansCache.forEach(hp => {
      const opt = document.createElement('option');
      opt.value = `custom:${hp.id}`;
      opt.textContent = hp.name;
      scaleSelect.appendChild(opt);
    });

    const divider = document.createElement('option');
    divider.disabled = true;
    divider.textContent = '── SYSTEM SCALES ──';
    scaleSelect.appendChild(divider);
  }

  // 2. System Scales
  for (const name of Object.keys(SCALES)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    scaleSelect.appendChild(opt);
  }

  // Update scaleSelect with user's preference
  scaleSelect.value = getSelectedScaleName();
}

function applyCustomHandpan(handpanData) {
  console.log('Applying custom handpan:', handpanData);
  mountedHandpanData = handpanData; // Store for flipping
  currentHandpanSide = 'top'; // Reset to top

  changeHandpanImage(handpanData.top_image_url, () => {
    // Apply Image Rotation
    const rot = handpanData.image_rotation || 0;
    handpanImg.style.transform = `rotate(${rot}deg)`;
  });

  // Show/Hide Flip Button
  const flipBtn = document.getElementById('flipSideBtn');
  if (flipBtn) {
    flipBtn.style.display = handpanData.bottom_image_url ? '' : 'none';
    flipBtn.style.marginLeft = handpanData.bottom_image_url ? 'auto' : '0';
    flipBtn.style.position = handpanData.bottom_image_url ? 'relative' : '';
    flipBtn.style.height = handpanData.bottom_image_url ? '50px' : '';
    flipBtn.onclick = () => toggleHandpanSide();
  }

  // Update Map
  const newMap = {};
  const musicalMap = {};
  let dingPitch = "D3"; // Default

  handpanData.note_map.forEach(tf => {
    const key = `${tf.note}${tf.octave}`;
    const r = tf.r || 8;

    // Determine the label (Assigned Number OR "D" OR fallback to Pitch)
    let label = tf.assignedNumber;
    if (!label || label === "") {
      // Fallback: If it's a ding, call it D? Or just use the pitch as label?
      // Let's use the pitch as the label if no number assigned.
      label = key;
    }

    // Visual Map (Label -> Visuals) -- FILTER BY SIDE
    // Default side is 'top'
    const side = tf.side || 'top';

    if (side === currentHandpanSide) {
      newMap[label] = {
        x: (typeof tf.x === 'number') ? tf.x : 50,
        y: (typeof tf.y === 'number') ? tf.y : 50,
        r: r,
        width: tf.width || (r * 2),
        height: tf.height || (r * 2),
        rotation: tf.rotation || 0,
        id: tf.id,
        side: side
      };

      if (label === 'Ding' || label === 'D') {
        newMap['D'] = newMap[label];
      }
    }

    // Musical Map (Label -> Pitch) -- INCLUDE ALL
    if (label === 'Ding' || label === 'D') {
      dingPitch = key;
    } else {
      musicalMap[label] = key;
    }
  });

  const overlayDefaults = {
    'T_R': { x: 61.1, y: 56.3, r: 7 }, 'T_L': { x: 38.9, y: 56.3, r: 7 },
    'S_R': { x: 93.3, y: 47.9, r: 6 }, 'S_L': { x: 6.7,  y: 47.9, r: 6 },
  };
  for (const [key, def] of Object.entries(overlayDefaults)) {
    const saved = handpanData.note_map.find(t => t.assignedNumber === key);
    newMap[key] = { x: saved?.x ?? def.x, y: saved?.y ?? def.y, r: saved?.r ?? def.r, width: (saved?.r ?? def.r) * 2, height: (saved?.r ?? def.r) * 2, rotation: 0 };
  }
  HANDPAN_MAP = newMap;

  // Update Global Current Scale
  setCurrentScale({
    ding: dingPitch,
    map: musicalMap
  });

  setSelectedScaleName(`custom:${handpanData.id}`);

  if (preloadScaleSamples) preloadScaleSamples();

  // Update UI Selectors
  // Set Scale Select to this custom one
  scaleSelect.value = `custom:${handpanData.id}`;
  scaleStatus.textContent = `Custom Scale: ${handpanData.name}`;

  // Force Handpan Select to 'Custom' visual
  // Hide the entire Color/Image dropdown when using a custom scale
  const row = handpanColorSelect.closest('.setting-row');
  if (row) row.style.display = 'none';

  // Ensure we don't leave a "Custom" option sticking around if we switch back
  const customOpt = document.querySelector('#handpanColorSelect option[value="Custom"]');
  if (customOpt) customOpt.remove();

  if (handpanOverlay) handpanOverlay.dataset.model = 'Bronze';
  dispatchEvent(new Event('handpan-loaded'));
}

function hasBottomNotes() {
  return mountedHandpanData && Array.isArray(mountedHandpanData.note_map) &&
    mountedHandpanData.note_map.some(tf => (tf.side || 'top') === 'bottom');
}

export function toggleHandpanSide() {
  if (!mountedHandpanData || !mountedHandpanData.bottom_image_url) return;

  // Cycle: Top -> Bottom -> Dual -> Perimeter (if bottom notes exist) -> Top
  if (currentHandpanSide === 'top') {
    currentHandpanSide = 'bottom';
  } else if (currentHandpanSide === 'bottom') {
    currentHandpanSide = 'dual';
  } else if (currentHandpanSide === 'dual') {
    currentHandpanSide = hasBottomNotes() ? 'perimeter' : 'top';
  } else {
    currentHandpanSide = 'top';
  }

  localStorage.setItem('gp_handpanSide', currentHandpanSide);

  // Update toggle button state
  const flipBtn = document.getElementById('flipSideBtn');
  if (flipBtn) {
    flipBtn.classList.remove('flipped');
    if (currentHandpanSide === 'bottom') flipBtn.classList.add('flipped');

    if (currentHandpanSide === 'dual') {
      flipBtn.textContent = '⩓';
      flipBtn.title = "Dual View (Stacked)";
    } else if (currentHandpanSide === 'perimeter') {
      flipBtn.textContent = '◎';
      flipBtn.title = "Perimeter View (bottom shell as arcs)";
    } else {
      flipBtn.textContent = '🔄';
      flipBtn.title = (currentHandpanSide === 'top') ? "Flip to Bottom" : "Flip to All";
    }
  }

  // Visuals Logic
  // Dual Mode: Show Bottom Wrap, Set Bottom Image
  if (currentHandpanSide === 'dual') {
    if (handpanWrapBottom) handpanWrapBottom.style.display = 'block';
    if (handpanImgBottom) {
      handpanImgBottom.src = mountedHandpanData.bottom_image_url;
      const botRot = mountedHandpanData.bottom_image_rotation || 0;
      handpanImgBottom.style.transform = botRot ? `rotate(${botRot}deg)` : '';
    }
    // Top image stays as top
    changeHandpanImage(mountedHandpanData.top_image_url, () => {
      const topRot = mountedHandpanData.image_rotation || 0;
      if (handpanImg) handpanImg.style.transform = topRot ? `rotate(${topRot}deg)` : '';
    });
  } else {
    if (handpanWrapBottom) handpanWrapBottom.style.display = 'none';
    if (handpanImgBottom) handpanImgBottom.src = "";

    // Update Single Image (Both uses Top by default)
    const imgSide = (currentHandpanSide === 'bottom') ? 'bottom' : 'top';
    const targetSrc = (imgSide === 'top') ? mountedHandpanData.top_image_url : mountedHandpanData.bottom_image_url;
    const rot = imgSide === 'bottom'
      ? (mountedHandpanData.bottom_image_rotation || 0)
      : (mountedHandpanData.image_rotation || 0);
    changeHandpanImage(targetSrc, () => {
      if (handpanImg) handpanImg.style.transform = rot ? `rotate(${rot}deg)` : '';
    });
  }

  // Re-run the visual map logic
  // We need to re-parse the note map but only keep notes for this side
  const newMap = {};

  mountedHandpanData.note_map.forEach(tf => {
    // Default to 'top' if undefined
    const noteSide = tf.side || 'top';

    // Filtering Logic
    let include = false;
    let isGhost = false;

    if (currentHandpanSide === 'dual') {
      include = true;
      // No ghost flags for dual mode, they just go to different overlays
      // But we can set isGhost false explicitly
      isGhost = false;
    } else if (currentHandpanSide === 'perimeter') {
      include = true; // include all; bottom notes rendered as arcs in buildHandpanOverlay
      isGhost = false;
    } else {
      // Normal strict side
      if (noteSide === currentHandpanSide) include = true;
    }

    if (!include) return;

    const key = `${tf.note}${tf.octave}`;
    const r = tf.r || 8;

    let label = tf.assignedNumber;
    if (!label || label === "") label = key;

    newMap[label] = {
      x: (typeof tf.x === 'number') ? tf.x : 50,
      y: (typeof tf.y === 'number') ? tf.y : 50,
      r: r,
      width: tf.width || (r * 2),
      height: tf.height || (r * 2),
      rotation: tf.rotation || 0,
      id: tf.id,
      side: noteSide,
      isGhost: isGhost
    };

    // Ensure D exists if it's visible
    if ((label === 'Ding' || label === 'D') && include) {
      newMap['D'] = newMap[label];
    }
  });

  // Inject tak/slap overlay dots, preferring saved positions from note_map
  const overlayDefaults2 = {
    'T_R': { x: 61.1, y: 56.3, r: 7 }, 'T_L': { x: 38.9, y: 56.3, r: 7 },
    'S_R': { x: 93.3, y: 47.9, r: 6 }, 'S_L': { x: 6.7,  y: 47.9, r: 6 },
  };
  for (const [key, def] of Object.entries(overlayDefaults2)) {
    if (!newMap[key]) {
      const saved = mountedHandpanData.note_map.find(t => t.assignedNumber === key);
      newMap[key] = { x: saved?.x ?? def.x, y: saved?.y ?? def.y, r: saved?.r ?? def.r, width: (saved?.r ?? def.r) * 2, height: (saved?.r ?? def.r) * 2, rotation: 0 };
    }
  }

  // Update Visual Map ONLY.
  // We must NOT nuke the Musical Map in `currentScale` because notes on the other side should still make sound if triggered by MIDI/Keyboard.
  // However, HANDPAN_MAP determines what is drawn.
  HANDPAN_MAP = newMap;
  // buildHandpanOverlay() is now handled by img.onload above
}

// === MY SCALES MANAGEMENT ===
let myScalesBtn, myScalesModal, myScalesPanel, closeMyScalesBtn, myScalesList;

function closeMyScalesModal() {
  myScalesPanel.close();
}


async function openMyScalesModal(view = 'list') {
  myScalesPanel.open();

  // View Switching
  if (view === 'form') {
    // We assume openHandpanForm(null) is called separately or here
    // But openHandpanForm handles form visibility now.
    // Let's ensure list is hidden
    if (myScalesList) myScalesList.style.display = 'none';
    if (hpCreationForm) hpCreationForm.style.display = 'flex';
  } else {
    // List Mode
    if (hpCreationForm) hpCreationForm.style.display = 'none';
    if (myScalesList) myScalesList.style.display = 'block';

    // Refresh Data
    await loadAllUserCustomHandpans();
    renderMyScalesList();
  }

  document.getElementById('accountDropdownMenu')?.classList.remove('show');
}


let editingHandpanId = null;


function openHandpanForm(data = null) {
  // Switch to Form View within the Modal
  openMyScalesModal('form');

  // Reset or Fill
  if (!data) {
    // Create Mode
    editingHandpanId = null;
    document.getElementById('hpCreationTitle').textContent = 'Create New Handpan';
    document.getElementById('hpBuilderName').value = '';
    document.getElementById('hpScaleName').value = '';

    // Clear file inputs and reset "Current" text
    document.getElementById('hpTopImage').value = '';
    document.getElementById('hpBottomImage').value = '';
    document.getElementById('hpTopFileName').textContent = 'No file chosen';
    document.getElementById('hpBottomFileName').textContent = 'No file chosen';
    document.getElementById('hpTopCurrent').style.display = 'none';
    document.getElementById('hpBottomCurrent').style.display = 'none';

    saveNewHandpanBtn.textContent = 'Next: Calibrate';
  } else {
    // Edit Mode
    editingHandpanId = data.id;
    document.getElementById('hpCreationTitle').textContent = 'Edit Handpan Details';
    document.getElementById('hpBuilderName').value = data.builder || '';
    document.getElementById('hpScaleName').value = data.scale_name || '';

    // Reset file inputs for edit mode
    document.getElementById('hpTopImage').value = '';
    document.getElementById('hpBottomImage').value = '';
    document.getElementById('hpTopFileName').textContent = 'No file chosen';
    document.getElementById('hpBottomFileName').textContent = 'No file chosen';

    // Show current file indicators (simplified)
    const topCurrent = document.getElementById('hpTopCurrent');
    if (topCurrent) {
      topCurrent.style.display = 'block';
      topCurrent.textContent = data.top_image_url ? 'Current image set (Upload to change)' : 'No image set';
    }
    const bottomCurrent = document.getElementById('hpBottomCurrent');
    if (bottomCurrent) {
      bottomCurrent.style.display = 'block';
      bottomCurrent.textContent = data.bottom_image_url ? 'Current image set (Upload to change)' : 'No image set';
    }

    saveNewHandpanBtn.textContent = 'Save Changes';
  }
}


function renderMyScalesList() {
  console.log('Rendering scales list:', customHandpansCache);
  myScalesList.innerHTML = '';

  // Add "Create New" button at the top
  const createContainer = document.createElement('div');
  createContainer.id = 'createNewHandpan';
  createContainer.style.paddingBottom = '20px';
  createContainer.style.textAlign = 'center';
  createContainer.style.borderBottom = '1px solid var(--panel-border)';
  const createBtn = document.createElement('button');
  createBtn.id = 'createHandpanBtn';
  createBtn.className = 'primary-btn small-btn';
  createBtn.textContent = '+ Create New Handpan';
  createBtn.onclick = () => {
    if (!canAccess(FEATURE.CUSTOM_SCALES)) {
      Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, {
        feature: FEATURE.CUSTOM_SCALES,
        featureId: 'feat-scales'
      });
      return;
    }
    openHandpanForm(null);
  };
  createContainer.appendChild(createBtn);
  if (customHandpansCache.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.padding = '20px';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.color = '#888';
    emptyMsg.textContent = 'No custom handpans yet.';
    myScalesList.appendChild(emptyMsg);
    myScalesList.appendChild(createContainer);
    return;
  }

  myScalesList.appendChild(createContainer);

  customHandpansCache.forEach((hp, index) => {
    const item = document.createElement('div');
    item.className = 'scale-list-item';

    // --- Name Section (View Only) ---
    const nameDiv = document.createElement('div');
    nameDiv.className = 'scale-info';
    nameDiv.innerHTML = `
            <div class="scale-name-row">
                <span class="scale-name-text">${hp.name}</span>
            </div>
            <div class="scale-meta">${hp.builder} • ${hp.scale_name}</div>
        `;

    // --- Actions Section ---
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'scale-actions';

    // Edit Details Button
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit Details'; // or icon
    editBtn.className = 'edit-map-btn'; // Reuse style or new 'edit-details-btn'
    editBtn.style.marginRight = '5px';
    editBtn.onclick = () => {
      openHandpanForm(hp);
    };

    // Reorder Buttons
    const isFirst = index === 0;
    const isLast = index === customHandpansCache.length - 1;

    const upBtn = document.createElement('button');
    upBtn.innerHTML = '&#9650;';
    upBtn.className = 'icon-btn';
    upBtn.disabled = isFirst;
    upBtn.onclick = () => swapHandpanOrder(index, index - 1);

    const downBtn = document.createElement('button');
    downBtn.innerHTML = '&#9660;';
    downBtn.className = 'icon-btn';
    downBtn.disabled = isLast;
    downBtn.onclick = () => swapHandpanOrder(index, index + 1);

    // Edit Map Button (Calibration)
    const mapBtn = document.createElement('button');
    mapBtn.textContent = 'Edit Map';
    mapBtn.className = 'edit-map-btn';
    mapBtn.onclick = () => {
      if (!canAccess(FEATURE.CUSTOM_SCALES)) {
        Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, {
          feature: FEATURE.CUSTOM_SCALES,
          featureId: 'feat-scales'
        });
        return;
      }
      closeMyScalesModal();
      if (enterCalibrationMode) {
        enterCalibrationMode(hp, () => {
          openMyScalesModal();
          loadAllUserCustomHandpans().then(renderMyScalesList);
        });
      }
    };

    // Delete Button
    const delBtn = document.createElement('button');
    delBtn.innerHTML = '&times;';
    delBtn.className = 'icon-btn danger-text';
    delBtn.title = 'Delete';
    delBtn.onclick = () => deleteUserHandpan(hp.id);

    actionsDiv.append(editBtn, upBtn, downBtn, mapBtn, delBtn);
    item.append(nameDiv, actionsDiv);
    myScalesList.appendChild(item);
  });
}


async function swapHandpanOrder(indexA, indexB) {
  if (indexA < 0 || indexB < 0 || indexA >= customHandpansCache.length || indexB >= customHandpansCache.length) return;

  const newCache = [...customHandpansCache];

  // Swap in array
  [newCache[indexA], newCache[indexB]] = [newCache[indexB], newCache[indexA]];

  // Update Optimistically
  customHandpansCache = newCache;
  renderMyScalesList();

  // Sync DB: Update everyone's sort_order to match new index
  // This is robust against nulls/misses
  for (let i = 0; i < newCache.length; i++) {
    await supabase.from('user_handpans').update({ sort_order: i }).eq('id', newCache[i].id);
  }
  // Also refresh dropdowns in background
  renderCustomOptions();
}

async function deleteUserHandpan(id) {
  if (!await confirm("Are you sure you want to delete this scale? This cannot be undone.")) return;

  const { error } = await supabase.from('user_handpans').delete().eq('id', id);
  if (error) {
    await alert("Error deleting: " + error.message);
  } else {
    // Refresh
    await loadAllUserCustomHandpans(); // Reloads cache and selects
    renderMyScalesList(); // Re-render modal list

    // Reset if we deleted the active one
    if (scaleSelect.value === `custom:${id}`) {
      location.reload(); // Simplest reset
    }
  }
}

export function buildHandpanOverlay() {
  if (!handpanOverlay) return;

  handpanOverlay.innerHTML = '';
  handpanDots.clear();

  if (handpanOverlayBottom) handpanOverlayBottom.innerHTML = '';

  // Remove any existing perimeter SVG
  const wrap = handpanOverlay.closest('.handpan-wrap');
  wrap?.querySelector('.hp-perimeter-svg')?.remove();

  // Collect bottom notes for perimeter mode
  const perimeterNotes = [];

  for (const [note, p] of Object.entries(HANDPAN_MAP)) {
    // Perimeter mode: bottom notes become SVG arcs, top notes render normally
    if (currentHandpanSide === 'perimeter' && p.side === 'bottom') {
      perimeterNotes.push({ note, p });
      continue;
    }

    let targetOverlay = handpanOverlay;
    if (currentHandpanSide === 'dual' && p.side === 'bottom' && handpanOverlayBottom) {
      targetOverlay = handpanOverlayBottom;
    }
    const dot = document.createElement('div');
    dot.className = 'hp-dot';
    dot.dataset.note = note; // This note key is used for playing sound

    dot.style.left = `${p.x}%`;
    dot.style.top = `${p.y}%`;

    let w, h, rot;
    if (p.width) {
      w = p.width;
      h = p.height;
      rot = p.rotation;
    } else {
      // Legacy / Standard maps
      w = p.r * 2;
      h = p.r * 2;
      rot = 0;
    }

    dot.style.width = `${w}%`;
    dot.style.height = `${h}%`;
    dot.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;

    if (p.isGhost) {
      dot.classList.add('other-side');
    }

    targetOverlay.appendChild(dot);

    // Create visual child to isolate pulse from label
    const visual = document.createElement('div');
    visual.className = 'hp-visual';
    dot.appendChild(visual);

    handpanDots.set(note, dot);
  }

  // Build perimeter arcs for bottom-shell notes
  if (perimeterNotes.length > 0 && wrap) {
    const svg = buildPerimeterSvg(perimeterNotes);
    wrap.appendChild(svg);
  }

  if (overlayPitches || overlayNumbers)
    overlayNumberPitchNotes(); else removeNoteLabels();
}

function buildPerimeterSvg(perimeterNotes) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'hp-perimeter-svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const cx = 50, cy = 50;
  const arcR = 47; // radius of arc path, just outside handpan edge
  const toRad = d => d * Math.PI / 180;

  perimeterNotes.forEach(({ note, p }, i) => {
    // Mirror x because the bottom image is viewed from below (horizontally flipped vs top view).
    // Angle is derived from the note's calibrated position, x-flipped.
    const dx = (100 - p.x) - 50;
    const dy = p.y - 50;
    const midAngle = Math.atan2(dy, dx) * (180 / Math.PI);

    // Arc length = note diameter → angle from chord-length formula: 2*arcsin(r/R)
    const noteR = p.r || 8;
    const arcDeg = (2 * Math.asin(Math.min(noteR / arcR, 1))) * (180 / Math.PI);

    const a0 = midAngle - arcDeg / 2;
    const a1 = midAngle + arcDeg / 2;

    const sx = cx + arcR * Math.cos(toRad(a0));
    const sy = cy + arcR * Math.sin(toRad(a0));
    const ex = cx + arcR * Math.cos(toRad(a1));
    const ey = cy + arcR * Math.sin(toRad(a1));
    const largeArc = arcDeg > 180 ? 1 : 0;
    const d = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${arcR} ${arcR} 0 ${largeArc} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;

    // Invisible wide hit-area path (easier to tap)
    const hit = document.createElementNS(NS, 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('class', 'hp-arc-hit');
    hit.dataset.note = note;
    svg.appendChild(hit);

    // Visible styled arc
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'hp-arc');
    path.dataset.note = note;
    svg.appendChild(path);

    // Label at arc midpoint
    const lx = cx + arcR * Math.cos(toRad(midAngle));
    const ly = cy + arcR * Math.sin(toRad(midAngle));
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', lx.toFixed(2));
    text.setAttribute('y', ly.toFixed(2));
    text.setAttribute('class', 'hp-arc-label');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.textContent = note;
    svg.appendChild(text);

    // Store proxy in handpanDots so highlightHandpan can find it
    handpanDots.set(note, { isArc: true, path, text });
  });

  // Click / touch handler for the whole SVG
  svg.addEventListener('click', (e) => {
    const arcNote = e.target.dataset?.note;
    if (!arcNote) return;
    playNoteByLabel(arcNote, null);
    highlightHandpan(arcNote, null);
    if (activeGrid.caretIndex !== null) writeToSession(arcNote, { advance: !e.altKey });
  });

  svg.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const arcNote = el?.dataset?.note;
      if (!arcNote) continue;
      playNoteByLabel(arcNote, null);
      highlightHandpan(arcNote, null);
      if (activeGrid.caretIndex !== null) writeToSession(arcNote, { advance: true });
    }
  }, { passive: false });

  return svg;
}

let hpPulseTimers = new Map();

export function highlightHandpan(note, stepIndex, forceHand = null, latency = 0) {
  const sticking = forceHand || (activeGrid.innerHands && activeGrid.innerHands[stepIndex]);

  // Resolve "T"/"S" to the side-appropriate dot based on sticking
  if (note === 'T') note = (sticking === 'L') ? 'T_L' : 'T_R';
  if (note === 'S') note = (sticking === 'L') ? 'S_L' : 'S_R';

  let key = String(note || '').toUpperCase();
  let el = handpanDots.get(key);
  if (!el) el = handpanDots.get(note);
  if (!el && key === 'DING') el = handpanDots.get('D');
  if (!el) return;

  // Sticking Override
  let down;

  if (sticking === 'R') {
    down = true;
  } else if (sticking === 'L') {
    down = false;
  } else {
    down = isDownbeatStep(stepIndex);
  }

  const duration = Math.max(200, (intervalMs() * 4) * 0.8);
  const shadowColor = down ? 'var(--down-fill)' : 'var(--up-fill)';

  // Perimeter arc highlight
  if (el.isArc) {
    el.path.classList.add('active');
    setTimeout(() => el.path.classList.remove('active'), duration);
    el.path.animate([
      { stroke: shadowColor, strokeOpacity: 1, filter: `drop-shadow(0 0 3px ${shadowColor})` },
      { stroke: shadowColor, strokeOpacity: 0.35, filter: 'none' }
    ], { duration, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', delay: -latency * 1000 });
    return;
  }

  // Use WAAPI for a buttery smooth, compositor-driven animation.
  // This eliminates the non-performant `offsetWidth` reflow hack.
  const visual = el.querySelector('.hp-visual');
  if (!visual) return;

  // Mark dot as active for the duration of the pulse (enables CSS hooks and test assertions)
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), duration);

  // Pulse animation using Web Animations API (WAAPI)
  // This eliminates the non-performant `offsetWidth` reflow hack.
  // We animate the 'visual' child to avoid moving the label/number.
  visual.animate([
    { 
      transform: 'scale(1)', 
      backgroundColor: 'rgba(255, 255, 255, 0.4)',
      boxShadow: `0 0 20px 10px ${shadowColor}`,
      opacity: 1 
    },
    { 
      transform: 'scale(1.4)', 
      backgroundColor: 'transparent',
      boxShadow: '0 0 0 0 transparent',
      opacity: 0 
    }
  ], {
    duration: duration,
    easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    delay: -latency * 1000 // compensate for startup/audio latency
  });
}

/* Calibration */
let calBtn;
let calibrateHandpanBtn;
let calibrating = false;
let selectedHpNote = null;

function setCalibrating(on) {
  calibrating = on;
  document.body.classList.toggle('calibrating', on);
  if (calBtn) calBtn.classList.toggle('active', on);
  if (calBtn) calBtn.textContent = on ? 'Calibrating…' : 'Calibrate Map';

  if (!on) {
    // Clear selection
    selectedHpNote = null;
    for (const el of handpanDots.values()) el.classList.remove('selected');
    // Flush any pending debounced save immediately
    if (hpMapSaveTimeout) {
      clearTimeout(hpMapSaveTimeout);
      hpMapSaveTimeout = null;
    }
    saveHandpanPositions();
  }
}


function selectHpDot(note) {
  selectedHpNote = note;
  for (const [k, el] of handpanDots.entries()) {
    if (el.isArc) continue;
    el.classList.toggle('selected', k === note);
  }
}


// Nudge with arrow keys
let isHpDragging = false;
let hpDragStart = { x: 0, y: 0 }; // px
let hpNoteStart = { x: 0, y: 0 }; // %









async function saveHandpanPositions() {
  const selName = getSelectedScaleName();
  if (!selName || !selName.startsWith('custom:')) return;
  const hpId = selName.split(':')[1];

  const customHp = customHandpansCache.find(hp => hp.id === hpId);
  if (!customHp) return;

  // Verify ownership? (RLS handles it, but good to check)
  if (!currentUser || customHp.user_id !== currentUser.id) return;

  let changed = false;

  // Update the data model from the Visual Map
  for (const [note, p] of Object.entries(HANDPAN_MAP)) {
    if (p.id) {
      // Standard custom tonefield — find by id and update position
      const tf = customHp.note_map.find(t => t.id === p.id);
      if (tf && (tf.x !== p.x || tf.y !== p.y)) {
        tf.x = p.x;
        tf.y = p.y;
        changed = true;
      }
    } else if (note === 'T_R' || note === 'T_L' || note === 'S_R' || note === 'S_L') {
      // Injected overlay dot — persist position as a special entry in note_map
      const existing = customHp.note_map.find(t => t.assignedNumber === note);
      if (existing) {
        if (existing.x !== p.x || existing.y !== p.y) {
          existing.x = p.x;
          existing.y = p.y;
          changed = true;
        }
      } else {
        customHp.note_map.push({ assignedNumber: note, note: note, octave: '', x: p.x, y: p.y, r: p.r || 7, side: 'top' });
        changed = true;
      }
    }
  }

  if (changed) {
    console.log('Saving handpan positions...', customHp.name);
    const { error } = await supabase
      .from('user_handpans')
      .update({ note_map: customHp.note_map })
      .eq('id', hpId);

    if (error) console.error('Failed to save handpan:', error);
    else console.log('Handpan saved.');
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function stringifyHandpanMap(map) {
  const keys = Object.keys(map).sort((a, b) => {
    if (a === 'D') return -1;
    if (b === 'D') return 1;
    return Number(a) - Number(b);
  });

  const lines = keys.map(k => {
    const p = map[k];
    // keep tidy rounding so your file stays clean
    const x = Number(p.x.toFixed(1));
    const y = Number(p.y.toFixed(1));
    const r = Number(p.r.toFixed(1));
    return `  ${JSON.stringify(k)}: { x: ${x}, y: ${y}, r: ${r} },`;
  });

  return `const HANDPAN_MAP = {\n${lines.join('\n')}\n};`;
}



let currentLabelPref = 'default';

export function syncStateFromStorage() {
  const val = localStorage.getItem('handpanLabelPref') || 'default';
  currentLabelPref = val;

  // Sync UI if mapped
  if (numberPitchSelect) numberPitchSelect.value = val;

  // Update internal flags
  if (val === 'Numbers') {
    overlayNumbers = true;
    overlayPitches = false;
  } else if (val === 'Pitches') {
    overlayNumbers = false;
    overlayPitches = true;
  } else {
    overlayNumbers = true;
    overlayPitches = false;
  }

  // Show/hide the octave checkbox row — only relevant when Pitches is selected
  if (showOctaveRow) showOctaveRow.style.display = (val === 'Pitches') ? '' : 'none';

  // Sync checkbox state
  if (showOctaveCheck) showOctaveCheck.checked = localStorage.getItem('handpanShowOctave') === 'true';
}

function updateLabelStyles() {
  if (!handpanOverlay) return;

  // Set data attribute on parent to let CSS handle styles
  // This avoids loop and setTimeout
  const color = handpanColorSelect ? handpanColorSelect.value : 'Bronze';
  handpanOverlay.dataset.model = color;
}

function removeNoteLabels() {
  // Only remove them if we really need a clean slate (e.g. scale change)
  document.querySelectorAll('.hp-label').forEach(el => el.remove());
}

function overlayNumberPitchNotes() {
  const isCustom = scaleSelect.value.startsWith('custom:');

  for (const [note, el] of handpanDots.entries()) {
    if (el.isArc) continue; // perimeter arcs carry their own SVG text label

    const p = HANDPAN_MAP[note];
    if (!p) continue;

    // Check if label already exists
    let label = el.querySelector('.hp-label');
    if (!label) {
      label = document.createElement('div');
      label.className = 'hp-label';
      el.appendChild(label);
    }

    let text = '';
    if (overlayNumbers) {
      if (note === 'T_R' || note === 'T_L') text = 'T';
      else if (note === 'S_R' || note === 'S_L') text = 'S';
      else text = note;
    } else if (overlayPitches) {
      if (typeof noteForLabel === 'function') {
        const pitch = noteForLabel(note);
        text = pitch ? pitch.replace('s', '#') : '';
        if (note === 'T_R' || note === 'T_L') text = 'T';
        else if (note === 'S_R' || note === 'S_L') text = 'S';
        if (text && localStorage.getItem('handpanShowOctave') !== 'true') {
          text = text.replace(/\d+$/, '');
        }
      } else {
        text = note;
      }
    }

    const scale = typeof getScale === 'function' ? getScale() : null;
    const dingPitch = scale ? scale.ding : 'D3';
    if (note === 'D' || note === 'Ding' || text.includes('_ding') || text === dingPitch) {
      text = '';
    }

    // Only update if text actually changed to avoid unnecessary churn
    if (label.textContent !== text) {
      label.textContent = text;
    }
  }
}

// Ensure buildHandpanOverlay calls this
const originalBuild = buildHandpanOverlay;




// Settings Toggle
let hpSettingsToggle, hpSettingsPanel, hpSettingsInitial, hpCreationForm, buildScaleBtn, cancelBuildBtn, saveNewHandpanBtn;

// Camera & AI State
let cameraStream = null;
let currentCaptureType = null; // 'top' or 'bottom'
let capturedTopBlob = null;
let capturedBottomBlob = null;
let isFrontCamera = false;


function attachCreationListeners() {
  saveNewHandpanBtn?.addEventListener('click', async () => {
    const builder = document.getElementById('hpBuilderName').value.trim();
    const scaleName = document.getElementById('hpScaleName').value.trim();
    const topImageFile = document.getElementById('hpTopImage').files[0];
    const bottomImageFile = document.getElementById('hpBottomImage').files[0];

    // Read file buffers immediately — before any awaits — because some browsers
    // invalidate File objects after the event loop yields (especially on mobile).
    const topFileBuffer    = topImageFile    ? await topImageFile.arrayBuffer()    : null;
    const bottomFileBuffer = bottomImageFile ? await bottomImageFile.arrayBuffer() : null;

    // Validation:
    // If creating new (no ID), need Top Image.
    // If editing (has ID), Top Image is optional (keep existing).
    if (!builder || !scaleName) {
      await alert('Please fill in Builder and Scale Name.');
      return;
    }
    if (!editingHandpanId && !topFileBuffer && !capturedTopBlob) {
      await alert('Please select a Top Image for a new handpan.');
      return;
    }

    if (!currentUser) {
      await alert('You must be signed in.');
      return;
    }

    saveNewHandpanBtn.textContent = editingHandpanId ? 'Saving Changes...' : 'Uploading...';
    saveNewHandpanBtn.disabled = true;

    try {
      let topUrl = null;
      let bottomUrl = null;

      // Run a file through background removal then upload to storage.
      // Camera blobs already had background removed at capture time — skip for those.
      // Accepts a pre-read ArrayBuffer (for file inputs) or a Blob (for camera captures).
      async function processAndUpload(bufferOrBlob, isCamera, suffix) {
        let blobToUpload;
        if (isCamera) {
          blobToUpload = bufferOrBlob;
        } else {
          // Must send as ArrayBuffer — SDK serializes Blob/File as JSON otherwise.
          const { data: result, error: fnError } = await supabase.functions.invoke('remove-background', {
            body: bufferOrBlob,
            headers: { 'Content-Type': 'application/octet-stream' },
          });
          if (fnError) throw new Error(fnError.message || 'Background removal failed');
          if (result?.error) throw new Error(result.error);
          if (!result?.image) throw new Error('Unexpected response from background removal service');
          const res = await fetch(result.image);
          blobToUpload = await res.blob();
        }
        const fileName = `${currentUser.id}_${Date.now()}_${suffix}.png`;
        const { error: uploadError } = await supabase.storage.from('handpan-images').upload(fileName, blobToUpload);
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('handpan-images').getPublicUrl(fileName);
        return publicUrl;
      }

      // 1. Upload Top Image (prioritize camera capture)
      if (capturedTopBlob || topFileBuffer) {
        saveNewHandpanBtn.textContent = 'Removing background...';
        topUrl = await processAndUpload(capturedTopBlob || topFileBuffer, !!capturedTopBlob, 'top');
      }

      // 2. Upload Bottom Image (prioritize camera capture)
      if (capturedBottomBlob || bottomFileBuffer) {
        saveNewHandpanBtn.textContent = 'Removing background...';
        bottomUrl = await processAndUpload(capturedBottomBlob || bottomFileBuffer, !!capturedBottomBlob, 'bottom');
      }


      if (editingHandpanId) {
        // --- UPDATE ---
        const updates = {
          name: `${builder} ${scaleName}`,
          builder: builder,
          scale_name: scaleName
        };
        if (topUrl) updates.top_image_url = topUrl;
        if (bottomUrl) updates.bottom_image_url = bottomUrl;

        const { error: updateError } = await supabase
          .from('user_handpans')
          .update(updates)
          .eq('id', editingHandpanId);

        if (updateError) throw updateError;

        await alert('Handpan updated successfully!');
        // Refresh list
        await loadAllUserCustomHandpans();

        // If this handpan was active, reload page to see changes
        if (scaleSelect.value === `custom:${editingHandpanId}`) {
          location.reload();
        } else {
          // Return to List View
          openMyScalesModal('list');
        }

      } else {
        // --- INSERT ---
        const { data: insertData, error: insertError } = await supabase
          .from('user_handpans')
          .insert([{
            user_id: currentUser.id,
            name: `${builder} ${scaleName}`,
            builder: builder,
            scale_name: scaleName,
            top_image_url: topUrl, // Must exist
            bottom_image_url: bottomUrl,
            note_map: [],
            is_active: true
          }])
          .select()
          .single();

        if (insertError) throw insertError;

        closeMyScalesModal();
        startGuidedCalibration(insertData, (updatedData) => {
          enterCalibrationMode(updatedData);
        });
      }

    } catch (err) {
      console.error('Error saving handpan:', err);
      await alert('Error: ' + err.message);
    } finally {
      saveNewHandpanBtn.textContent = editingHandpanId ? 'Save Changes' : 'Next: Calibrate';
      saveNewHandpanBtn.disabled = false;
    }
  });
}

let lastStandardModel = 'Bronze';

export function initHandpanMap() {
  scaleSelect = document.getElementById('scaleSelect');
  handpanImg = document.getElementById('handpanImg');
  scaleStatus = document.getElementById('scaleStatus');
  handpanColorSelect = document.getElementById('handpanColorSelect');
  numberPitchSelect = document.getElementById('numberPitchSelect');
  showOctaveCheck = document.getElementById('showOctaveCheck');
  showOctaveRow = document.getElementById('showOctaveRow');
  ghostBtn = document.getElementById('ghostBtn');
  ghostBackBtn = document.getElementById('ghostBackBtn');
  ghostFwdBtn = document.getElementById('ghostFwdBtn');
  composeBtn = document.getElementById('composeBtn');
  handpanSection = document.getElementById('handpanSection');
  handpanOverlay = document.getElementById('handpanOverlay');
  myScalesBtn = document.getElementById('myScalesBtn');
  myScalesModal = document.getElementById('myScalesModal');
  myScalesPanel = new Modal(myScalesModal);
  closeMyScalesBtn = document.getElementById('closeMyScalesBtn');
  myScalesList = document.getElementById('myScalesList');
  calBtn = document.getElementById('calBtn');
  calibrateHandpanBtn = document.getElementById('calibrateHandpanBtn');
  hpSettingsToggle = document.getElementById('hpSettingsToggle');
  hpSettingsPanel = document.getElementById('hpSettingsPanel');
  hpSettingsInitial = document.getElementById('hpSettingsInitial') || document.getElementById('hpCustomizeControls');
  hpCreationForm = document.getElementById('hpCreationForm');
  buildScaleBtn = document.getElementById('buildScaleBtn');
  cancelBuildBtn = document.getElementById('cancelBuildBtn');
  saveNewHandpanBtn = document.getElementById('saveNewHandpanBtn');

  // Dual View Elements
  handpanWrapBottom = document.getElementById('handpanWrapBottom');
  handpanImgBottom = document.getElementById('handpanImgBottom');
  handpanOverlayBottom = document.getElementById('handpanOverlayBottom');

  if (!handpanOverlay) return;

  // Listeners
  myScalesBtn?.addEventListener('click', openMyScalesModal);
  closeMyScalesBtn?.addEventListener('click', closeMyScalesModal);
  myScalesModal?.addEventListener('click', (e) => {
    if (e.target === myScalesModal) closeMyScalesModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && myScalesModal?.classList.contains('open')) {
      closeMyScalesModal();
    }
  });

  function handleHandpanTap(e) {
    if (calibrating) {
      const dot = e.target.closest('.hp-dot');
      if (!dot) return;
      const note = dot.dataset.note;
      if (!note || !HANDPAN_MAP[note]) return;
      selectHpDot(note);
      return;
    }

    const dot = e.target.closest('.hp-dot');
    if (!dot) return;
    const rawNote = dot.dataset.note;
    if (!rawNote) return;
    const note = (rawNote === 'T_R' || rawNote === 'T_L') ? 'T'
               : (rawNote === 'S_R' || rawNote === 'S_L') ? 'S'
               : rawNote;

    playNoteByLabel(note, null);
    highlightHandpan(rawNote, null);

    const selIdx = activeGrid.caretIndex;
    if (selIdx === null) return;

    writeToSession(note, { advance: !e.altKey });
  }

  handpanOverlay?.addEventListener('click', handleHandpanTap);
  handpanOverlayBottom?.addEventListener('click', handleHandpanTap);

  function handleHandpanTouch(e) {
    if (calibrating) return;
    e.preventDefault(); // suppress follow-up click so single taps don't double-fire
    for (const touch of e.changedTouches) {
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const dot = el?.closest('.hp-dot');
      if (!dot) continue;
      const rawNote = dot.dataset.note;
      if (!rawNote) continue;
      const note = (rawNote === 'T_R' || rawNote === 'T_L') ? 'T'
                 : (rawNote === 'S_R' || rawNote === 'S_L') ? 'S'
                 : rawNote;
      playNoteByLabel(note, null);
      highlightHandpan(rawNote, null);
      if (activeGrid.caretIndex !== null) writeToSession(note, { advance: true });
    }
  }

  handpanOverlay?.addEventListener('touchstart', handleHandpanTouch, { passive: false });
  handpanOverlayBottom?.addEventListener('touchstart', handleHandpanTouch, { passive: false });

  handpanOverlayBottom?.addEventListener('mousedown', (e) => {
    if (!calibrating) return;
    const dot = e.target.closest('.hp-dot');
    if (!dot) return;
    e.preventDefault();
    const note = dot.dataset.note;
    if (!HANDPAN_MAP[note]) return;
    selectHpDot(note);
    isHpDragging = true;
    hpDragStart = { x: e.clientX, y: e.clientY };
    hpNoteStart = { x: HANDPAN_MAP[note].x, y: HANDPAN_MAP[note].y };
  });

  handpanOverlay?.addEventListener('mousedown', (e) => {
    if (!calibrating) return;
    const dot = e.target.closest('.hp-dot');
    if (!dot) return;
    e.preventDefault();
    const note = dot.dataset.note;
    if (!HANDPAN_MAP[note]) return;
    selectHpDot(note);
    isHpDragging = true;
    hpDragStart = { x: e.clientX, y: e.clientY };
    hpNoteStart = { x: HANDPAN_MAP[note].x, y: HANDPAN_MAP[note].y };
  });

  window.addEventListener('mousemove', (e) => {
    if (!isHpDragging || !calibrating || !selectedHpNote) return;
    const overlay = handpanOverlay.getBoundingClientRect();
    if (overlay.width === 0 || overlay.height === 0) return;
    const dxPx = e.clientX - hpDragStart.x;
    const dyPx = e.clientY - hpDragStart.y;
    const dxPct = (dxPx / overlay.width) * 100;
    const dyPct = (dyPx / overlay.height) * 100;
    const p = HANDPAN_MAP[selectedHpNote];
    p.x = clamp(hpNoteStart.x + dxPct, 0, 100);
    p.y = clamp(hpNoteStart.y + dyPct, 0, 100);
    const el = handpanDots.get(selectedHpNote);
    if (el) {
      el.style.left = `${p.x}%`;
      el.style.top = `${p.y}%`;
    }
  });

  window.addEventListener('mouseup', () => {
    if (isHpDragging) {
      isHpDragging = false;
      if (hpMapSaveTimeout) clearTimeout(hpMapSaveTimeout);
      hpMapSaveTimeout = setTimeout(saveHandpanPositions, 1000);
    }
  });

  handpanOverlay?.addEventListener('touchstart', (e) => {
    if (!calibrating) return;
    const dot = e.target.closest('.hp-dot');
    if (!dot) return;
    e.preventDefault();
    const note = dot.dataset.note;
    if (!HANDPAN_MAP[note]) return;
    selectHpDot(note);
    isHpDragging = true;
    const t = e.touches[0];
    hpDragStart = { x: t.clientX, y: t.clientY };
    hpNoteStart = { x: HANDPAN_MAP[note].x, y: HANDPAN_MAP[note].y };
  }, { passive: false });

  handpanOverlayBottom?.addEventListener('touchstart', (e) => {
    if (!calibrating) return;
    const dot = e.target.closest('.hp-dot');
    if (!dot) return;
    e.preventDefault();
    const note = dot.dataset.note;
    if (!HANDPAN_MAP[note]) return;
    selectHpDot(note);
    isHpDragging = true;
    const t = e.touches[0];
    hpDragStart = { x: t.clientX, y: t.clientY };
    hpNoteStart = { x: HANDPAN_MAP[note].x, y: HANDPAN_MAP[note].y };
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (!isHpDragging || !calibrating || !selectedHpNote) return;
    e.preventDefault();
    const t = e.touches[0];
    const overlay = handpanOverlay.getBoundingClientRect();
    const dxPx = t.clientX - hpDragStart.x;
    const dyPx = t.clientY - hpDragStart.y;
    const dxPct = (dxPx / overlay.width) * 100;
    const dyPct = (dyPx / overlay.height) * 100;
    const p = HANDPAN_MAP[selectedHpNote];
    p.x = clamp(hpNoteStart.x + dxPct, 0, 100);
    p.y = clamp(hpNoteStart.y + dyPct, 0, 100);
    const el = handpanDots.get(selectedHpNote);
    if (el) {
      el.style.left = `${p.x}%`;
      el.style.top = `${p.y}%`;
    }
  }, { passive: false });

  window.addEventListener('touchend', () => {
    if (isHpDragging) {
      isHpDragging = false;
      if (hpMapSaveTimeout) clearTimeout(hpMapSaveTimeout);
      hpMapSaveTimeout = setTimeout(saveHandpanPositions, 1000);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!calibrating) return;
    if (e.key === 'Escape') {
      setCalibrating(false);
      return;
    }
    if (e.key.toLowerCase() === 'c') {
      e.preventDefault();
      console.log('HANDPAN_MAP =', JSON.parse(JSON.stringify(HANDPAN_MAP)));
      console.log('Copy/paste version:\n' + stringifyHandpanMap(HANDPAN_MAP));
      return;
    }
    if (!selectedHpNote) return;
    const step = e.shiftKey ? 0.5 : 0.2;
    let dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    if (e.key === 'ArrowRight') dx = step;
    if (e.key === 'ArrowUp') dy = -step;
    if (e.key === 'ArrowDown') dy = step;
    if (!dx && !dy) return;
    e.preventDefault();
    const p = HANDPAN_MAP[selectedHpNote];
    p.x = clamp(p.x + dx, 0, 100);
    p.y = clamp(p.y + dy, 0, 100);
    const el = handpanDots.get(selectedHpNote);
    if (el) {
      el.style.left = `${p.x}%`;
      el.style.top = `${p.y}%`;
    }
    if (hpMapSaveTimeout) clearTimeout(hpMapSaveTimeout);
    hpMapSaveTimeout = setTimeout(saveHandpanPositions, 1000);
  });

  calBtn?.addEventListener('click', () => setCalibrating(!calibrating));

  calibrateHandpanBtn?.addEventListener('click', async () => {
    const val = scaleSelect.value;
    if (val.startsWith('custom:')) {
      const id = val.split(':')[1];
      const customHp = customHandpansCache.find(hp => hp.id === id);
      if (customHp) {
        if (hpSettingsPanel) hpSettingsPanel.style.display = 'none';
        hpSettingsToggle?.classList.remove('active');
        if (enterCalibrationMode) {
          enterCalibrationMode(customHp, () => {
            location.reload();
          });
        }
      } else {
        await alert('Custom handpan not found in cache.');
      }
    } else {
      await alert("You can only calibrate your own custom handpans. Create a custom handpan to customize it.");
    }
  });

  scaleSelect?.addEventListener('change', async () => {
    const val = scaleSelect.value;
    setSelectedScaleName(val);
    saveScaleLocal(val);
    if (isAuthed() && saveScaleRemote) saveScaleRemote(val);

    if (val.startsWith('custom:')) {
      const id = val.split(':')[1];
      const customHp = customHandpansCache.find(hp => hp.id === id);
      if (customHp) {
        applyCustomHandpan(customHp);
        if (currentUser) {
          await supabase.from('user_handpans').update({ is_active: false }).eq('user_id', currentUser.id);
          await supabase.from('user_handpans').update({ is_active: true }).eq('id', id);
        }
      }
      return;
    }

    scaleStatus.textContent = `Scale: ${val}`;

    // Explicitly hide flip button when switching to standard scales
    const flipBtn = document.getElementById('flipSideBtn');
    if (flipBtn) flipBtn.style.display = 'none';

    let currentModel = handpanColorSelect.value;
    const row = handpanColorSelect.closest('.setting-row');
    if (row) row.style.display = 'flex';

    if (currentModel.startsWith('custom:') || currentModel === 'Custom') {
      currentModel = lastStandardModel;
      handpanColorSelect.value = currentModel;
    }

    if (currentModel === 'Bronze') {
      changeHandpanImage(`${BASE_PATH}assets/images/${HANDPAN_IMG_BRONZE}`, () => {
        handpanImg.style.transform = '';
      });
      HANDPAN_MAP = HANDPAN_MAP_BRONZE;
    } else if (currentModel === 'Sketch') {
      changeHandpanImage(`${BASE_PATH}assets/images/${HANDPAN_IMG_SKETCH_EMPTY}`, () => {
        handpanImg.style.transform = '';
      });
      HANDPAN_MAP = HANDPAN_MAP_SKETCH;
    } else {
      // Rebuild overlay to ensure alignment even if model/image didn't change
      buildHandpanOverlay();
      setHandpanLoading(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => setHandpanLoading(false), 400);
        });
      });
    }

    if (setCurrentScale && SCALES) setCurrentScale(SCALES[val]);
    await preloadScaleSamples();
  });

  handpanColorSelect?.addEventListener('change', async () => {
    const val = handpanColorSelect.value;
    if (val === 'Bronze') {
      lastStandardModel = 'Bronze';
      changeHandpanImage(`${BASE_PATH}assets/images/${HANDPAN_IMG_BRONZE}`, () => {
        handpanImg.style.transform = '';
      });
      HANDPAN_MAP = HANDPAN_MAP_BRONZE;
    } else if (val === 'Sketch') {
      lastStandardModel = 'Sketch';
      changeHandpanImage(`${BASE_PATH}assets/images/${HANDPAN_IMG_SKETCH_EMPTY}`, () => {
        handpanImg.style.transform = '';
      });
      HANDPAN_MAP = HANDPAN_MAP_SKETCH;
    }
    updateLabelStyles();
  });

  let numberPitchTimer = null;
  numberPitchSelect?.addEventListener('change', async () => {
    const val = numberPitchSelect.value;
    localStorage.setItem('handpanLabelPref', val);
    updateUserLabelPreference(val);
    syncStateFromStorage();
    buildHandpanOverlay();

    // Debounce grid update as it's the heaviest operation
    clearTimeout(numberPitchTimer);
    numberPitchTimer = setTimeout(() => {
      updateGridLabels();
    }, 50);
  });

  showOctaveCheck?.addEventListener('change', () => {
    localStorage.setItem('handpanShowOctave', String(showOctaveCheck.checked));
    overlayNumberPitchNotes();
  });

  ghostBtn?.addEventListener('click', () => {
    writeToSession('', { advance: getComposeOn?.() ?? false });
  });

  ghostBackBtn?.addEventListener('click', () => {
    const idx = activeGrid.caretIndex;
    if (idx === null) return;
    setCaret(clampIndex(idx - 1));
  });

  ghostFwdBtn?.addEventListener('click', () => {
    const idx = activeGrid.caretIndex;
    if (idx === null) return;
    setCaret(clampIndex(idx + 1));
  });

  Bus.on(BUS_EVENT.CARET_CHANGED, () => {
    const hasCaret = activeGrid && activeGrid.caretIndex !== null;
    if (ghostBtn) ghostBtn.disabled = !hasCaret;
    if (ghostBackBtn) ghostBackBtn.disabled = !hasCaret;
    if (ghostFwdBtn) ghostFwdBtn.disabled = !hasCaret;
  });

  hpSettingsToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = hpSettingsPanel.style.display === 'none';
    hpSettingsPanel.style.display = isHidden ? 'block' : 'none';
    hpSettingsToggle.classList.toggle('active', isHidden);
  });

  cancelBuildBtn?.addEventListener('click', () => {
    // Return to list view within modal
    openMyScalesModal('list');
  });

  attachCreationListeners();
  initCameraUI();





  // Modal Manager for handpan drawers
  const drawerModals = {};
  ['handpanSettingsDrawer', 'chordDrawer', 'customizeDrawer'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const modal = new Modal(el, {
      onClose: () => document.querySelectorAll(`.tab-btn[data-tab="${id}"]`).forEach(b => b.classList.remove('active'))
    });
    drawerModals[id] = modal;
    el.querySelector('.close-modal-btn')?.addEventListener('click', () => modal.close());
  });

  buildScaleBtn?.addEventListener('click', () => {
    drawerModals['customizeDrawer'].close();
    openMyScalesModal('list');
  });

  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-tab');
      const modal = drawerModals[targetId];
      if (!modal) return;
      const wasOpen = modal.isOpen;
      Object.values(drawerModals).forEach(m => m.close());
      if (!wasOpen) {
        modal.open();
        btn.classList.add('active');
      }
    });
  });

  // Final initial calls
  registerHighlighter(highlightHandpan);

  // Build scale selection dropdown
  if (currentUser) {
    loadAllUserCustomHandpans();
  } else {
    buildScaleSelect();
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      buildHandpanOverlay();
    });
  });

  // Load handpan side preference
  const savedHandpanSide = localStorage.getItem('gp_handpanSide');
  if (savedHandpanSide) {
    currentHandpanSide = savedHandpanSide;
    toggleHandpanSide();
  }

  // Load label preference
  syncStateFromStorage();

  if (loadScaleLocal && scaleSelect) {
    let saved = loadScaleLocal();
    if (saved) {
      const exists = Array.from(scaleSelect.options).some(o => o.value === saved);
      if (exists || saved.startsWith('custom:')) {
        if (saved.startsWith('custom:')) {
          const id = saved.split(':')[1];
          const customHp = customHandpansCache.find(hp => hp.id === id);
          if (customHp) {
            saved = customHp.name;
          }
        }
        scaleSelect.value = saved;
        // scaleSelect.dispatchEvent(new Event('change'));
        console.log('Selected scale:', saved);
      }
    }
  }

  window.dispatchEvent(new Event('handpan-loaded'));

  // ResizeObserver for automatic realignment
  let lastWidth = 0;
  let lastHeight = 0;
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;

      // On mobile, minor layout shifts (address bar, scrolling) can cause sub-pixel or tiny shifts.
      // We use a 2px threshold to avoid flickering during animations or minor scrolling.
      const threshold = 2;

      if (Math.abs(width - lastWidth) > threshold || Math.abs(height - lastHeight) > threshold) {
        lastWidth = width;
        lastHeight = height;

        if (handpanImg && handpanImg.complete && handpanImg.naturalHeight !== 0 && !handpanLoadingOverlay?.classList.contains('active')) {
          console.log('[Handpan] Stabilized Rebuild Triggered');
          buildHandpanOverlay();
        }
      }
    }
  });
  if (handpanSection) resizeObserver.observe(handpanSection);
}

function buildScaleSelect() {
  console.log('Building scale select');
  if (!scaleSelect) return;
  scaleSelect.innerHTML = '';
  for (const name of Object.keys(SCALES)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    scaleSelect.appendChild(opt);
  }
}

function initCameraUI() {
  const cameraModal = document.getElementById('cameraModal');
  const video = document.getElementById('cameraVideo');
  const shutterBtn = document.getElementById('shutterBtn');
  const closeCameraBtn = document.getElementById('closeCameraBtn');
  const flipCameraBtn = document.getElementById('flipCameraBtn');
  const processingOverlay = document.getElementById('processingOverlay');

  // Find all "Take Photo" buttons


  document.querySelectorAll('[data-action="take-photo"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      currentCaptureType = btn.dataset.type;
      openCamera();
    });
  });

  // Clear camera captured blobs if user manually selects a file
  document.getElementById('hpTopImage')?.addEventListener('change', () => {
    capturedTopBlob = null;
  });
  document.getElementById('hpBottomImage')?.addEventListener('change', () => {
    capturedBottomBlob = null;
  });

  async function openCamera() {
    try {
      const constraints = {
        video: {
          facingMode: isFrontCamera ? 'user' : 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1920 }
        }
      };
      cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = cameraStream;
      cameraModal.classList.add('active');
    } catch (err) {
      console.error('Camera error:', err);
      alert('Could not access camera: ' + err.message);
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    cameraModal.classList.remove('active');
  }

  closeCameraBtn?.addEventListener('click', stopCamera);

  flipCameraBtn?.addEventListener('click', () => {
    isFrontCamera = !isFrontCamera;
    stopCamera();
    openCamera();
  });

  shutterBtn?.addEventListener('click', async () => {
    // 1. Capture and Crop to the UI Guide (280px)
    const canvas = document.createElement('canvas');

    // Calculate crop matching the 280px guide
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const viewWidth = video.clientWidth;
    const viewHeight = video.clientHeight;

    const guideSizeUI = 280;
    const ratio = videoWidth / viewWidth;
    const cropSize = guideSizeUI * ratio;

    // Center of the video
    const sourceX = (videoWidth - cropSize) / 2;
    const sourceY = (videoHeight - cropSize) / 2;

    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // Draw the square crop from the center
    ctx.drawImage(video, sourceX, sourceY, cropSize, cropSize, 0, 0, 1024, 1024);

    stopCamera();

    // Reset Progress UI
    const statusEl = document.getElementById('aiStatus');
    const progressEl = document.getElementById('aiProgressBar');
    if (statusEl) statusEl.textContent = 'Initializing AI...';
    if (progressEl) progressEl.style.width = '0%';

    processingOverlay.classList.add('active');

    try {
      // 2. Call Server-Side AI (Supabase Edge Function)
      if (statusEl) statusEl.textContent = 'Uploading to AI Server...';
      if (progressEl) progressEl.style.width = '30%';

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));

      const { data: result, error: fnError } = await supabase.functions.invoke('remove-background', {
        body: await blob.arrayBuffer(),
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      if (fnError) throw new Error(fnError.message || 'Server AI failed');
      if (result?.error) throw new Error(result.error);
      if (!result?.image) throw new Error('Server returned invalid data format.');
      const dataUrlToUse = result.image;

      if (statusEl) statusEl.textContent = 'Finishing...';
      if (progressEl) progressEl.style.width = '90%';

      // 3. Final Polish: Force a circular clip to remove any remaining artifacts
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = 1024;
      finalCanvas.height = 1024;
      const fCtx = finalCanvas.getContext('2d');

      const resultImg = new Image();
      resultImg.src = dataUrlToUse;
      await new Promise(r => resultImg.onload = r);



      fCtx.beginPath();
      fCtx.arc(512, 512, 510, 0, Math.PI * 2);
      fCtx.clip();
      fCtx.drawImage(resultImg, 0, 0, 1024, 1024);

      const finalBlob = await new Promise(resolve => finalCanvas.toBlob(resolve, 'image/png'));

      // 4. Store result
      if (currentCaptureType === 'top') {
        capturedTopBlob = finalBlob;
        document.getElementById('hpTopCameraIndicator').classList.add('active');
        document.getElementById('hpTopFileName').textContent = 'Camera Capture (Server-Cleaned)';
      } else {
        capturedBottomBlob = finalBlob;
        document.getElementById('hpBottomCameraIndicator').classList.add('active');
        document.getElementById('hpBottomFileName').textContent = 'Camera Capture (Server-Cleaned)';
      }

    } catch (err) {
      console.error('AI Processing error:', err);
      alert('Background removal failed: ' + err.message + '\n\nMake sure your Edge Function is deployed and CLOUDINARY secrets are set!');


      const rawBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (currentCaptureType === 'top') {
        capturedTopBlob = rawBlob;
        document.getElementById('hpTopCameraIndicator').classList.add('active');
      } else {
        capturedBottomBlob = rawBlob;
        document.getElementById('hpBottomCameraIndicator').classList.add('active');
      }
    } finally {
      processingOverlay.classList.remove('active');
    }
  });
}



export async function initScale() {
  let name = null;

  if (currentUser) name = await loadScaleRemote();
  if (!name) name = loadScaleLocal();
  if (!name) name = Object.keys(SCALES)[0];

  setSelectedScaleName(name);
  if (SCALES[name]) setCurrentScale(SCALES[name]);

  await preloadScaleSamples();

  // Re-apply the user's saved scale after login resolves (auth may not have
  // been ready when initScale() first ran).
  Bus.on(BUS_EVENT.AUTH_LOGIN, async () => {
    const remoteScaleName = await loadScaleRemote();
    // Always load custom handpans so they appear in the dropdown for signed-in users.
    await loadAllUserCustomHandpans();
    if (remoteScaleName) {
      setSelectedScaleName(remoteScaleName);
      if (SCALES[remoteScaleName]) setCurrentScale(SCALES[remoteScaleName]);
      await preloadScaleSamples();
    }
  });
}