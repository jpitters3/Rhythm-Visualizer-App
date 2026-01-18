/* Includes scale selector */

/* Mapped to nine-note-handpan-numbered.png */
const HANDPAN_MAP_SKETCH = {
  "D": { x: 50.3, y: 49.4, r: 12 },
  "1": { x: 63, y: 81.7, r: 12 },
  "2": { x: 33.9, y: 79.7, r: 12 },
  "3": { x: 81, y: 60.7, r: 11 },
  "4": { x: 18.6, y: 57.3, r: 11 },
  "5": { x: 78.6, y: 35, r: 10 },
  "6": { x: 21.9, y: 32.3, r: 10 },
  "7": { x: 61.2, y: 17.4, r: 9 },
  "8": { x: 38.6, y: 15.9, r: 9 },
  "T": { x: 60.3, y: 56.9, r: 5 },
  "S": { x: 94.1, y: 45.7, r: 7 },
};

/* Mapped to handpan-for-groovepan.png */
const HANDPAN_MAP_BRONZE = {
  "D": { x: 48.1, y: 47.4, r: 12 },
  "1": { x: 59.6, y: 80.9, r: 12 },
  "2": { x: 33.3, y: 80.5, r: 12 },
  "3": { x: 80, y: 62.4, r: 11 },
  "4": { x: 15.8, y: 59.1, r: 11 },
  "5": { x: 79.6, y: 34.8, r: 10 },
  "6": { x: 19.1, y: 31.9, r: 10 },
  "7": { x: 61.6, y: 17.2, r: 9 },
  "8": { x: 37.6, y: 16.5, r: 9 },
  "T": { x: 61.1, y: 56.3, r: 5 },
  "S": { x: 93.3, y: 47.9, r: 7 },
};

window.HANDPAN_MAP = HANDPAN_MAP_BRONZE;

// const HANDPAN_IMG_SKETCH = 'nine-note-handpan-numbered.png';
const HANDPAN_IMG_SKETCH_EMPTY = 'handpan-empty-notes.png';
const HANDPAN_IMG_BRONZE = 'handpan-for-groovepan.png';

const handpanOverlay = document.getElementById('handpanOverlay');
const handpanDots = new Map();

let overlayPitches = false;
let overlayNumbers = false;
let hpMapSaveTimeout = null;

// Custom Handpan Cache
let customHandpansCache = [];

async function loadAllUserHandpans() {
  if (!currentUser) return;

  const { data, error } = await supabase1
    .from('user_handpans')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (data) {
    customHandpansCache = data;
    renderCustomOptions();

    // Check for active custom scale
    const active = data.find(h => h.is_active);
    if (active) {
      applyCustomHandpan(active);
    }
  }
}

function renderCustomOptions() {
  // TARGET: scaleSelect (Musical Scales)

  // Remove old custom options
  Array.from(scaleSelect.options).forEach(opt => {
    if (opt.dataset.custom) opt.remove();
  });

  // Remove dividers if any left

  if (customHandpansCache.length > 0) {
    const divider = document.createElement('option');
    divider.disabled = true;
    divider.textContent = '── MY SCALES ──';
    divider.dataset.custom = 'true';
    scaleSelect.appendChild(divider);

    customHandpansCache.forEach(hp => {
      const opt = document.createElement('option');
      opt.value = `custom:${hp.id}`;
      opt.textContent = hp.name;
      opt.dataset.custom = 'true';
      scaleSelect.appendChild(opt);
    });
  }
}

