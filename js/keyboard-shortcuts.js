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
    const grooveModal = document.getElementById('grooveModal');
    if (grooveModal && grooveModal.classList.contains('open')) {
      closeGrooveModal();
      return;
    }

    // Course Creator Modal
    const courseModal = document.getElementById('courseModal');
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
    const ctx = window.activeGrid;
    ctx.metronomeOn = !ctx.metronomeOn;
    localStorage.setItem('groovepan_metro' + '-' + ctx.id, ctx.metronomeOn ? 'on' : 'off');
    updateMetroUI(); // This might need ctx if UI is separate, but for now we'll assume it updates A
    if (ctx.metronomeOn) window.ensureAudio();
    return;
  }

  // Presentation Mode shortcut
  if (e.key.toLowerCase() === 'p') {
    const on = !document.body.classList.contains('present');
    if (typeof setPresentation === 'function') {
      setPresentation(on);
    }
    return;
  }

  // Enter: Groove modal 'Go!'
  const grooveModalEl = document.getElementById('grooveModal');
  if (grooveModalEl?.classList?.contains('open') && e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('grooveGo')?.click();
    return;
  }

  // Cmd/Ctrl+C / V for selection
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const ctx = window.activeGrid;

  if (mod && e.key.toLowerCase() === 'c') {
    const r = getRange(ctx);
    if (r && r.length >= 1) {
      e.preventDefault();
      copySelection(ctx);
    }
  }

  if (mod && e.key.toLowerCase() === 'v') {
    if (window.beatClipboard) {
      e.preventDefault();
      pasteSelection(ctx);
    }
  }

  // Esc cancels range selection
  if (e.key === 'Escape') {
    const r = getRange(ctx);
    if (r && r.length > 1) {
      clearRange(ctx);
      return;
    }
  }

  // Enter: Play / Stop
  if (e.code === 'Space') {
    e.preventDefault();
    if (ctx.playing) window.stop(ctx);
    else window.start(ctx);
    return;
  }

  // From this point onwards in this function,
  // assign the beat to a ding, tak, slap, or note
  // based on the key that was pressed
  if (ctx.caretIndex === null) return;

  const noAdvance = e.altKey; // Alt = write without advancing

  const k = e.key;
  const lower = k.toLowerCase();
  const map = { d: 'D', t: 'T', s: 'S' };

  if (map[lower]) {
    writeToSelected(map[lower], { advance: !noAdvance }, ctx);
    return;
  }

  if (/^[0-9?]$/.test(k)) {
    writeToSelected(k, { advance: !noAdvance }, ctx);
    return;
  }

  // Delete single cell or selection
  if (k === 'Backspace' || k === 'Delete' || k === 'g' || e.code === 'Space') {
    e.preventDefault();
    const r = getRange(ctx);
    if (r && r.length > 1) {
      deleteSelection(ctx);
    } else {
      writeToSelected('', { advance: !noAdvance }, ctx);
    }
  }
});

document.addEventListener('click', (ev) => {
  // Unlock audio if anything is clicked
  if (typeof window.unlockAudio === 'function') window.unlockAudio();
  else if (typeof window.ensureAudio === 'function') window.ensureAudio();

  // Clear selection when clicking / tapping anywhere except 
  // on the beat cells, or on the handpan notes while Compose mode is ON
  let shouldClear = true;

  if (ev.target.closest('.cell')) shouldClear = false;
  if (typeof window.getComposeOn === 'function' && window.getComposeOn() && ev.target.closest('.hp-dot')) shouldClear = false;

  // Also don't clear if interacting with key UI elements
  if (ev.target.closest('#aiFab') || ev.target.closest('#aiChatContainer')) shouldClear = false;

  if (shouldClear) clearRange(window.activeGrid);
});

document.addEventListener('click', () => {
  const ac = (typeof window.getAudioCtx === 'function') ? window.getAudioCtx() : null;
  if (ac && ac.state === 'suspended') {
    ac.resume();
  }
}, { once: true }
);