let micStream = null, audioAnalyser = null, isListening = false;
const BUFSIZE = 2048, buf = new Float32Array(BUFSIZE);

// State
let baseSensitivity = 0.05;
let gateDuration = 150;
let roomNoiseFloor = 0.01;
let prevRMS = 0;
let lastNoteTime = 0;
let lastFrameTranscriptionIndex = -1;
let stepWasRecorded = false;
let tally = {};

// Calibration State
let isCalibrating = false;
let calIndex = 0;
const calQueue = ['D', '1', '2', '3', '4', '5', '6', '7', '8'];
let noteSensitivities = JSON.parse(localStorage.getItem('gp_cal')) || {};

let isGuidedCalibrating = false;
let noteMultipliers = JSON.parse(localStorage.getItem('gp_multipliers')) || {};
// Initialize multipliers if empty
['D', '1', '2', '3', '4', '5', '6', '7', '8'].forEach(n => {
    if (!noteMultipliers[n]) noteMultipliers[n] = (n === 'D') ? 0.9 : 0.7;
});

const guidedCalBtn = document.getElementById('guidedCalBtn'); // You'll need this in HTML

// UI References
const micBtn = document.getElementById('micBtn');
const micCalBtn = document.getElementById('micCalBtn');
const targetNoteDisplay = document.getElementById('targetNoteName');
const calOverlay = document.getElementById('calibrationStatus');
const sensValDisplay = document.getElementById('sensVal');

// Note frequencies (C0 to B8)
const NOTE_FREQS = {
    "D3": 146.83, "Eb3": 155.56, "E3": 164.81, "F3": 174.61, "Fs3": 185.00, "G3": 196.00, "Gs3": 207.65, "A3": 220.00, "Bb3": 233.08, "B3": 246.94,
    "C4": 261.63, "Cs4": 277.18, "D4": 293.66, "Eb4": 311.13, "E4": 329.63, "F4": 349.23, "Fs4": 369.99, "G4": 392.00, "Gs4": 415.30, "A4": 440.00, "Bb4": 466.16, "B4": 493.88,
    "C5": 523.25 // Add more as needed based on your scales
};

const CONFIDENCE_THRESHOLD = 3; // Number of matching frames required to "win" the cell
const NOTE_SENSITIVITY_MULTIPLIER = 0.7;
const DING_SENSITIVITY_MULTIPLIER = 0.9;


