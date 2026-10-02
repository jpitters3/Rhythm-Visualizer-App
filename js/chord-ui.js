/**
 * Chord Library UI
 * Handles the display and interaction of the analyzed chords.
 */
import { ChordAnalyzer } from './chord-analyzer.js';
import { assignChordToSelectedCell } from './notegrid.js';
import { setChordHighlight, getPitchPositionMap } from './handpanmap.js';
import { annotatePlayability } from './chord-playability.js';
import { getAllCurrentNotes, highlightChordNotes, playChordNotes } from './chord-playback.js';

const ChordUI = (function () {

  let currentChords = [];
  let favoriteChords = new Set();
  const FAV_KEY = 'groovepan_favorite_chords';
  let drawer, header, list, countLabel, toggleIcon;

  function init() {
    drawer = document.getElementById('chordDrawer');
    header = document.getElementById('chordDrawerHeader');
    list = document.getElementById('chordList');
    countLabel = document.getElementById('chordCount');
    toggleIcon = document.querySelector('#chordDrawer .toggle-icon');

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
    window.addEventListener('chord-test-mode-changed', updateLibraryFromState);
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

    const results = annotatePlayability(ChordAnalyzer.analyze(notes), getPitchPositionMap());
    currentChords = results;

    if (countLabel) countLabel.textContent = results.length;
    renderList(results);
  }

  function renderList(chords) {
    if (!list) return;

    // Clean up existing highlights
    setChordHighlight([], false);

    list.innerHTML = '';

    if (chords.length === 0) {
      list.innerHTML = '<div class="empty-state">No triads found in this scale.</div>';
      countLabel.textContent = '0';
      return;
    }

    // Sort: favorites → playable → not playable
    chords.sort((a, b) => {
      const aFav = favoriteChords.has(a.notes.join(','));
      const bFav = favoriteChords.has(b.notes.join(','));
      if (aFav !== bFav) return aFav ? -1 : 1;
      if (a.playable !== b.playable) return a.playable ? -1 : 1;
      return 0;
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
          setChordHighlight([], false);
        }

        activeChordId = cId;
        chip.classList.add('active');
        highlightChord(chord, true);
      };

      const deactivate = () => {
        if (activeChordId === cId) {
          activeChordId = null;
          chip.classList.remove('active');
          highlightChord(chord, false);
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

  function highlightChord(chord, active) {
    highlightChordNotes(chord, active);
  }

  function playChord(notes) {
    const labels = playChordNotes(notes);
    assignChordToSelectedCell(labels);
  }

  return {
    init: init,
    update: updateLibraryFromState
  };

})();

export default ChordUI;
