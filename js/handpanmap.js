import { currentUser } from './state.js';
import { setCaret } from './range-selection.js';
import { updateUserLabelPreference } from './profile.js';
import { writeToSelected, clampIndex, getComposeOn } from './compose-mode.js';
import { preloadScaleSamples, noteForLabel, isDownbeatStep, registerHighlighter, playNoteByLabel, intervalMs } from './noteplayer.js';
import { SCALES, SCALE_KEY_LOCAL, BASE_PATH } from './config.js';
import { getScale, getSelectedScaleName, setSelectedScaleName, setCurrentScale } from './state.js';
import { supabase } from './supabase-client.js';
import { enterCalibrationMode } from './calibration.js';
import { activeGrid } from './grid-context.js';
import { Bus, BUS_EVENT } from './bus.js';
import { setBeatToGhost, renderAllMeasures } from './notegrid.js';
import { isAuthed } from './auth.js';

// DOM Elements (previously globals)
let handpanImg, scaleSelect, scaleStatus, handpanColorSelect, numberPitchSelect, ghostBtn, lockBtn, composeBtn, handpanSection, handpanOverlay;
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
  "T": { x: 60.3, y: 56.9, r: 5 },
  "S": { x: 94.1, y: 45.7, r: 7 },
};

const HANDPAN_MAP_BRONZE = {
  "Ding": { x: 48.1, y: 45.6, r: 12 },
  "1": { x: 59.6, y: 76.6, r: 10 },
  "2": { x: 34.4, y: 75.3, r: 10 },
  "3": { x: 78.4, y: 59.9, r: 10 },
  "4": { x: 17.4, y: 57.3, r: 10 },
  "5": { x: 78, y: 33.9, r: 9 },
  "6": { x: 21.8, y: 32.8, r: 9 },
  "7": { x: 61.4, y: 18.1, r: 8 },
  "8": { x: 37.8, y: 17.9, r: 8 },
  "T": { x: 61.1, y: 56.3, r: 7 },
  "S": { x: 93.3, y: 47.9, r: 6 },
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

export function toggleHandpanSide() {
  if (!mountedHandpanData || !mountedHandpanData.bottom_image_url) return;

  // Cycle: Top -> Bottom -> Dual -> Both -> Top
  if (currentHandpanSide === 'top') {
    currentHandpanSide = 'bottom';
  } else if (currentHandpanSide === 'bottom') {
    currentHandpanSide = 'dual';
  } else if (currentHandpanSide === 'dual') {
    currentHandpanSide = 'both';
  } else {
    currentHandpanSide = 'top';
  }

  localStorage.setItem('gp_handpanSide', currentHandpanSide);

  // Update toggle button state
  const flipBtn = document.getElementById('flipSideBtn');
  if (flipBtn) {
    flipBtn.classList.remove('flipped', 'both');
    if (currentHandpanSide === 'bottom') flipBtn.classList.add('flipped');

    if (currentHandpanSide === 'both') {
      flipBtn.classList.add('both');
      flipBtn.textContent = '∞';
      flipBtn.title = "Showing All Notes (merged)";
    } else if (currentHandpanSide === 'dual') {
      flipBtn.textContent = '⩓';
      flipBtn.title = "Dual View (Stacked)";
    } else {
      flipBtn.textContent = '🔄';
      flipBtn.title = (currentHandpanSide === 'top') ? "Flip to Bottom" : "Flip to All";
    }
  }

  // Visuals Logic
  // Dual Mode: Show Bottom Wrap, Set Bottom Image
  if (currentHandpanSide === 'dual') {
    if (handpanWrapBottom) handpanWrapBottom.style.display = 'block';
    if (handpanImgBottom) handpanImgBottom.src = mountedHandpanData.bottom_image_url;
    // Top image stays as top
    changeHandpanImage(mountedHandpanData.top_image_url);
  } else {
    if (handpanWrapBottom) handpanWrapBottom.style.display = 'none';
    if (handpanImgBottom) handpanImgBottom.src = ""; // Clear to save memory?

    // Update Single Image (Both uses Top by default)
    const imgSide = (currentHandpanSide === 'bottom') ? 'bottom' : 'top';
    const targetSrc = (imgSide === 'top') ? mountedHandpanData.top_image_url : mountedHandpanData.bottom_image_url;
    changeHandpanImage(targetSrc);
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

    if (currentHandpanSide === 'both') {
      include = true;
      if (noteSide !== 'top') isGhost = true;
    } else if (currentHandpanSide === 'dual') {
      include = true;
      // No ghost flags for dual mode, they just go to different overlays
      // But we can set isGhost false explicitly
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

  // Update Visual Map ONLY. 
  // We must NOT nuke the Musical Map in `currentScale` because notes on the other side should still make sound if triggered by MIDI/Keyboard.
  // However, HANDPAN_MAP determines what is drawn.
  HANDPAN_MAP = newMap;
  // buildHandpanOverlay() is now handled by img.onload above
}

// === MY SCALES MANAGEMENT ===
let myScalesBtn, myScalesModal, closeMyScalesBtn, myScalesList;

function closeMyScalesModal() {
  myScalesModal.classList.remove('open');
  setTimeout(() => myScalesModal.style.display = 'none', 300); // Wait for transition
  myScalesModal.setAttribute('aria-hidden', 'true');
}


async function openMyScalesModal(view = 'list') {
  myScalesModal.style.display = 'flex';
  setTimeout(() => myScalesModal.classList.add('open'), 10);
  myScalesModal.setAttribute('aria-hidden', 'false');

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
  createContainer.style.marginBottom = '10px';
  createContainer.style.marginTop = '10px';
  createContainer.style.textAlign = 'center';
  const createBtn = document.createElement('button');
  createBtn.id = 'createHandpanBtn';
  createBtn.className = 'primary-btn small-btn';
  createBtn.textContent = '+ Create New Handpan';
  createBtn.onclick = () => {
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

  // Append create button at the bottom
  myScalesList.appendChild(createContainer);
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
  if (!confirm("Are you sure you want to delete this scale? This cannot be undone.")) return;

  const { error } = await supabase.from('user_handpans').delete().eq('id', id);
  if (error) {
    alert("Error deleting: " + error.message);
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

  for (const [note, p] of Object.entries(HANDPAN_MAP)) {
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
    handpanDots.set(note, dot);
  }
  if (overlayPitches || overlayNumbers)
    overlayNumberPitchNotes(); else removeNoteLabels();
}

let hpPulseTimers = new Map();

export function highlightHandpan(note, stepIndex, forceHand = null) {
  const key = String(note || '').toUpperCase();
  const el = handpanDots.get(key);
  if (!el) return;

  // Sticking Override
  let down;
  const sticking = forceHand || (activeGrid.innerHands && activeGrid.innerHands[stepIndex]);

  if (sticking === 'R') {
    down = true;
  } else if (sticking === 'L') {
    down = false;
  } else {
    down = isDownbeatStep(stepIndex);
  }

  el.classList.remove('hp-down', 'hp-up', 'active');
  el.classList.add(down ? 'hp-down' : 'hp-up');

  // restart animation
  void el.offsetWidth;
  el.classList.add('active');

  // per-note timer so multiple notes in a row don't fight
  clearTimeout(hpPulseTimers.get(key));
  hpPulseTimers.set(key, setTimeout(() => {
    el.classList.remove('active', 'hp-down', 'hp-up');
  }, Math.min(500, intervalMs() * 0.9)));
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

  // Clear selection when exiting
  if (!on) {
    selectedHpNote = null;
    for (const el of handpanDots.values()) el.classList.remove('selected');
  }
}


function selectHpDot(note) {
  selectedHpNote = note;
  for (const [k, el] of handpanDots.entries()) {
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
    if (!p.id) continue; // Not a custom note with ID
    const tf = customHp.note_map.find(t => t.id === p.id);
    if (tf) {
      if (tf.x !== p.x || tf.y !== p.y) {
        tf.x = p.x;
        tf.y = p.y;
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
    // Reset or handle default behavior
    overlayNumbers = true;
    overlayPitches = false;
  }
}

function updateLabelStyles() {
  if (!handpanOverlay) return;

  // Set data attribute on parent to let CSS handle styles
  // This avoids loop and setTimeout
  const color = handpanColorSelect ? handpanColorSelect.value : 'Bronze';
  handpanOverlay.dataset.model = color;
}

function removeNoteLabels() {
  document.querySelectorAll('.hp-label').forEach(el => el.remove());
}

function overlayNumberPitchNotes() {
  removeNoteLabels();

  const isCustom = scaleSelect.value.startsWith('custom:');

  for (const [note, el] of handpanDots.entries()) {
    const p = HANDPAN_MAP[note];
    if (!p) continue;

    const label = document.createElement('div');
    label.className = 'hp-label';
    let text = '';

    if (overlayNumbers) {
      // Unified Logic
      text = note; // Default to key (e.g. "1", "2" or "A3")
    } else if (overlayPitches) {
      // Unified: Look up pitch for the label
      if (typeof noteForLabel === 'function') {
        const pitch = noteForLabel(note);
        // Clean up pitch string? e.g. "Cs4" -> "C#4"?
        // Also handle if pitch is file path? (Unified map stores "A3", "C#4")
        text = pitch ? pitch.replace('s', '#') : '';

        if (note === 'T' || note === 'S') text = note;
      } else {
        text = note;
      }
    }

    // Never show label for Ding
    // Check key ('D'), full label ('Ding'), or if it matches current scale ding pitch
    const scale = typeof getScale === 'function' ? getScale() : null;
    const dingPitch = scale ? scale.ding : 'D3'; // Default to D3

    // Check note key (e.g. 'D') or resolved pitch text (e.g. 'D3_ding')
    // noteForLabel('D') returns 'D3_ding' usually.
    if (note === 'D' || note === 'Ding' || text.includes('_ding') || text === dingPitch) {
      text = '';
    }

    label.textContent = text;

    el.appendChild(label);
  }
}

// Ensure buildHandpanOverlay calls this
const originalBuild = buildHandpanOverlay;




// Settings Toggle
let hpSettingsToggle, hpSettingsPanel, hpSettingsInitial, hpCreationForm, buildScaleBtn, cancelBuildBtn, saveNewHandpanBtn;

// Settings Toggle


function attachCreationListeners() {
  saveNewHandpanBtn?.addEventListener('click', async () => {
    const builder = document.getElementById('hpBuilderName').value.trim();
    const scaleName = document.getElementById('hpScaleName').value.trim();
    const topImageFile = document.getElementById('hpTopImage').files[0];
    const bottomImageFile = document.getElementById('hpBottomImage').files[0];

    // Validation: 
    // If creating new (no ID), need Top Image.
    // If editing (has ID), Top Image is optional (keep existing).
    if (!builder || !scaleName) {
      alert('Please fill in Builder and Scale Name.');
      return;
    }
    if (!editingHandpanId && !topImageFile) {
      alert('Please select a Top Image for a new handpan.');
      return;
    }

    if (!currentUser) {
      alert('You must be signed in.');
      return;
    }

    saveNewHandpanBtn.textContent = editingHandpanId ? 'Saving Changes...' : 'Uploading...';
    saveNewHandpanBtn.disabled = true;

    try {
      let topUrl = null;
      let bottomUrl = null;

      // 1. Upload Top Image (if provided)
      if (topImageFile) {
        const fileExt = topImageFile.name.split('.').pop();
        const fileName = `${currentUser.id}_${Date.now()}_top.${fileExt}`;
        const { data: uploadData, error: uploadError } = await supabase.storage.from('handpan-images').upload(fileName, topImageFile);
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('handpan-images').getPublicUrl(fileName);
        topUrl = publicUrl;
      }

      // 2. Upload Bottom Image (if provided)
      if (bottomImageFile) {
        const bExt = bottomImageFile.name.split('.').pop();
        const bName = `${currentUser.id}_${Date.now()}_bottom.${bExt}`;
        const { data: bData, error: bError } = await supabase.storage.from('handpan-images').upload(bName, bottomImageFile);
        if (bError) throw bError;
        const { data: { publicUrl: bPubUrl } } = supabase.storage.from('handpan-images').getPublicUrl(bName);
        bottomUrl = bPubUrl;
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

        alert('Handpan updated successfully!');
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

        alert('Saved! Entering calibration mode...');
        if (enterCalibrationMode) {
          enterCalibrationMode(insertData);
          // Hide modal completely for calibration
          closeMyScalesModal();
        } else {
          location.reload();
        }
      }

    } catch (err) {
      console.error('Error saving handpan:', err);
      alert('Error: ' + err.message);
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
  ghostBtn = document.getElementById('ghostBtn');
  lockBtn = document.getElementById('lockBtn');
  composeBtn = document.getElementById('composeBtn');
  handpanSection = document.getElementById('handpanSection');
  handpanOverlay = document.getElementById('handpanOverlay');
  myScalesBtn = document.getElementById('myScalesBtn');
  myScalesModal = document.getElementById('myScalesModal');
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

  handpanOverlay?.addEventListener('click', (e) => {
    if (calibrating) {
      const dot = e.target.closest('.hp-dot');
      if (!dot) return;
      const note = dot.dataset.note;
      if (!note || !HANDPAN_MAP[note]) return;
      selectHpDot(note);
    } else {
      const dot = e.target.closest('.hp-dot');
      if (!dot) return;
      const note = dot.dataset.note;
      if (!note) return;
      playNoteByLabel(note, null);
      highlightHandpan(note, null);
      const selIdx = activeGrid.caretIndex;
      if (selIdx !== null) {
        const noAdvance = e.altKey;
        writeToSelected(note, { advance: !noAdvance });
      }
    }
  });

  handpanOverlayBottom?.addEventListener('click', (e) => {
    // Same logic as handpanOverlay click
    if (calibrating) {
      const dot = e.target.closest('.hp-dot');
      if (!dot) return;
      const note = dot.dataset.note;
      if (!note || !HANDPAN_MAP[note]) return;
      selectHpDot(note);
    } else {
      const dot = e.target.closest('.hp-dot');
      if (!dot) return;
      const note = dot.dataset.note;
      if (!note) return;
      playNoteByLabel(note, null);
      highlightHandpan(note, null);
      const selIdx = activeGrid.caretIndex;
      if (selIdx !== null) {
        const noAdvance = e.altKey;
        writeToSelected(note, { advance: !noAdvance });
      }
    }
  });

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

  calibrateHandpanBtn?.addEventListener('click', () => {
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
        alert('Custom handpan not found in cache.');
      }
    } else {
      alert("You can only calibrate your own custom handpans. Create a custom handpan to customize it.");
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

  numberPitchSelect?.addEventListener('change', async () => {
    const val = numberPitchSelect.value;
    localStorage.setItem('handpanLabelPref', val);
    updateUserLabelPreference(val);
    syncStateFromStorage();
    buildHandpanOverlay();
    renderAllMeasures();
  });

  ghostBtn?.addEventListener('click', () => {
    const idx = activeGrid.caretIndex;
    if (idx === null) return;
    setBeatToGhost(idx);
    if (getComposeOn && getComposeOn()) {
      setCaret(clampIndex(idx + 1));
    }
  });

  lockBtn?.addEventListener('click', () => composeBtn?.click());

  hpSettingsToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = hpSettingsPanel.style.display === 'none';
    hpSettingsPanel.style.display = isHidden ? 'block' : 'none';
    hpSettingsToggle.classList.toggle('active', isHidden);
  });

  buildScaleBtn?.addEventListener('click', () => {
    // If user has scales, open list ("Manage My Handpans")
    // If not, open creation form directly
    if (customHandpansCache.length > 0) {
      openMyScalesModal('list');
    } else {
      openMyScalesModal('form');
      openHandpanForm(null); // Reset form
    }
  });

  cancelBuildBtn?.addEventListener('click', () => {
    // Return to list view within modal
    openMyScalesModal('list');
  });

  attachCreationListeners();

  // Tab Manager logic
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');
  tabs.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-tab');
      const targetPane = document.getElementById(targetId);
      if (!targetPane) return;
      const wasActive = btn.classList.contains('active');
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      if (!wasActive) {
        btn.classList.add('active');
        targetPane.classList.add('active');
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
  const resizeObserver = new ResizeObserver(() => {
    // Only rebuild if image is actually loaded/visible
    if (handpanImg && handpanImg.complete && handpanImg.naturalHeight !== 0 && !handpanLoadingOverlay?.classList.contains('active')) {
      buildHandpanOverlay();
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

export async function initScale() {
  let name = null;

  if (currentUser) name = await loadScaleRemote();
  if (!name) name = loadScaleLocal();
  if (!name) name = Object.keys(SCALES)[0];

  setSelectedScaleName(name);

  await preloadScaleSamples();
}