function applyCustomHandpan(handpanData) {
  // Update Image
  handpanImg.src = handpanData.top_image_url;

  // Apply Image Rotation
  const rot = handpanData.image_rotation || 0;
  handpanImg.style.transform = `rotate(${rot}deg)`;

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

    // Visual Map (Label -> Visuals)
    newMap[label] = {
      x: (typeof tf.x === 'number') ? tf.x : 50,
      y: (typeof tf.y === 'number') ? tf.y : 50,
      r: r,
      width: tf.width || (r * 2),
      height: tf.height || (r * 2),
      rotation: tf.rotation || 0,
      id: tf.id, // Store ID for reverse lookup during save
    };

    // Musical Map (Label -> Pitch)
    if (label === 'Ding' || label === 'D') {
      dingPitch = key;
      // Also add to map just in case? No, ding is special property
      newMap['D'] = newMap[label]; // Ensure 'D' key exists visually if they named it 'Ding'
    } else {
      musicalMap[label] = key;
    }
  });

  window.HANDPAN_MAP = newMap;

  // Update Global Current Scale
  if (window.setCurrentScale) {
    window.setCurrentScale({
      ding: dingPitch,
      map: musicalMap
    });
  }

  selectedScaleName = `custom:${handpanData.id}`;

  preloadScaleSamples();

  // Update UI Selectors
  // Set Scale Select to this custom one
  scaleSelect.value = `custom:${handpanData.id}`;
  scaleStatus.textContent = `Custom Scale: ${handpanData.name}`;

  // Force Handpan Select to 'Custom' visual
  let opt = document.querySelector('#handpanSelect option[value="Custom"]');
  if (!opt) {
    opt = document.createElement('option');
    opt.value = 'Custom';
    opt.textContent = "Custom Image";
    handpanSelect.appendChild(opt);
  }
  handpanSelect.value = 'Custom';

  buildHandpanOverlay();
}

// === MY SCALES MANAGEMENT ===
const myScalesBtn = document.getElementById('myScalesBtn');
const myScalesModal = document.getElementById('myScalesModal');
const closeMyScalesBtn = document.getElementById('closeMyScalesBtn');
const myScalesList = document.getElementById('myScalesList');

myScalesBtn?.addEventListener('click', openMyScalesModal);
closeMyScalesBtn?.addEventListener('click', closeMyScalesModal);

// Close on Backdrop Click
myScalesModal.addEventListener('click', (e) => {
  if (e.target === myScalesModal) closeMyScalesModal();
});

// Close on Escape Key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && myScalesModal.classList.contains('open')) {
    closeMyScalesModal();
  }
});

function closeMyScalesModal() {
  myScalesModal.classList.remove('open');
  setTimeout(() => myScalesModal.style.display = 'none', 300); // Wait for transition
  myScalesModal.setAttribute('aria-hidden', 'true');
}

function openMyScalesModal() {
  myScalesModal.style.display = 'flex';
  setTimeout(() => myScalesModal.classList.add('open'), 10); // Small delay for transition
  myScalesModal.setAttribute('aria-hidden', 'false');
  renderMyScalesList();
  // Close dropdown
  document.getElementById('accountDropdownMenu')?.classList.remove('show');
}

