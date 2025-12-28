 // ===== KEYBOARD LABELING + SHORTCUTS =====
 document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

  // Esc
  if (e.key === 'Escape') {
    if (grooveModal.classList.contains('open')) { closeGrooveModal(); return; }
    if (document.body.classList.contains('present')) setPresentation(false);
    else clearSelection();
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

  // Spacebar: Play / Stop
  if (e.code === 'Space') {
    e.preventDefault(); // prevent page scroll
    if (playing) stop();
    else start();
    return;
  }

  // Enter: Groove modal 'Go!'
  if (grooveModal?.classList?.contains('open') && e.key === 'Enter') {
    e.preventDefault();
    grooveGo?.click();
    return;
  }

  // From this point onwards in this function,
  // assign the beat to a ding, tak, slap, or note
  // based on the key that was pressed
  if (selectedIndex === null) return;

  const k = e.key;
  const lower = k.toLowerCase();
  const map = { d: 'D', t: 'T', s: 'S' };

  if (map[lower]) {
    setInnerLabel(selectedIndex, map[lower]);
    return;
  }

  if (/^[0-9]$/.test(k)) {
    setInnerLabel(selectedIndex, k);
    return;
  }

  if (k === 'Backspace' || k === 'Delete' || k === 'g') {
    setInnerLabel(selectedIndex, '');
  }
});

document.addEventListener('click', (ev) => {
  if (!ev.target.closest('.cell')) clearSelection();
});

document.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    }, { once: true }
);