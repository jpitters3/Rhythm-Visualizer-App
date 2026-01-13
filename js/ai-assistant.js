
/**
 * AI Assistant Logic
 * Handles chat interaction and simulated pattern generation.
 */

class AiAssistant {
  constructor() {
    this.isOpen = false;
    this.chatContainer = document.getElementById('aiChatContainer');
    this.cursor = document.getElementById('aiFab');
    this.input = document.getElementById('aiInput');
    this.messagesArea = document.querySelector('.ai-messages');

    this.isProcessing = false;

    this.init();
  }

  init() {
    // Toggle Chat
    this.cursor?.addEventListener('click', () => this.toggleChat());

    // Send Message
    document.getElementById('sendAiBtn')?.addEventListener('click', () => this.handleSend());
    this.input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleSend();
    });

    // Close
    document.querySelector('.close-ai-btn')?.addEventListener('click', () => this.toggleChat(false));

    // Initial Welcome
    setTimeout(() => {
      if (this.messagesArea && this.messagesArea.children.length === 0) {
        this.addMessage("bot", "Hi! I'm your rhythm assistant. Tell me what kind of section you want to add (e.g., 'sad', 'minor', 'upbeat') or if you want to clear the grid.");
      }
    }, 500);
  }

  toggleChat(forceState) {
    if (typeof forceState === 'boolean') {
      this.isOpen = forceState;
    } else {
      this.isOpen = !this.isOpen;
    }

    if (this.isOpen) {
      this.chatContainer.classList.add('open');
      this.input.focus();
    } else {
      this.chatContainer.classList.remove('open');
    }
  }

  handleSend() {
    const text = this.input.value.trim();
    if (!text) return;

    this.addMessage('user', text);
    this.input.value = '';

    this.processAiResponse(text);
  }

  addMessage(type, text, action = null) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}`;
    msgDiv.textContent = text;

    if (action) {
      // Create Action Button
      const btn = document.createElement('button');
      btn.className = 'ai-action-btn';
      btn.textContent = action.label;
      btn.onclick = () => {
        this.executeAction(action, btn);
      };
      msgDiv.appendChild(document.createElement('br'));
      msgDiv.appendChild(btn);
    }

    this.messagesArea.appendChild(msgDiv);
    this.messagesArea.scrollTop = this.messagesArea.scrollHeight;
  }

  async processAiResponse(userText) {
    this.isProcessing = true;
    // Simulate network delay
    await new Promise(r => setTimeout(r, 800));

    const lower = userText.toLowerCase();
    let responseText = "";
    let action = null;

    if (lower.includes('sad') || lower.includes('minor') || lower.includes('emotional')) {
      const result = this.generateChordProgression('minor');
      if (result.success) {
        responseText = `I've generated a 4-measure ${result.scaleName} chord progression for you.`;
        action = {
          type: 'APPEND_PATTERN',
          label: 'Add to Song',
          data: result.pattern
        };
      } else {
        responseText = "I couldn't find enough minor chords in the current scale (" + result.scaleName + ") to make a progression.";
      }
    } else if (lower.includes('clear') || lower.includes('empty') || lower.includes('reset')) {
      responseText = "Do you want to clear the entire grid?";
      action = {
        type: 'CLEAR_GRID',
        label: 'Clear Grid'
      };
    } else if (lower.includes('add section') || lower.includes('extend')) {
      responseText = "I can add 4 empty measures to the end of your track.";
      action = {
        type: 'APPEND_PATTERN',
        label: 'Add 4 Measures',
        data: this.getEmptyPattern(4)
      };
    }
    else {
      responseText = "I'm still learning! Try asking for a 'sad' section or to 'add a section'.";
    }

    this.addMessage('bot', responseText, action);
    this.isProcessing = false;
  }

  executeAction(action, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Applied ✓";
    }

    if (action.type === 'CLEAR_GRID') {
      const clearBtn = document.getElementById('clearBtn');
      if (clearBtn) clearBtn.click();
    } else if (action.type === 'APPEND_PATTERN') {
      this.appendPatternToGrid(action.data);
    }
  }

  appendPatternToGrid(pattern) {
    if (!pattern || !pattern.labels) return;

    // pattern.labels is an array of strings or arrays (for chords)
    // We append them to the global innerLabels
    // And expand the grid if needed.

    // 1. Extend innerLabels
    if (!innerLabels) innerLabels = [];
    innerLabels = innerLabels.concat(pattern.labels);

    // 2. Recalculate 'measures' count
    // Use the global 'STEPS' variable (8 or 16 usually)
    // If not defined, fallback to 16
    const stepCount = (typeof STEPS !== 'undefined') ? STEPS : 16;
    measures = Math.ceil(innerLabels.length / stepCount);

    // 3. Render
    if (typeof renderAllMeasures === 'function') {
      renderAllMeasures();
    } else {
      console.warn("renderAllMeasures not found!");
    }
  }

  getEmptyPattern(numMeasures) {
    const STEPS_PER_MEASURE = 16;
    return {
      measures: numMeasures,
      labels: new Array(numMeasures * STEPS_PER_MEASURE).fill("")
    };
  }

  /*
   * Generates a chord progression based on the current scale.
   * Returns { success: boolean, pattern: object, scaleName: string }
   */
  generateChordProgression(vibe) {
    // 1. Get Current Scale
    const scaleSelect = document.getElementById('scaleSelect');
    const scaleName = scaleSelect ? scaleSelect.value : "D Kurd";

    // SCALES is global from noteplayer.js
    if (typeof SCALES === 'undefined' || !SCALES[scaleName]) {
      console.error("Scale data not found for", scaleName);
      return { success: false, scaleName };
    }

    const scaleData = SCALES[scaleName];
    const noteMap = scaleData.map; // e.g. { "1": "A3", "2": "Bb3" ... }

    // 2. Identify available notes normalized to Pitch Class (A, Bb, C...)
    // Helper to parse "A3" -> "A"
    const getPitchClass = (noteStr) => noteStr.replace(/[0-9]/g, '');

    // Reverse Map: PitchClass -> Array of { number: "1", octave: 3, full: "A3" }
    // We might have multiple A's (A3, A4).
    const availableNotes = {};

    Object.entries(noteMap).forEach(([num, noteStr]) => {
      const pc = getPitchClass(noteStr); // e.g. "A"
      if (!availableNotes[pc]) availableNotes[pc] = [];
      availableNotes[pc].push({
        num,
        full: noteStr,
        octave: parseInt(noteStr.match(/\d+/)[0])
      });
    });

    // Also map Ding if needed? Usually Ding is the root or bass.
    // D Kurd Ding is D3.
    const ding = scaleData.ding;
    if (ding) {
      const pc = getPitchClass(ding);
      if (!availableNotes[pc]) availableNotes[pc] = [];
      // Ding doesn't usually have a number "1-9" in the map unless specified.
      // We can use 'D' for Ding in the grid labels if needed.
    }

    // 3. Define Intervals for Chords (semitones from root)
    const noteToSemi = {
      'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
      'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8,
      'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
    };
    const semiToNote = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

    // Helper: Check if we can form a triad
    const getTriad = (rootPC, type) => {
      const rootSemi = noteToSemi[rootPC];
      const thirdSemi = (rootSemi + (type === 'minor' ? 3 : 4)) % 12;
      const fifthSemi = (rootSemi + 7) % 12; // Perfect fifth

      const thirdPC = semiToNote[thirdSemi];
      const fifthPC = semiToNote[fifthSemi];

      // Check availability in current scale
      if (availableNotes[rootPC] && availableNotes[rootPC].length > 0 &&
        availableNotes[thirdPC] && availableNotes[thirdPC].length > 0 &&
        availableNotes[fifthPC] && availableNotes[fifthPC].length > 0) {
        return {
          root: availableNotes[rootPC],
          third: availableNotes[thirdPC],
          fifth: availableNotes[fifthPC],
          name: `${rootPC}${type === 'minor' ? 'm' : ''}`
        };
      }
      return null;
    };

    // 4. Find all possible chords in this scale
    const possibleChords = [];
    const scalePCs = Object.keys(availableNotes);

    scalePCs.forEach(pc => {
      // Check Minor
      const m = getTriad(pc, 'minor');
      if (m) possibleChords.push({ ...m, type: 'minor' });

      // Check Major
      const M = getTriad(pc, 'major');
      if (M) possibleChords.push({ ...M, type: 'major' });
    });

    // 5. Select a progression based on vibe
    let progression = []; // Array of chords

    if (vibe === 'minor') {
      const minorChords = possibleChords.filter(c => c.type === 'minor');
      // Try to make a 4-chord loop. 
      if (minorChords.length > 0) {
        // Simple logic: Pick random minor chords to fill 4 slots
        // Better: Start with one, then try to move.
        // For now, just cycle them.
        for (let i = 0; i < 4; i++) {
          progression.push(minorChords[i % minorChords.length]);
        }
      } else {
        // Fallback: If we can't find pure minor triads, use what we have?
        // Or fail.
        if (possibleChords.length >= 1) {
          for (let i = 0; i < 4; i++) progression.push(possibleChords[0]);
        } else {
          return { success: false, scaleName };
        }
      }
    }

    // 6. Construct Pattern JSON
    const measures = 4;
    const STEPS = 16;
    const labels = new Array(measures * STEPS).fill(""); // Default empty entries

    // We need to fill specific steps with chords.
    // Let's do a simple whole note rhythm: Chord on Beat 1 of each measure.
    // Index 0, 16, 32, 48.

    progression.forEach((chord, idx) => {
      if (idx >= measures) return;
      const stepIndex = idx * STEPS;

      // Construct the chord label array: [LH-Index, LH-Thumb, RH-Index, RH-Thumb]
      // Mapping: 
      // LH Thumb (1) -> Root (Lowest available note preferred)
      // LH Index (0) -> Third 
      // RH Index (2) -> Fifth
      // RH Thumb (3) -> Octave or empty

      // Pick standard voicings (lowest logical note for root)
      const rootNote = chord.root.sort((a, b) => a.octave - b.octave)[0];
      const thirdNote = chord.third.sort((a, b) => a.octave - b.octave)[0];
      const fifthNote = chord.fifth.sort((a, b) => a.octave - b.octave)[0];

      if (!rootNote || !thirdNote || !fifthNote) return;

      // InnerLabels array of 4 strings
      // [0:L-Idx, 1:L-Thumb, 2:R-Idx, 3:R-Thumb]

      const chordArr = ['', '', '', ''];

      // Assign
      chordArr[1] = rootNote.num;  // LH Thumb -> Root
      chordArr[0] = thirdNote.num; // LH Index -> Third
      chordArr[2] = fifthNote.num; // RH Index -> Fifth

      // Add it to the labels array
      // Important: The grid expects labels[i] to be the array for that cell.
      labels[stepIndex] = chordArr;
    });

    return {
      success: true,
      scaleName,
      pattern: {
        measures,
        labels
      }
    };
  }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  window.aiAssistant = new AiAssistant();
});