function renderMyScalesList() {
  myScalesList.innerHTML = '';

  if (customHandpansCache.length === 0) {
    myScalesList.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">No custom scales yet.</div>';
    return;
  }

  customHandpansCache.forEach((hp, index) => {
    const item = document.createElement('div');
    item.className = 'scale-list-item';

    // --- Name Section (View/Edit) ---
    const nameDiv = document.createElement('div');
    nameDiv.className = 'scale-info';

    // View Mode
    const viewMode = document.createElement('div');
    viewMode.innerHTML = `
            <div class="scale-name-row">
                <span class="scale-name-text">${hp.name}</span>
                <button class="icon-btn edit-name-btn" title="Rename" style="font-size:12px;">✎</button>
            </div>
            <div class="scale-meta">${hp.builder} • ${hp.scale_name}</div>
        `;

    // Edit Mode
    const editMode = document.createElement('div');
    editMode.className = 'edit-mode-container';
    editMode.style.display = 'none';
    editMode.innerHTML = `
            <input type="text" class="rename-input" value="${hp.name}">
            <div class="rename-actions">
                <button class="small-action-btn save-btn-styles save-rename-btn">Save</button>
                <button class="small-action-btn cancel-btn-styles cancel-rename-btn">Cancel</button>
            </div>
        `;

    nameDiv.appendChild(viewMode);
    nameDiv.appendChild(editMode);

    // --- Actions Section ---
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'scale-actions';

    // Reorder Buttons
    const isFirst = index === 0;
    const isLast = index === customHandpansCache.length - 1;

    const upBtn = document.createElement('button');
    upBtn.innerHTML = '&#9650;'; // Up Arrow
    upBtn.className = 'icon-btn';
    upBtn.disabled = isFirst;
    upBtn.onclick = () => swapHandpanOrder(index, index - 1);

    const downBtn = document.createElement('button');
    downBtn.innerHTML = '&#9660;'; // Down Arrow
    downBtn.className = 'icon-btn';
    downBtn.disabled = isLast;
    downBtn.onclick = () => swapHandpanOrder(index, index + 1);

    // Edit Visuals Button (Calibration)
    const mapBtn = document.createElement('button');
    mapBtn.textContent = 'Edit Map';
    mapBtn.className = 'edit-map-btn';
    mapBtn.onclick = () => {
      // Close modal and enter calibration
      closeMyScalesModal();

      if (window.enterCalibrationMode) {
        window.enterCalibrationMode(hp, () => {
          // On Done: Re-open My Scales
          openMyScalesModal();
          // Reload list to reflect changes
          loadAllUserHandpans().then(renderMyScalesList);
        });
      }
    };

    // Delete Button
    const delBtn = document.createElement('button');
    delBtn.innerHTML = '&times;';
    delBtn.className = 'icon-btn danger-text';
    delBtn.title = 'Delete';
    delBtn.onclick = () => deleteUserHandpan(hp.id);

    actionsDiv.append(upBtn, downBtn, mapBtn, delBtn);
    item.append(nameDiv, actionsDiv);
    myScalesList.appendChild(item);

    // Listeners for Rename
    const editBtn = viewMode.querySelector('.edit-name-btn');
    const saveRenameBtn = editMode.querySelector('.save-rename-btn');
    const cancelRenameBtn = editMode.querySelector('.cancel-rename-btn');
    const input = editMode.querySelector('.rename-input');

    editBtn.onclick = () => {
      viewMode.style.display = 'none';
      editMode.style.display = 'block';
      input.focus();
    };

    cancelRenameBtn.onclick = () => {
      editMode.style.display = 'none';
      viewMode.style.display = 'block';
      input.value = hp.name; // reset
    };

    saveRenameBtn.onclick = async () => {
      const newName = input.value.trim();
      if (!newName || newName === hp.name) {
        cancelRenameBtn.click();
        return;
      }

      // Check local unique first
      if (customHandpansCache.some(h => h.name === newName)) {
        alert("A scale with this name already exists.");
        return;
      }

      const { error } = await supabase1
        .from('user_handpans')
        .update({ name: newName })
        .eq('id', hp.id);

      if (error) {
        alert("Error: " + error.message);
      } else {
        await loadAllUserHandpans(); // Reload to refresh list and dropdown
        renderMyScalesList();
      }
    };
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
    await supabase1.from('user_handpans').update({ sort_order: i }).eq('id', newCache[i].id);
  }
  // Also refresh dropdowns in background
  renderCustomOptions();
}

async function deleteUserHandpan(id) {
  if (!confirm("Are you sure you want to delete this scale? This cannot be undone.")) return;

  const { error } = await supabase1.from('user_handpans').delete().eq('id', id);
  if (error) {
    alert("Error deleting: " + error.message);
  } else {
    // Refresh
    await loadAllUserHandpans(); // Reloads cache and selects
    renderMyScalesList(); // Re-render modal list

    // Reset if we deleted the active one
    if (scaleSelect.value === `custom:${id}`) {
      location.reload(); // Simplest reset
    }
  }
}


// Expose
window.loadAllUserHandpans = loadAllUserHandpans;

function buildHandpanOverlay() {
  if (!handpanOverlay) return;
  handpanOverlay.innerHTML = '';
  handpanDots.clear();

  for (const [note, p] of Object.entries(window.HANDPAN_MAP)) {
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

    handpanOverlay.appendChild(dot);
    handpanDots.set(note, dot);
  }
  if (overlayPitches || overlayNumbers)
    overlayNumberPitchNotes(); else removeNoteLabels();
}

buildHandpanOverlay();

let hpPulseTimers = new Map();

function highlightHandpan(note, stepIndex) {
  const key = String(note || '').toUpperCase();
  const el = handpanDots.get(key);
  if (!el) return;

  // Sticking Override
  let down;
  const sticking = (window.innerHands && window.innerHands[stepIndex]);

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
  }, Math.min(220, intervalMs() * 0.9)));
}

