/**
 * Chord Library UI
 * Handles the display and interaction of the analyzed chords.
 */
import { ChordAnalyzer } from './chord-analyzer.js';
import { assignChordToSelectedCell } from './notegrid.js';
import { setChordHighlight, getPitchPositionMap } from './handpanmap.js';
import { annotatePlayability } from './chord-playability.js';
import { getAllCurrentNotes, highlightChordNotes, playChordNotes, notesToLabels } from './chord-playback.js';
import { createChordShapeDiagramEl, updateChordShapeDiagram } from './chord-shape-diagram.js';

export const CHORD_DRAG_TYPE = 'application/x-panafide-chord';

const ChordUI = (function () {

  let currentChords = [];
  let favoriteChords = new Set();
  const FAV_KEY = 'groovepan_favorite_chords';
  let list, countLabel;
  let addHandler = null;

  function init() {
    list = document.getElementById('chordList');
    countLabel = document.getElementById('chordCount');

    if (!list) return;

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
      const item = document.createElement('div');
      item.className = 'cs-chord-item';
      item.draggable = true;
      const chip = document.createElement('div');
      const cId = chord.notes.join(','); // unique ID based on notes
      item.dataset.chordId = cId;
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

      const shape = createChordShapeDiagramEl({ flat: true });
      updateChordShapeDiagram(shape, notesToLabels(chord.notes));

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'cs-chord-add-btn';
      addBtn.title = 'Add to progression';
      addBtn.textContent = '+';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addHandler?.(chord);
      });

      const activate = () => {
        // Clear previous active item if any
        if (activeChordId && activeChordId !== cId) {
          list.querySelector('.cs-chord-item.active')?.classList.remove('active');
          setChordHighlight([], false);
        }

        activeChordId = cId;
        item.classList.add('active');
        highlightChord(chord, true);
      };

      const deactivate = () => {
        if (activeChordId === cId) {
          activeChordId = null;
          item.classList.remove('active');
          highlightChord(chord, false);
        }
      };

      item.addEventListener('mouseenter', activate);
      item.addEventListener('mouseleave', deactivate);

      // Card or shape: play + highlight, on desktop and touch alike.
      item.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent unselecting grid cell
        activate();
        playChord(chord.notes);
        item.classList.remove('pressed');
        void item.offsetWidth; // restart the press animation
        item.classList.add('pressed');
      });

      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData(CHORD_DRAG_TYPE, cId);
        e.dataTransfer.effectAllowed = 'copy';
        deactivate();
      });

      item.append(chip, shape, addBtn);
      list.appendChild(item);
    });
  }

  function getChord(cId) {
    return currentChords.find(c => c.notes.join(',') === cId) || null;
  }

  function setAddHandler(fn) {
    addHandler = fn;
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
    update: updateLibraryFromState,
    getChord,
    setAddHandler,
  };

})();

export default ChordUI;
