
// js/midi-importer.js
// Handles reading MIDI files, parsing them, quantizing to grid, and uploading to DB (Admin only)

const midiFileInput = document.getElementById('midiFileInput');
const importMidiBtn = document.getElementById('importMidiBtn');

// Initialize Listener
if (importMidiBtn && midiFileInput) {
  importMidiBtn.addEventListener('click', () => {
    midiFileInput.click();
  });

  midiFileInput.addEventListener('change', handleMidiFileSelect);
}

function handleMidiFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Visual Feedback
  const originalText = importMidiBtn.textContent;
  importMidiBtn.textContent = "Processing...";
  importMidiBtn.disabled = true;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      console.log("FileReader loaded.");
      const dataUrl = e.target.result;
      // dataUrl is like "data:audio/midi;base64,TVRoD..."
      const base64 = dataUrl.split(',')[1];

      if (typeof MidiParser === 'undefined') {
        throw new Error("MidiParser library not loaded.");
      }

      console.log("Calling MidiParser.parse (sync)...");
      const obj = MidiParser.parse(base64);
      console.log("MidiParser returned:", obj);

      if (!obj) {
        throw new Error("Parsed object is null / undefined");
      }

      processMidiData(obj, file.name)
        .catch(err => {
          console.error(err);
          alert("Error: " + err.message);
        })
        .finally(() => {
          if (importMidiBtn.textContent === "Processing...") {
            importMidiBtn.textContent = originalText;
            importMidiBtn.disabled = false;
            midiFileInput.value = '';
          }
        });

    } catch (err) {
      alert("Error parsing MIDI: " + err.message);
      console.error(err);
      importMidiBtn.textContent = originalText;
      importMidiBtn.disabled = false;
      midiFileInput.value = '';
    }
  };
  reader.readAsDataURL(file);
}

function midiNoteToName(noteNumber) {
  // MIDI 60 = C4
  // MIDI 69 = A4
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(noteNumber / 12) - 1;
  const noteName = notes[noteNumber % 12];
  return `${noteName}${octave}`; // e.g. "C#4"
}

// Convert MIDI events to our 16-step grid format
async function processMidiData(midi, filename) {
  console.log('Processing midi data...');
  console.log(midi);
  // 1. Detect Time Division (PPQ) to calculate timing
  const timeDivision = midi.timeDivision;
  if (!timeDivision) {
    alert("Could not detect MIDI Time Division.");
    return;
  }

  // We assume 4/4 time for the grid usually. 
  // We need to map "Ticks" to "16th Note Steps".
  // 1 Quarter Note = timeDivision ticks.
  // 1 16th Note = timeDivision / 4 ticks.

  const ticksPer16th = timeDivision / 4;

  const tracks = midi.track;
  const gridLength = 32; // Default 2 measures of 16ths, or dynamic?
  // Let's support arbitrary length and just crop or expand?
  // Grid system usually supports 'measures' variable. 

  // We'll capture ALL notes and then decide how many measures we need.
  const finalNotes = {}; // { stepIndex: ["Note1", "Note2"] }
  let maxStep = 0;

  // Iterate Tracks
  tracks.forEach(track => {
    let currentTicks = 0; // Absolute time in ticks

    track.event.forEach(event => {
      currentTicks += event.deltaTime;

      // Note On (9) with velocity > 0
      if (event.type === 9 && event.data[1] > 0) {
        // Quantize to nearest 16th
        const step = Math.round(currentTicks / ticksPer16th);
        const note = midiNoteToName(event.data[0]);

        if (!finalNotes[step]) finalNotes[step] = [];
        // Avoid dupes
        if (!finalNotes[step].includes(note)) {
          finalNotes[step].push(note);
        }

        if (step > maxStep) maxStep = step;
      }
    });
  });

  if (maxStep === 0) {
    alert("No notes found in MIDI!");
    return;
  }

  // Convert object to Array-based structure for our App
  // App structure: an array of strings or arrays (steps)
  const patternData = [];
  // Ensure we cover enough measures
  const stepsPerMeasure = 16;
  const totalMeasures = Math.ceil((maxStep + 1) / stepsPerMeasure);
  const totalSteps = totalMeasures * stepsPerMeasure;

  for (let i = 0; i < totalSteps; i++) {
    const n = finalNotes[i];
    if (!n) {
      patternData.push("");
    } else if (n.length === 1) {
      patternData.push(n[0]);
    } else {
      patternData.push(n); // Chord array
    }
  }

  console.log("Processed Pattern:", patternData);

  // Confirm Upload
  const confirmName = prompt("MIDI Processed! Enter a name for this song:", filename.replace('.mid', '').replace('.midi', ''));
  if (!confirmName) {
    importMidiBtn.textContent = "Import MIDI";
    importMidiBtn.disabled = false;
    midiFileInput.value = '';
    return;
  }

  await uploadSongToDB(confirmName, patternData);
}

async function uploadSongToDB(name, patternData) {
  if (!currentUser) {
    alert("You must be logged in to upload songs.");
    return;
  }

  /* 
    Pattern JSON Structure:
    {
       name: "Song Name",
       labels: [...], // The main grid data
       bpm: 120, // Default or detected? MIDI has SetTempo events (0xFF 0x51). Ignoring for MVP simplicity.
       timeSignature: "4/4",
       mode: "16"
    }
  */

  const payload = {
    name: name,
    labels: patternData,
    bpm: 120, // Todo: detect from MIDI
    mode: "16",
    timeSignature: "4/4"
  };

  importMidiBtn.textContent = "Uploading...";
  importMidiBtn.disabled = true;

  const { data, error } = await supabase1
    .from('songs')
    .insert([
      {
        user_id: currentUser.id,
        name: name,
        pattern_json: payload
      }
    ])
    .select();

  importMidiBtn.textContent = "Import MIDI";
  importMidiBtn.disabled = false;
  midiFileInput.value = '';

  if (error) {
    console.error("Upload failed:", error);
    alert("Upload failed: " + error.message);
  } else {
    alert("Song uploaded successfully!");
    // Refresh library if open?
    if (typeof fetchSongs === 'function') fetchSongs();
  }
}