/* Calibration */
const calBtn = document.getElementById('calBtn');
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

calBtn?.addEventListener('click', () => setCalibrating(!calibrating));

function selectHpDot(note) {
  selectedHpNote = note;
  for (const [k, el] of handpanDots.entries()) {
    el.classList.toggle('selected', k === note);
  }
}

// Click-to-select dots
handpanOverlay?.addEventListener('click', (e) => {
  if (calibrating) {
    const dot = e.target.closest('.hp-dot');
    if (!dot) return;
    const note = dot.dataset.note;
    if (!note || !HANDPAN_MAP[note]) return;
    selectHpDot(note);

  } else {
    // Play notes like a virtual handpan
    const dot = e.target.closest('.hp-dot');
    if (!dot) return;

    const note = dot.dataset.note;
    if (!note) return;

    // If not composing and nothing selected, we can still play sounds.
    // If a beat is selected, write to it.

    // Play note sound on click / tap
    playNoteByLabel(note, step);
    highlightHandpan(note, step);

    // If a beat is selected, write to it (Compose auto-advance applies)
    if (selectedIndex !== null) {
      // Alt click means "don’t advance"
      const noAdvance = e.altKey; // Alt = write without advancing
      writeToSelected(note, { advance: !noAdvance });
    }
  }
});

// Nudge with arrow keys
let isHpDragging = false;
let hpDragStart = { x: 0, y: 0 }; // px
let hpNoteStart = { x: 0, y: 0 }; // %

// Drag Start
handpanOverlay?.addEventListener('mousedown', (e) => {
  if (!calibrating) return;
  const dot = e.target.closest('.hp-dot');
  if (!dot) return;

  e.preventDefault(); // prevent text selection
  const note = dot.dataset.note;
  if (!window.HANDPAN_MAP[note]) return;

  selectHpDot(note); // Selects it visually

  isHpDragging = true;
  hpDragStart = { x: e.clientX, y: e.clientY };
  hpNoteStart = { x: window.HANDPAN_MAP[note].x, y: window.HANDPAN_MAP[note].y };
});

// Drag Move
window.addEventListener('mousemove', (e) => {
  if (!isHpDragging || !calibrating || !selectedHpNote) return;

  const overlay = handpanOverlay.getBoundingClientRect();
  if (overlay.width === 0 || overlay.height === 0) return;

  const dxPx = e.clientX - hpDragStart.x;
  const dyPx = e.clientY - hpDragStart.y;

  const dxPct = (dxPx / overlay.width) * 100;
  const dyPct = (dyPx / overlay.height) * 100;

  const p = window.HANDPAN_MAP[selectedHpNote];
  p.x = clamp(hpNoteStart.x + dxPct, 0, 100);
  p.y = clamp(hpNoteStart.y + dyPct, 0, 100);

  // Update DOM
  const el = handpanDots.get(selectedHpNote);
  if (el) {
    el.style.left = `${p.x}%`;
    el.style.top = `${p.y}%`;
  }
});

// Drag End
window.addEventListener('mouseup', () => {
  if (isHpDragging) {
    isHpDragging = false;
    // Trigger Save
    if (hpMapSaveTimeout) clearTimeout(hpMapSaveTimeout);
    hpMapSaveTimeout = setTimeout(saveHandpanPositions, 1000);
  }
});

