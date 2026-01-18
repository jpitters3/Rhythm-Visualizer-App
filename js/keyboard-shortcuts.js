// ===== KEYBOARD LABELING + SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

  // Esc
  if (e.key === 'Escape') {

    // e.preventDefault();
    // e.stopPropagation();
    // 0. Priorities: Top-most overlays first

    // Guided Calibration
    const guided = document.getElementById('guidedCalModal');
    if (guided && guided.style.display !== 'none') {
      document.getElementById('closeGuidedBtn')?.click();
      return;
    }

    // Profile Modal
    if (typeof closeProfileEditor === 'function' && document.getElementById('profileModal')?.classList.contains('open')) {
      closeProfileEditor();
      return;
    }

    // Auth Modal
    if (typeof closeAuthModal === 'function' && document.getElementById('authModal')?.classList.contains('open')) {
      closeAuthModal();
      return;
    }

    // Groove Modal
    if (grooveModal.classList.contains('open')) {
      closeGrooveModal();
      return;
    }

    // Course Creator Modal
    if (courseModal?.classList.contains('open')) {
      // Logic from course-creator.js
      if (typeof closeCourseCreator === 'function') closeCourseCreator();
      return;
    }

    // AI Assistant
    if (window.aiAssistant && window.aiAssistant.isOpen) {
      window.aiAssistant.toggleChat(false);
      return;
    }

    // Course Sidebar
    const sb = document.getElementById('courseSidebar');
    if (sb?.classList.contains('open')) {
      closeSidebar();
      return;
    }

    // Presentation Mode
    if (document.body.classList.contains('present')) {
      setPresentation(false);
      return;
    }

    // Clear Selection
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
  let shouldClear = true;

  if (ev.target.closest('.cell')) shouldClear = false;
  if (composeOn && ev.target.closest('.hp-dot')) shouldClear = false;

  // Also don't clear if interacting with key UI elements
  if (ev.target.closest('#aiFab') || ev.target.closest('#aiChatContainer')) shouldClear = false;

  if (shouldClear) clearSelection();
});

document.addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}, { once: true }
);