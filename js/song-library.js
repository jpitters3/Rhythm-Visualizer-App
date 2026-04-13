
// js/song-library.js
// Handles fetching songs from DB, compatibility checks, and loading

// UI References
const songLibraryBtn = document.getElementById('songLibraryBtn');
const songLibraryModal = document.getElementById('songLibraryModal');
const songLibPanel = new Modal(songLibraryModal);
const closeSongLibBtn = document.getElementById('closeSongLibBtn');
const songLibraryList = document.getElementById('songLibraryList');

// State
let librarySongs = [];

// Import renderAllMeasures dynamically or assume check?
// Better to import it if it is a module.
// But this file has no imports at the top. It seems to be treated as a module by the bundler/browser if type="module".
import { alert, confirm } from './alert.js';
import { Modal } from './modal.js';
import { renderAllMeasures, checkCellIsMultiMode } from './notegrid.js';
import { setBeats, setSubdivision } from './noteplayer.js';
import { migratePatternState } from './rhythm-core.js';
import { getScale } from './state.js';
import { currentUser, isAdminUser } from './state.js';
import { innerLabels } from './state.js'; // This seems wrong, innerLabels is a getter/state
import { activeGrid } from './grid-context.js'; // We need activeGrid to set innerLabels

// Init Listeners
if (songLibraryBtn) {
  songLibraryBtn.addEventListener('click', (e) => {
    if (e) e.stopPropagation();
    openSongLibrary();
    const menu = document.getElementById('fileDropdownMenu');
    if (menu) menu.classList.remove('show');
  });
}
if (closeSongLibBtn) {
  closeSongLibBtn.addEventListener('click', () => songLibPanel.close());
}

function openSongLibrary() {
  if (!supabase1) return;
  songLibPanel.open();
  fetchSongs();
}

export async function fetchSongs() {
  songLibraryList.innerHTML = '<div class="loading-spinner">Loading songs...</div>';

  const { data, error } = await supabase1
    .from('songs')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    songLibraryList.innerHTML = `<div class="error-msg">Error loading library: ${error.message}</div>`;
    return;
  }

  librarySongs = data || [];
  renderLibrary();
}

function renderLibrary() {
  songLibraryList.innerHTML = '';

  if (librarySongs.length === 0) {
    songLibraryList.innerHTML = '<div style="padding:20px; text-align:center; opacity:0.6;">No songs found.</div>';
    return;
  }

  // Get current scale details for compatibility check
  const scale = getScale ? getScale() : null;
  const scaleNotes = new Set();

  if (scale) {
    // Add mapped notes
    Object.values(scale.map).forEach(n => scaleNotes.add(n)); // Value is pitch e.g "A3"
    // Add ding
    if (scale.ding) scaleNotes.add(scale.ding);
  }

  librarySongs.forEach(song => {
    // 1. Analyze Compatibility
    const pattern = song.pattern_json;
    const notesInSong = new Set();

    // Extract logical notes from pattern
    if (pattern.labels) {
      pattern.labels.forEach(cell => {
        if (!cell) return;
        if (checkCellIsMultiMode(cell)) {
          cell.forEach(n => notesInSong.add(n));
        } else {
          notesInSong.add(cell);
        }
      });
    }

    // Determine mismatches
    let totalNotes = 0;
    let missingNotes = new Set();

    notesInSong.forEach(note => {
      // 1. Is it a Ding/Number? Resolvable via map?
      // 2. Is it an Absolute Pitch?

      // Since MIDI import produces Absolute Pitches (e.g. "C#4"), we check against scale PITCHES.
      // If it's a number (legacy patterns), we assume compatibility usually, or check map key.

      const isAbsolute = note.match(/[A-G][#b]?[0-9]/);

      if (isAbsolute) {
        totalNotes++;
        if (!scaleNotes.has(note)) {
          missingNotes.add(note);
        }
      }
      // Ignored non-absolute for now (percussive sounds T/S are universal)
    });

    let compatClass = 'compat-full';
    let compatText = 'Compatible';

    if (missingNotes.size > 0) {
      if (missingNotes.size > 5) { // Arbitrary threshold
        compatClass = 'compat-none';
        compatText = `Mismatch (${missingNotes.size} notes)`;
      } else {
        compatClass = 'compat-partial';
        compatText = `Missing: ${Array.from(missingNotes).join(', ')}`;
      }
    }

    // Builder Item
    const div = document.createElement('div');
    div.className = 'song-item';

    // Info Section
    const infoDiv = document.createElement('div');
    infoDiv.className = 'song-info';
    infoDiv.innerHTML = `
        <div class="song-title">${song.name}</div>
        <div class="song-meta">
           <span class="compat-badge ${compatClass}">${compatText}</span>
           <span>Preview unavailable</span>
        </div>
    `;
    div.appendChild(infoDiv);

    // Actions Section
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'song-actions';

    // Delete Button (Admin Only)
    if (isAdminUser(currentUser)) {
      const delBtn = document.createElement('button');
      delBtn.className = 'song-delete-btn';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', () => deleteSong(song.id));
      actionsDiv.appendChild(delBtn);
    }

    // Load Button
    const loadBtn = document.createElement('button');
    loadBtn.className = 'song-load-btn';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => loadLibrarySong(song.id));
    actionsDiv.appendChild(loadBtn);

    div.appendChild(actionsDiv);
    songLibraryList.appendChild(div);
  });
}

// Internal functions (No longer on window)
async function loadLibrarySong(id) {
  const song = librarySongs.find(s => s.id === id);
  if (!song) return;

  const p = song.pattern_json;

  // Load Logic (Similar to loadPattern)
  if (await confirm(`Load "${song.name}"? This will overwrite your current grid.`)) {
    // 1. Set Labels
    if (p.labels) {
      if (activeGrid) activeGrid.innerLabels = p.labels;
    }

    // 2. Apply beats/subdivision (migrate old format if needed)
    migratePatternState(p);
    if (p.beats) setBeats(p.beats, activeGrid);
    if (p.subdivision) setSubdivision(p.subdivision, activeGrid);

    // 3. Render
    if (typeof renderAllMeasures === 'function') renderAllMeasures(activeGrid);

    // 4. Close Modal
    songLibPanel.close();

    // 5. Switch to Pitches view automatically? 
    // Since MIDI is absolute pitches, "Numbers" view might show nothing if not mapped.
    // Let's autoswitch to Pitches for UX.
    const sel = document.getElementById('numberPitchSelect');
    if (sel && sel.value !== 'Pitches') {
      sel.value = 'Pitches';
      sel.dispatchEvent(new Event('change'));
    }
  }
};

async function deleteSong(id) {
  if (!await confirm("Are you sure you want to delete this song?")) return;

  const { error } = await supabase1
    .from('songs')
    .delete()
    .eq('id', id);

  if (error) {
    await alert("Error deleting song: " + error.message);
  } else {
    fetchSongs(); // Refresh
  }
};