/* Touch Support (Basic) */
handpanOverlay?.addEventListener('touchstart', (e) => {
  if (!calibrating) return;
  const dot = e.target.closest('.hp-dot');
  if (!dot) return;

  e.preventDefault(); // prevent scroll
  const note = dot.dataset.note;
  if (!window.HANDPAN_MAP[note]) return;

  selectHpDot(note);
  isHpDragging = true;
  const t = e.touches[0];
  hpDragStart = { x: t.clientX, y: t.clientY };
  hpNoteStart = { x: window.HANDPAN_MAP[note].x, y: window.HANDPAN_MAP[note].y };
}, { passive: false });

window.addEventListener('touchmove', (e) => {
  if (!isHpDragging || !calibrating || !selectedHpNote) return;
  e.preventDefault(); // prevent scroll
  const t = e.touches[0];
  const overlay = handpanOverlay.getBoundingClientRect();

  const dxPx = t.clientX - hpDragStart.x;
  const dyPx = t.clientY - hpDragStart.y;

  const dxPct = (dxPx / overlay.width) * 100;
  const dyPct = (dyPx / overlay.height) * 100;

  const p = window.HANDPAN_MAP[selectedHpNote];
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


// Nudge with arrow keys
document.addEventListener('keydown', (e) => {
  if (!calibrating) return;

  // Esc exits calibration
  if (e.key === 'Escape') {
    setCalibrating(false);
    return;
  }

  // C prints current map
  if (e.key.toLowerCase() === 'c') {
    e.preventDefault();
    console.log('HANDPAN_MAP =', JSON.parse(JSON.stringify(window.HANDPAN_MAP)));
    console.log('Copy/paste version:\n' + stringifyHandpanMap(window.HANDPAN_MAP));
    return;
  }

  if (!selectedHpNote) return;

  const step = e.shiftKey ? 0.5 : 0.2; // percent increments
  let dx = 0, dy = 0;

  if (e.key === 'ArrowLeft') dx = -step;
  if (e.key === 'ArrowRight') dx = step;
  if (e.key === 'ArrowUp') dy = -step;
  if (e.key === 'ArrowDown') dy = step;

  if (!dx && !dy) return;

  e.preventDefault();

  const p = window.HANDPAN_MAP[selectedHpNote];
  p.x = clamp(p.x + dx, 0, 100);
  p.y = clamp(p.y + dy, 0, 100);

  // Update DOM position live
  const el = handpanDots.get(selectedHpNote);
  if (el) {
    el.style.left = `${p.x}%`;
    el.style.top = `${p.y}%`;
  }

  if (hpMapSaveTimeout) clearTimeout(hpMapSaveTimeout);
  hpMapSaveTimeout = setTimeout(saveHandpanPositions, 1000); // Auto-save after 1s of inactivity
});

async function saveHandpanPositions() {
  if (!selectedScaleName.startsWith('custom:')) return;
  const hpId = selectedScaleName.split(':')[1];

  const customHp = customHandpansCache.find(hp => hp.id === hpId);
  if (!customHp) return;

  // Verify ownership? (RLS handles it, but good to check)
  if (!currentUser || customHp.user_id !== currentUser.id) return;

  let changed = false;

  // Update the data model from the Visual Map
  for (const [note, p] of Object.entries(window.HANDPAN_MAP)) {
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
    const { error } = await supabase1
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

// Event handlers

scaleSelect.addEventListener('change', async () => {
  selectedScaleName = scaleSelect.value;

  if (selectedScaleName.startsWith('custom:')) {
    const id = selectedScaleName.split(':')[1];
    const customHp = customHandpansCache.find(hp => hp.id === id);
    if (customHp) {
      applyCustomHandpan(customHp);
      // Update active status
      if (currentUser) {
        await supabase1.from('user_handpans').update({ is_active: false }).eq('user_id', currentUser.id);
        await supabase1.from('user_handpans').update({ is_active: true }).eq('id', id);
      }
    }
    return;
  }

  scaleStatus.textContent = `Scale: ${selectedScaleName}`;
  saveScaleLocal(selectedScaleName);

  // Update Current Scale for Standard Scales
  if (window.setCurrentScale && window.SCALES) {
    window.setCurrentScale(window.SCALES[selectedScaleName]);
  }

  await preloadScaleSamples();
  if (currentUser) await saveScaleRemote(selectedScaleName);
  checkNumberPitchSelection();
  buildHandpanOverlay();
});

handpanSelect.addEventListener('change', async () => {
  selectedHandpanName = handpanSelect.value;

  if (selectedHandpanName.startsWith('custom:')) {
    const id = selectedHandpanName.split(':')[1];
    const customHp = customHandpansCache.find(hp => hp.id === id);
    if (customHp) {
      applyCustomHandpan(customHp);
      // Important: Update active status in DB
      if (currentUser) {
        await supabase1.from('user_handpans').update({ is_active: false }).eq('user_id', currentUser.id);
        await supabase1.from('user_handpans').update({ is_active: true }).eq('id', id);
      }
    }
    return;
  }

  if (selectedHandpanName === 'Bronze') {
    handpanImg.src = `./assets/images/${HANDPAN_IMG_BRONZE}`;
    handpanImg.style.transform = ''; // Reset rotation
    window.HANDPAN_MAP = HANDPAN_MAP_BRONZE;

  }
  else if (selectedHandpanName === 'Sketch') {
    handpanImg.src = `./assets/images/${HANDPAN_IMG_SKETCH_EMPTY}`;
    handpanImg.style.transform = ''; // Reset rotation
    window.HANDPAN_MAP = HANDPAN_MAP_SKETCH;
  }
  checkNumberPitchSelection();
  buildHandpanOverlay();
});

function checkNumberPitchSelection() {
  const val = numberPitchSelect.value;
  if (val === 'Numbers') {
    overlayNumbers = true;
    overlayPitches = false;
  } else if (val === 'Pitches') {
    overlayNumbers = false;
    overlayPitches = true;
  } else {
    // Default: Check handpan type?
    // If Sketch (numbered), default to Numbers?
    if (handpanSelect.value === 'Sketch') {
      overlayNumbers = true;
      overlayPitches = false;
      numberPitchSelect.value = 'Numbers';
    } else {
      overlayNumbers = false;
      overlayPitches = false;
    }
  }
}

function removeNoteLabels() {
  document.querySelectorAll('.hp-label').forEach(el => el.remove());
}

function overlayNumberPitchNotes() {
  removeNoteLabels();

  const isCustom = scaleSelect.value.startsWith('custom:');

  for (const [note, el] of handpanDots.entries()) {
    const p = window.HANDPAN_MAP[note];
    if (!p) continue;

    const label = document.createElement('div');
    label.className = 'hp-label';
    let text = '';

    if (overlayNumbers) {
      // Unified Logic
      text = note; // Default to key (e.g. "1", "2" or "A3")

      const scale = typeof getScale === 'function' ? getScale() : null;
      const dingPitch = scale ? scale.ding : 'D3';

      // General Ding Detection (for both 'D' label and Pitch keys)
      if (note === 'D' || note === dingPitch) {
        text = '';
      }
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

    label.textContent = text;

    // Position center
    label.style.position = 'absolute';
    label.style.left = '50%';
    label.style.top = '50%';
    label.style.transform = 'translate(-50%, -50%)';
    label.style.color = 'white';
    label.style.fontWeight = 'bold';
    label.style.pointerEvents = 'none';
    label.style.textShadow = '0 1px 2px black';
    label.style.zIndex = '10'; // Ensure above dot

    el.appendChild(label);
  }
}

// Ensure buildHandpanOverlay calls this
const originalBuild = buildHandpanOverlay;

numberPitchSelect.addEventListener('change', async () => {
  localStorage.setItem('handpanLabelPref', numberPitchSelect.value);
  checkNumberPitchSelection();
  buildHandpanOverlay();
});

// Initial Load
const savedLabelPref = localStorage.getItem('handpanLabelPref');
if (savedLabelPref) {
  numberPitchSelect.value = savedLabelPref;
  checkNumberPitchSelection();
}

ghostBtn.addEventListener('click', (e) => {
  const idx = (caretIndex !== null) ? caretIndex : (typeof selectedIndex !== 'undefined' ? selectedIndex : null);
  if (idx === null) return;

  setBeatToGhost(idx);

  // If your "compose/tracking" is enabled, advance:
  if (composeOn) { // rename to your actual flag
    const next = clampIndex(idx + 1);
    setCaret(next);
  }
});

lockBtn.addEventListener('click', (e) => {
  composeBtn.click();
});

// Settings Toggle
const hpSettingsToggle = document.getElementById('hpSettingsToggle');
const hpSettingsPanel = document.getElementById('hpSettingsPanel');

hpSettingsToggle?.addEventListener('click', (e) => {
  e.stopPropagation();
  const isHidden = hpSettingsPanel.style.display === 'none';
  hpSettingsPanel.style.display = isHidden ? 'block' : 'none';
  hpSettingsToggle.classList.toggle('active', isHidden);
});

// === CUSTOM HANDPAN UI ===
const hpSettingsInitial = document.getElementById('hpSettingsInitial');
const hpCreationForm = document.getElementById('hpCreationForm');
const buildScaleBtn = document.getElementById('buildScaleBtn');
const cancelBuildBtn = document.getElementById('cancelBuildBtn');
const saveNewHandpanBtn = document.getElementById('saveNewHandpanBtn');

buildScaleBtn?.addEventListener('click', () => {
  hpSettingsInitial.style.display = 'none';
  hpCreationForm.style.display = 'flex';
});

cancelBuildBtn?.addEventListener('click', () => {
  hpCreationForm.style.display = 'none';
  hpSettingsInitial.style.display = 'block';
});

saveNewHandpanBtn?.addEventListener('click', async () => {
  const builder = document.getElementById('hpBuilderName').value.trim();
  const scaleName = document.getElementById('hpScaleName').value.trim();
  const topImageFile = document.getElementById('hpTopImage').files[0];

  if (!builder || !scaleName || !topImageFile) {
    alert('Please fill in Builder, Scale Name, and select a Top Image.');
    return;
  }

  if (!currentUser) {
    alert('You must be signed in to create a custom handpan.');
    return;
  }

  saveNewHandpanBtn.textContent = 'Uploading...';
  saveNewHandpanBtn.disabled = true;

  try {
    // 1. Upload Image
    const fileExt = topImageFile.name.split('.').pop();
    const fileName = `${currentUser.id}_${Date.now()}.${fileExt}`;
    const { data: uploadData, error: uploadError } = await supabase1
      .storage
      .from('handpan-images')
      .upload(fileName, topImageFile);

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase1.storage.from('handpan-images').getPublicUrl(fileName);

    // 2. Insert DB Record
    const { data: insertData, error: insertError } = await supabase1
      .from('user_handpans')
      .insert([{
        user_id: currentUser.id,
        name: `${builder} ${scaleName}`,
        builder: builder,
        scale_name: scaleName,
        top_image_url: publicUrl,
        note_map: [], // Empty init
        is_active: true
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    // 3. Success -> Go to Calibration
    alert('Saved! Entering calibration mode...');
    if (window.enterCalibrationMode) {
      enterCalibrationMode(insertData);
      // Hide the creation form
      hpCreationForm.style.display = 'none';
      hpSettingsPanel.style.display = 'none';
      hpSettingsToggle.classList.remove('active');
    } else {
      console.error('enterCalibrationMode not found');
      location.reload(); // Fallback
    }

  } catch (err) {
    console.error('Error creating handpan:', err);
    alert('Error saving handpan: ' + err.message);
  } finally {
    saveNewHandpanBtn.textContent = 'Next: Calibrate';
    saveNewHandpanBtn.disabled = false;
  }
});