// Initial Listen Toggle
async function toggleListening() {
    if (isListening) {
        isListening = false;
        micBtn.textContent = "🎤 Listen Mode: Off";
        micBtn.classList.remove('active');
        if (micStream) micStream.getTracks().forEach(t => t.stop());
        return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream = stream;
    ensureAudio(); // setup audioCtx from noteplayer
    const source = audioCtx.createMediaStreamSource(stream);
    audioAnalyser = audioCtx.createAnalyser();
    audioAnalyser.fftSize = BUFSIZE;
    source.connect(audioAnalyser);
    isListening = true;
    micBtn.textContent = "🎤 Listening...";
    micBtn.classList.add('active');
    requestAnimationFrame(transcriptionLoop);
}

// Get dynamic gate
function getDynamicGate() {
    // How long is one cell in milliseconds?
    // subdivisions: 16-mode = 4, 8-mode = 2
    const subdivisions = (typeof mode !== 'undefined' && mode === '16') ? 4 : 2;
    const currentBPM = (typeof bpmInput !== 'undefined') ? parseInt(bpmInput.value) : 120;

    const msPerStep = 60000 / (currentBPM * subdivisions);

    // Return 75% of the step duration
    return msPerStep * 0.75;
}

// Main Transcription Loop
function transcriptionLoop() {
    if (!isListening) return;

    audioAnalyser.getFloatTimeDomainData(buf);
    const pitch = autoCorrelate(buf, audioCtx.sampleRate);

    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const now = Date.now();

    // Use your custom transcriptionIndex snapshot
    const currentIndex = (typeof transcriptionIndex !== 'undefined') ? transcriptionIndex : -1;

    // Visualizer update
    const micLevel = document.getElementById('micLevel');
    if (micLevel) micLevel.style.width = Math.min(100, rms * 500) + "%";

    // Adaptive Noise Floor (tracks room hum)
    if (rms < baseSensitivity * 0.5 || pitch === -1) {
        roomNoiseFloor = (roomNoiseFloor * 0.95) + (rms * 0.05);
    }

    // Step Boundary Detection
    if (currentIndex !== lastFrameTranscriptionIndex) {
        tally = {};
        stepWasRecorded = false;
        lastFrameTranscriptionIndex = currentIndex;
    }

    const dynamicGate = getDynamicGate();
    const isGateOpen = (now - lastNoteTime > dynamicGate);
    //   const isGateOpen = (now - lastNoteTime > 150);
    const isNewStrike = rms > prevRMS * 1.4; // Spectral Flux (Sudden volume jump)

    if (isCalibrating) {
        handleCalibration(pitch, rms);
    } else if (playing && countdownRemaining === 0 && !stepWasRecorded
        && (isGateOpen || isNewStrike) && rms > (baseSensitivity + roomNoiseFloor)) {
        const detected = findClosestScaleNote(pitch);

        if (detected) {
            // 1. Use the specific multiplier found during Guided Calibration
            let multiplier = noteMultipliers[detected] || NOTE_SENSITIVITY_MULTIPLIER;
            let noteGateBonus = (detected === 'D') ? 100 : 0;

            let noteSpecificThreshold = baseSensitivity;
            if (noteSensitivities[detected]) {
                noteSpecificThreshold = noteSensitivities[detected] * multiplier;
            }

            // 2. DYNAMIC GATE + DING BUFFER
            const dynamicGate = getDynamicGate() + noteGateBonus;
            const isGateOpen = (now - lastNoteTime > dynamicGate);
            const isNewStrike = rms > prevRMS * 1.5;

            if ((isGateOpen || isNewStrike) && rms > noteSpecificThreshold) {
                tally[detected] = (tally[detected] || 0) + 1;

                if (tally[detected] >= CONFIDENCE_THRESHOLD) {
                    recordNoteToGrid(detected, currentIndex);
                    lastNoteTime = now;
                    stepWasRecorded = true;
                    tally = {};

                    // 3. AUTO-STOP GUIDED CALIBRATION
                    // If we just recorded the last note '8' on step 16, finish up
                    if (isGuidedCalibrating && detected === '8' && currentIndex >= 16) {
                        setTimeout(analyzeGuidedResults, 500); // Wait for sustain to settle
                    }
                }
            }
        }
    }

    prevRMS = rms;
    requestAnimationFrame(transcriptionLoop);
}

// Calibration Logic
function handleCalibration(pitch, rms) {
    const target = calQueue[calIndex];
    const detected = findClosestScaleNote(pitch);

    // When calibrating, look for a clear, loud hit of the target note
    if (rms > baseSensitivity && detected && detected === target) {
        noteSensitivities[target] = rms; // Store the actual recorded volume
        calIndex++;

        if (calIndex >= calQueue.length) {
            isCalibrating = false;
            calOverlay.style.display = 'none';
            calBtn.classList.remove('active');
            localStorage.setItem('gp_cal', JSON.stringify(noteSensitivities));
            alert("Handpan Profile Calibrated!");
        } else {
            targetNoteDisplay.textContent = calQueue[calIndex];
        }
    }
}

// Record the detected note to the grid
function recordNoteToGrid(label, index) {
    // Only write if the cell is currently empty or different
    // This allows you to "overdub" a different note if you play it louder later
    if (innerLabels[index] !== label) {
        setInnerLabel(index, label);

        // Visual feedback: Make the cell flash when recorded
        const cell = cells()[index];
        if (cell) {
            cell.style.transition = 'none';
            cell.style.boxShadow = '0 0 20px var(--btn-active)';
            setTimeout(() => {
                cell.style.transition = 'box-shadow 0.5s ease';
                cell.style.boxShadow = '';
            }, 100);
        }
    }
}

function analyzeGuidedResults() {
    const expectedPattern = ['D', '1', '2', '3', '4', '5', '6', '7', '8'];
    const results = [];
    let changesMade = false;

    // We expect notes on every 2nd beat: 0, 2, 4, 6, 8, 10, 12, 14, 16
    expectedPattern.forEach((note, i) => {
        const targetStep = i * 2;
        const recordedNote = innerLabels[targetStep];
        const doubleTrigger = innerLabels[targetStep + 1];

        // 1. MISSING NOTE: If target step is empty, lower the multiplier (make it easier)
        if (!recordedNote || recordedNote !== note) {
            noteMultipliers[note] = Math.max(0.1, noteMultipliers[note] - 0.1);
            results.push(`${note}: Missing - Sensitivity Increased`);
            changesMade = true;
        }
        // 2. DOUBLE TRIGGER: If next step has the same note, raise the multiplier (make it harder)
        else if (doubleTrigger === note) {
            noteMultipliers[note] = Math.min(1.0, noteMultipliers[note] + 0.1);
            results.push(`${note}: Double - Sensitivity Decreased`);
            changesMade = true;
        } else {
            results.push(`${note}: Perfect`);
        }
    });

    if (changesMade) {
        localStorage.setItem('gp_multipliers', JSON.stringify(noteMultipliers));
        alert("Calibration refined based on your playing!\n\n" + results.join('\n'));
    } else {
        alert("Patterns look perfect! No adjustments needed.");
    }

    isGuidedCalibrating = false;
    stop(); // Call your stop function from noteplayer.js
}

// Logic to map frequency to current scale labels (D, 1, 2, etc.)
function findClosestScaleNote(freq) {
    const currentScale = SCALES[selectedScaleName];
    if (!currentScale) return null;

    // Build a map of potential target notes for the current scale
    let targets = [{ label: 'D', freq: NOTE_FREQS[currentScale.ding] }];
    for (let [label, noteName] of Object.entries(currentScale.map)) {
        targets.push({ label, freq: NOTE_FREQS[noteName] });
    }

    // Find the one with the smallest frequency difference
    let closest = null;
    let minDiff = Infinity;

    targets.forEach(t => {
        const diff = Math.abs(t.freq - freq);
        if (diff < minDiff && diff < (t.freq * 0.05)) { // 5% tolerance
            minDiff = diff;
            closest = t.label;
        }
    });
    return closest;
}

// Standard Autocorrelation Algorithm
function autoCorrelate(buffer, sampleRate) {
    let SIZE = buffer.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) {
        let val = buffer[i];
        rms += val * val;
    }
    if (Math.sqrt(rms / SIZE) < 0.01) return -1;

    let r1 = 0, r2 = SIZE - 1, thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
    for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buffer[SIZE - i]) < thres) { r2 = SIZE - i; break; }
    buffer = buffer.slice(r1, r2);
    SIZE = buffer.length;

    let c = new Float32Array(SIZE).fill(0);
    for (let i = 0; i < SIZE; i++)
        for (let j = 0; j < SIZE - i; j++)
            c[i] = c[i] + buffer[j] * buffer[j + i];

    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < SIZE; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }
    let T0 = maxpos;
    return sampleRate / T0;
}

// Listeners
micBtn.addEventListener('click', toggleListening);
micCalBtn.addEventListener('click', () => {
    if (!isListening) return alert("Start Listening first");
    isCalibrating = true;
    calIndex = 0;
    micCalBtn.classList.add('active');
    calOverlay.style.display = 'block';
    targetNoteDisplay.textContent = calQueue[0];
});
micSensInput?.addEventListener('input', () => {
    baseSensitivity = parseFloat(micSensInput.value);
    if (sensValDisplay) sensValDisplay.textContent = baseSensitivity.toFixed(2);
});