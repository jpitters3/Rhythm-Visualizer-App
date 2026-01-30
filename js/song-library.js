
// js/song-library.js
// Handles fetching songs from DB, compatibility checks, and loading

// UI References
const songLibraryBtn = document.getElementById('songLibraryBtn');
const songLibraryModal = document.getElementById('songLibraryModal');
const closeSongLibBtn = document.getElementById('closeSongLibBtn');
const songLibraryList = document.getElementById('songLibraryList');

// State
let librarySongs = [];

// Init Listeners
if (songLibraryBtn) {
  songLibraryBtn.addEventListener('click', openSongLibrary);
}
if (closeSongLibBtn) {
  closeSongLibBtn.addEventListener('click', () => {
    songLibraryModal.classList.remove('open');
    songLibraryModal.setAttribute('aria-hidden', 'true');
  });
}
// Close on outside click is handled by generic listener or we add specific one
if (songLibraryModal) {
  songLibraryModal.addEventListener('click', (e) => {
    if (e.target === songLibraryModal) {
      songLibraryModal.classList.remove('open');
      songLibraryModal.setAttribute('aria-hidden', 'true');
    }
  });
}

function openSongLibrary() {
  if (!supabase1) return;
  songLibraryModal.classList.add('open');
  songLibraryModal.setAttribute('aria-hidden', 'false');
  fetchSongs();
}

async function fetchSongs() {
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
  const scale = window.getScale ? window.getScale() : null;
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
        if (window.checkCellIsMultiMode(cell)) {
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
    div.innerHTML = `
      <div class="song-info">
        <div class="song-title">${song.name}</div>
        <div class="song-meta">
           <span class="compat-badge ${compatClass}">${compatText}</span>
           <span>Preview unavailable</span>
        </div>
      </div>
      <div class="song-actions">
        ${isAdminUser(currentUser) ? `<button class="song-delete-btn" onclick="deleteSong('${song.id}')" title="Delete">&times;</button>` : ''}
        <button class="song-load-btn" onclick="loadLibrarySong('${song.id}')">Load</button>
      </div>
    `;
    songLibraryList.appendChild(div);
  });
}

// Global functions for inline onclicks
window.loadLibrarySong = function (id) {
  const song = librarySongs.find(s => s.id === id);
  if (!song) return;

  const p = song.pattern_json;

  // Load Logic (Similar to loadPattern)
  if (confirm(`Load "${song.name}"? This will overwrite your current grid.`)) {
    // 1. Set Labels
    if (p.labels) innerLabels = p.labels; // Global innerLabels update

    // 2. Reset Mode/Measures if needed (Assuming 16ths for MIDI)
    if (p.mode) mode = p.mode; // '16'
    if (p.timeSignature && typeof setTimeSignature === 'function') {
      setTimeSignature(p.timeSignature);
    }

    // 3. Render
    if (typeof renderAllMeasures === 'function') renderAllMeasures();

    // 4. Close Modal
    songLibraryModal.classList.remove('open');
    songLibraryModal.setAttribute('aria-hidden', 'true');

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

window.deleteSong = async function (id) {
  if (!confirm("Are you sure you want to delete this song?")) return;

  const { error } = await supabase1
    .from('songs')
    .delete()
    .eq('id', id);

  if (error) {
    alert("Error deleting song: " + error.message);
  } else {
    fetchSongs(); // Refresh
  }
};
