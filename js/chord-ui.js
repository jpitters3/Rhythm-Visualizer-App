/**
 * Chord Library UI
 * Handles the display and interaction of the analyzed chords.
 */
import { playNoteByLabel } from './noteplayer.js';
import { getScale } from './state.js';
import { SCALES } from './config.js';
import { ChordAnalyzer } from './chord-analyzer.js';
import { assignChordToSelectedCell } from './notegrid.js';

const ChordUI = (function () {

  let currentChords = [];
  let favoriteChords = new Set();
  const FAV_KEY = 'groovepan_favorite_chords';
  const drawer = document.getElementById('chordDrawer');
  const header = document.getElementById('chordDrawerHeader');
  const list = document.getElementById('chordList');
  const countLabel = document.getElementById('chordCount');
  const toggleIcon = document.querySelector('#chordDrawer .toggle-icon');

  function init() {
    if (!drawer) return;

    // Load Favorites
    try {
      const saved = localStorage.getItem(FAV_KEY);
      if (saved) {
        favoriteChords = new Set(JSON.parse(saved));
      }
    } catch (e) { console.warn('Failed to load favorites', e); }

    // Toggle Drawer logic moved to centralized DrawerManager (see handpanmap.js)

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

  function toggleFavorite(cId) {
    if (favoriteChords.has(cId)) {
      favoriteChords.delete(cId);
    } else {
      favoriteChords.add(cId);
    }
    saveFavorites();
    updateLibraryFromState(); // Re-render to update visuals
  }

  function saveFavorites() {
    localStorage.setItem(FAV_KEY, JSON.stringify([...favoriteChords]));
  }

  function updateLibraryFromState() {
    // ChordAnalyzer is now imported, assumed available
    if (!ChordAnalyzer) return;

    const notes = getAllCurrentNotes();
    if (!notes || notes.length === 0) return;

    const results = ChordAnalyzer.analyze(notes);
    currentChords = results;

    if (countLabel) countLabel.textContent = results.length;
    renderList(results);
  }

  function getAllCurrentNotes() {
    // 1. Check if we already have a currentScale object
    const scale = getScale();
    if (scale && scale.map) {
      const notes = [];
      if (scale.ding) notes.push(scale.ding);
      Object.values(scale.map).forEach(n => notes.push(n));
      return notes;
    }

    // 2. Fallback: Check SCALES global if we know the name
    const scaleSelect = document.getElementById('scaleSelect');
    if (scaleSelect && SCALES) {
      const name = scaleSelect.value;
      if (name && SCALES[name]) {
        const s = SCALES[name];
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

    // Clean up existing highlights
    document.querySelectorAll('.chord-highlight').forEach(el => el.classList.remove('chord-highlight'));

    list.innerHTML = '';

    if (chords.length === 0) {
      list.innerHTML = '<div class="empty-state">No triads found in this scale.</div>';
      countLabel.textContent = '0';
      return;
    }

    // Sort: Favorites first
    chords.sort((a, b) => {
      const aId = a.notes.join(',');
      const bId = b.notes.join(',');
      const aFav = favoriteChords.has(aId);
      const bFav = favoriteChords.has(bId);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return 0; // maintain original order otherwise (usually root pitch)
    });

    let activeChordId = null;

    chords.forEach(chord => {
      const chip = document.createElement('div');
      const cId = chord.notes.join(','); // unique ID based on notes
      const isFav = favoriteChords.has(cId);

      chip.className = `chord-chip ${chord.quality.toLowerCase()}`;
      if (isFav) chip.classList.add('favorited');

      // Star Icon
      const star = isFav ? '★' : '☆';

      // Content
      chip.innerHTML = `
                <button class="chord-fav-btn" title="Toggle Favorite">${star}</button>
                <div class="chord-info">
                  <span class="chord-root">${chord.root}</span>
                  <span class="chord-qual">${chord.quality}</span>
                  <div class="chord-notes">${chord.notes.join(' - ')}</div>
                </div>
            `;

      // Fav Button Logic
      const favBtn = chip.querySelector('.chord-fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Stop bubbling (don't play/select)
        toggleFavorite(cId);
      });

      const activate = () => {
        // Clear previous active chip if any
        if (activeChordId && activeChordId !== cId) {
          const prev = list.querySelector('.chord-chip.active');
          if (prev) prev.classList.remove('active');
          // Clear globals
          document.querySelectorAll('.chord-highlight').forEach(el => el.classList.remove('chord-highlight'));
        }

        activeChordId = cId;
        chip.classList.add('active');
        highlightChord(chord.notes, true);
      };

      const deactivate = () => {
        if (activeChordId === cId) {
          activeChordId = null;
          chip.classList.remove('active');
          highlightChord(chord.notes, false);
        }
      };

      // Desktop Hover: Activates immediately
      chip.addEventListener('mouseenter', () => {
        activate();
      });
      chip.addEventListener('mouseleave', () => {
        deactivate();
      });

      // Click / Tap Logic
      chip.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent unselecting grid cell

        // On Desktop: mouseenter already ran, so it is active -> Plays immediately.
        // On Mobile: mouseenter didn't run.

        if (activeChordId === cId) {
          // Already highlighted -> Play
          playChord(chord.notes);


          // Visual pop
          chip.style.transform = "scale(0.95)";
          setTimeout(() => chip.style.transform = "", 100);
        } else {
          // Not active -> Highlight (Mobile First Tap)
          activate();
        }
      });

      list.appendChild(chip);
    });
  }

  function highlightChord(notes, active) {
    const scale = getScale();
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
    if (playNoteByLabel) {
      const scale = getScale();
      const labelToPitch = scale ? scale.map : null;
      const dingPitch = scale ? scale.ding : null;

      if (!labelToPitch) return;

      const targetLabels = [];
      const playedNotes = [];

      notes.forEach((pitch, i) => {
        let targetLabel = null;
        if (pitch === dingPitch) targetLabel = 'D';
        else {
          for (const [lbl, p] of Object.entries(labelToPitch)) {
            if (p === pitch) { targetLabel = lbl; break; }
          }
        }

        if (targetLabel) {
          targetLabels.push(targetLabel);
          playNoteByLabel(targetLabel);
        }
      });

      // Inject to Grid if a cell is selected based on imported function
      if (typeof assignChordToSelectedCell === 'function') {
        assignChordToSelectedCell(targetLabels);
      }
    }
  }

  return {
    init: init,
    update: updateLibraryFromState
  };

})();

export default ChordUI;
