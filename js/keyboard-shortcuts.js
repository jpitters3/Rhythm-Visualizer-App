// ===== KEYBOARD LABELING + SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

  // Esc
  if (e.key === 'Escape') {

    // 1. Check Groove Modal
    if (grooveModal.classList.contains('open')) {
      closeGrooveModal();
      return;
    }

    // 2. Check Course Modal
    if (courseModal?.classList.contains('open')) {
      closeCourseCreator(); // Defined in course-creator.js
      return;
    }

    // 3. Check Course Sidebar
    if (sidebar?.classList.contains('open')) {
      closeSidebar();
      return;
    }

    // Other Esc actions
    if (document.body.classList.contains('present')) {
      setPresentation(false);
      return;
    }

    clearSelection();
    clearRange();
    return;
  }

  // Metronome shortcut
  if (e.key.toLowerCase() === 'm') {
    metronomeOn = !metronomeOn;
    localStorage.setItem(METRO_KEY, metronomeOn ? 'on' : 'off');
    updateMetroUI();
    if (metronomeOn) ensureAudio();
    return;
  }

  // Enter: Groove modal 'Go!'
  if (grooveModal?.classList?.contains('open') && e.key === 'Enter') {
    e.preventDefault();
    grooveGo?.click();
    return;
  }

  // Cmd/Ctrl+C / V for selection
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const mod = isMac ? e.metaKey : e.ctrlKey;

  if (mod && e.key.toLowerCase() === 'c') {
    const r = getRange();
    if (r && r.length >= 1) {
      e.preventDefault();
      copySelection();
    }
  }

  if (mod && e.key.toLowerCase() === 'v') {
    if (beatClipboard) {
      e.preventDefault();
      pasteSelection();
    }
  }

  // Esc cancels range selection
  if (e.key === 'Escape') {
    const r = getRange();
    if (r && r.length > 1) {
      clearRange();
      return;
    }
  }

  // Enter: Play / Stop
  if (e.code === 'Space') {
    e.preventDefault();
    if (playing) stop();
    else start();
    return;
  }

  // From this point onwards in this function,
  // assign the beat to a ding, tak, slap, or note
  // based on the key that was pressed
  if (selectedIndex === null) return;

  const noAdvance = e.altKey; // Alt = write without advancing

  const k = e.key;
  const lower = k.toLowerCase();
  const map = { d: 'D', t: 'T', s: 'S' };

  if (map[lower]) {
    writeToSelected(map[lower], { advance: !noAdvance });
    return;
  }

  if (/^[0-9]$/.test(k)) {
    writeToSelected(k, { advance: !noAdvance });
    return;
  }

  // Delete single cell or selection
  if (k === 'Backspace' || k === 'Delete' || k === 'g' || e.code === 'Space') {
    e.preventDefault();
    const r = getRange();
    if (r && r.length > 1) {
      deleteSelection();
    } else {
      writeToSelected('', { advance: !noAdvance });
    }
  }
});

document.addEventListener('click', (ev) => {
  // Unlock audio if anything is clicked
  unlockAudio();

  // Clear selection when clicking / tapping anywhere except 
  // on the beat cells, or on the handpan notes while Compose mode is ON
  let clear = true;
  if (!ev.target.closest('.cell')) clear = false;
  if (composeOn && !ev.target.closest('.hp-dot')) clear = false;

  if (clear) clearSelection();
});

document.addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}, { once: true }
);