/**
 * Chord Library UI
 * Handles the display and interaction of the analyzed chords.
 */

const ChordUI = (function () {

  let currentChords = [];
  const drawer = document.getElementById('chordDrawer');
  const header = document.getElementById('chordDrawerHeader');
  const list = document.getElementById('chordList');
  const countLabel = document.getElementById('chordCount');
  const toggleIcon = document.querySelector('#chordDrawer .toggle-icon');

  function init() {
    if (!drawer) return;

    // Toggle Drawer
    header.addEventListener('click', () => {
      drawer.classList.toggle('collapsed');
      if (toggleIcon) toggleIcon.style.transform = drawer.classList.contains('collapsed') ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // Initial Load
    updateLibraryFromState();

    // Listen for Scale Changes
    const scaleSelect = document.getElementById('scaleSelect');
    if (scaleSelect) {
      scaleSelect.addEventListener('change', () => {
        // Wait slightly for system to update currentScale state
        setTimeout(updateLibraryFromState, 100);
      });
    }

    // Also listen for detailed events if they exist
    window.addEventListener('handpan-loaded', updateLibraryFromState);
  }

  function updateLibraryFromState() {
    if (!window.ChordAnalyzer) return;

    const notes = getAllCurrentNotes();
    if (!notes || notes.length === 0) return;

    const results = window.ChordAnalyzer.analyze(notes);
    currentChords = results;

    if (countLabel) countLabel.textContent = results.length;
    renderList(results);
  }

  function getAllCurrentNotes() {
    // 1. Check if we have a global currentScale object via accessor
    const scale = window.getScale ? window.getScale() : null;
    if (scale && scale.map) {
      const notes = [];
      if (scale.ding) notes.push(scale.ding);
      Object.values(scale.map).forEach(n => notes.push(n));
      return notes;
    }

    // 2. Fallback: Check SCALES global if we know the name
    const scaleSelect = document.getElementById('scaleSelect');
    if (scaleSelect && window.SCALES) {
      const name = scaleSelect.value;
      if (name && window.SCALES[name]) {
        const s = window.SCALES[name];
        const notes = [];
        if (s.ding) notes.push(s.ding);
        if (s.map) Object.values(s.map).forEach(n => notes.push(n));
        return notes;
      }
    }

    return [];
  }

  function renderList(chords) {
    if (!list) return;
    list.innerHTML = '';
    if (chords.length === 0) {
      list.innerHTML = '<div class="empty-state">No triads found in this scale.</div>';
      countLabel.textContent = '0';
      return;
    }

    chords.forEach(chord => {
      const chip = document.createElement('div');
      chip.className = `chord-chip ${chord.quality.toLowerCase()}`;
      // Content
      chip.innerHTML = `
                <span class="chord-root">${chord.root}</span>
                <span class="chord-qual">${chord.quality}</span>
                <div class="chord-notes">${chord.notes.join(' - ')}</div>
            `;

      // Interaction
      chip.addEventListener('mouseenter', () => highlightChord(chord.notes, true));
      chip.addEventListener('mouseleave', () => highlightChord(chord.notes, false));
      chip.addEventListener('click', () => {
        playChord(chord.notes);
      });

      list.appendChild(chip);
    });
  }

  function highlightChord(notes, active) {
    // Window.getScale().map is Label -> Pitch.
    const scale = window.getScale ? window.getScale() : null;
    const labelToPitch = scale ? scale.map : null;
    const dingPitch = scale ? scale.ding : null;

    if (!labelToPitch) return;

    // Find labels that match the chord notes
    const targetLabels = [];

    // Check Ding
    if (notes.includes(dingPitch)) targetLabels.push('D');
    if (notes.includes(dingPitch)) targetLabels.push('Ding');

    // Check Map
    for (const [lbl, pitch] of Object.entries(labelToPitch)) {
      if (notes.includes(pitch)) targetLabels.push(lbl);
    }

    targetLabels.forEach(lbl => {
      // Find element with data-note="lbl"
      // Usually in #handpanOverlay .hp-dot
      const dots = document.querySelectorAll(`.hp-dot[data-note="${lbl}"]`);
      dots.forEach(d => {
        if (active) d.classList.add('chord-highlight');
        else d.classList.remove('chord-highlight');
      });
    });
  }

  function playChord(notes) {
    if (window.playNote) {
      const scale = window.getScale ? window.getScale() : null;
      const labelToPitch = scale ? scale.map : null;
      const dingPitch = scale ? scale.ding : null;

      if (!labelToPitch) return;

      notes.forEach((pitch, i) => {
        let targetLabel = null;
        if (pitch === dingPitch) targetLabel = 'D';
        else {
          for (const [lbl, p] of Object.entries(labelToPitch)) {
            if (p === pitch) { targetLabel = lbl; break; }
          }
        }

        if (targetLabel) {
          setTimeout(() => window.playNote(targetLabel), i * 50);
        }
      });
    }
  }

  return {
    init: init,
    update: updateLibraryFromState
  };

})();

// Init on load
document.addEventListener('DOMContentLoaded', ChordUI.init);
