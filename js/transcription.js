import { unlockAudio, getAudioCtx, addTickObserver, stop, start } from './noteplayer.js';
import { getScale } from './state.js';
import { activeGrid } from './grid-context.js';
import { cells, setInnerLabel, renderAllMeasures } from './notegrid.js';
import { loadPatternByName } from './controls.js';
import { isListening, setIsListening } from './state.js';
import { isCoaching, evaluateDetectedNote } from './coaching-mode.js';

export let micStream = null, audioAnalyser = null;
let lastActiveElement = null;
const BUFSIZE = 2048, buf = new Float32Array(BUFSIZE);

// --- Settings & State ---
let baseSensitivity = 0.05;
let roomNoiseFloor = 0.01;
let prevRMS = 0;
let lastNoteTime = 0;
let lastFrameTranscriptionIndex = -1;
let stepWasRecorded = false;
let tally = {};
const CONFIDENCE_THRESHOLD = 2;

// --- Calibration State ---
let isCalibrating = false; // Standard note-by-note volume check
let calIndex = 0;
const calQueue = ['D', '1', '2', '3', '4', '5', '6', '7', '8'];
let noteSensitivities = JSON.parse(localStorage.getItem('gp_cal')) || {};

// --- Guided Calibration State (Self-Correction) ---
let isGuidedCalibrating = false

const CALIBRATE_PATTERN_8_BEATS = 'Calibrate - 8 Beats Per Measure';

// Load custom multipliers or set defaults
let noteMultipliers = JSON.parse(localStorage.getItem('gp_multipliers')) || {
    'D': 0.85, '1': 0.5, '2': 0.5, '3': 0.5, '4': 0.5, '5': 0.5, '6': 0.5, '7': 0.5, '8': 0.5
};

// Note frequencies (Octaves 2-6)
const NOTE_FREQS = {
    "C2": 65.41, "Cs2": 69.30, "D2": 73.42, "Eb2": 77.78, "E2": 82.41, "F2": 87.31, "Fs2": 92.50, "G2": 98.00, "Gs2": 103.83, "A2": 110.00, "Bb2": 116.54, "B2": 123.47,
    "C3": 130.81, "Cs3": 138.59, "D3": 146.83, "Eb3": 155.56, "E3": 164.81, "F3": 174.61, "Fs3": 185.00, "G3": 196.00, "Gs3": 207.65, "A3": 220.00, "Bb3": 233.08, "B3": 246.94,
    "C4": 261.63, "Cs4": 277.18, "D4": 293.66, "Eb4": 311.13, "E4": 329.63, "F4": 349.23, "Fs4": 369.99, "G4": 392.00, "Gs4": 415.30, "A4": 440.00, "Bb4": 466.16, "B4": 493.88,
    "C5": 523.25, "Cs5": 554.37, "D5": 587.33, "Eb5": 622.25, "E5": 659.25, "F5": 698.46, "Fs5": 739.99, "G5": 783.99, "Gs5": 830.61, "A5": 880.00, "Bb5": 932.33, "B5": 987.77,
    "C6": 1046.50
};

// --- UI References ---
let micBtn, micCalBtn, guidedCalBtn, targetNoteDisplay, micCalOverlay, sensValDisplay, meter;

// --- Sync State ---
let transcriptionIndex = -1;


async function toggleListening() {
    if (isListening) {
        setIsListening(false);
        micBtn.textContent = "🎤";
        micBtn.classList.remove('active');
        meter.style.display = 'none';
        if (micStream) micStream.getTracks().forEach(t => t.stop());
        return;
    }

    try {
        // 1. Initialize Audio Context (User Gesture)
        unlockAudio();
        const audioCtx = getAudioCtx();

        if (!audioCtx) {
            console.error("Audio Context not available");
            return;
        }

        // 2. Resume if suspended
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        // 3. Get Microphone Stream
        // Request sample rate matching the context to avoid errors
        const constraints = {
            audio: {
                sampleRate: audioCtx.sampleRate,
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false
            }
        };

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            console.warn("Could not get matching sample rate, trying default", e);
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        micStream = stream;

        // 4. Connect Stream to Analyser
        const source = audioCtx.createMediaStreamSource(stream);
        audioAnalyser = audioCtx.createAnalyser();
        // Use a power of 2 for FFT size (e.g., 2048)
        audioAnalyser.fftSize = BUFSIZE;
        source.connect(audioAnalyser);

        setIsListening(true);
        micBtn.textContent = "🎤";
        micBtn.classList.add('active');
        meter.style.display = 'block';

        requestAnimationFrame(transcriptionLoop);
    } catch (err) {
        console.error("Microphone/Audio Error:", err);
        alert("Microphone access denied or audio device error.\nPlease check your settings.");
    }
}

// --- 1. Rhythmic Intelligence (Auto-Gate) ---
function getDynamicGate() {
    const ctx = activeGrid;
    const subdivisions = (ctx.mode === '16') ? 4 : 2;
    const currentBPM = ctx.bpm;
    const msPerStep = 60000 / (currentBPM * subdivisions);
    return msPerStep * 0.75; // Gate is 75% of a cell's duration
}

// --- 2. Main Processing Loop ---
function transcriptionLoop() {
    if (!isListening) return;

    if (!audioAnalyser) return;
    audioAnalyser.getFloatTimeDomainData(buf);
    const audioCtx = getAudioCtx();
    const pitch = autoCorrelate(buf, audioCtx.sampleRate);

    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const now = Date.now();

    // Use local sync variable
    const currentIndex = transcriptionIndex;

    // DEBUG: Heartbeat to ensure loop is alive and see state
    // if (Math.random() < 0.02) {
    //     console.log(`[Transcription Heartbeat] Listening: ${isListening}, Index: ${currentIndex}, RMS: ${rms.toFixed(4)}, Floor: ${roomNoiseFloor.toFixed(4)}, Pitch: ${pitch}`);
    // }

    // Update Guided Calibration display
    if (isGuidedCalibrating) {
        updateGuidedUI(currentIndex);
    }

    // Visual Meter
    const micLevel = document.getElementById('micLevel');
    if (micLevel) micLevel.style.width = Math.min(100, rms * 500) + "%";

    // Adaptive Noise Floor
    if (rms < baseSensitivity * 0.5 || pitch === -1) {
        roomNoiseFloor = (roomNoiseFloor * 0.95) + (rms * 0.05);
    }

    // Step Boundary Detection
    if (currentIndex !== lastFrameTranscriptionIndex) {
        tally = {};
        stepWasRecorded = false;
        lastFrameTranscriptionIndex = currentIndex;
    }

    if (isCalibrating) {
        handleCalibration(pitch, rms);
    } else if (activeGrid.playing) {
        // Debug every potential hit (loud enough)
        // if (rms > roomNoiseFloor) {
        //     console.log(`[Check] Pitch: ${pitch}, RMS: ${rms}, Floor: ${roomNoiseFloor}, StepRecorded: ${stepWasRecorded}`);
        // }

        if (!stepWasRecorded && rms > roomNoiseFloor) {
            const detected = findClosestScaleNote(pitch); // Returns label string directly

            if (detected) {
                console.log("Detected Note:", detected);

                // Use the note-specific multiplier from Guided Calibration
                const multiplier = noteMultipliers[detected] || 0.5;

                // Calculate specific threshold
                let noteSpecificThreshold = baseSensitivity * multiplier;
                if (noteSensitivities[detected]) {
                    noteSpecificThreshold = noteSensitivities[detected] * multiplier;
                }

                const dynamicGate = getDynamicGate();
                const isGateOpen = (now - lastNoteTime > dynamicGate);
                const isNewStrike = rms > prevRMS * 1.3; // Spectral Flux

                if ((isGateOpen || isNewStrike) && rms > noteSpecificThreshold) {
                    tally[detected] = (tally[detected] || 0) + 1;

                    if (tally[detected] >= CONFIDENCE_THRESHOLD) {
                        if (isCoaching()) {
                            evaluateDetectedNote(detected, transcriptionIndex, now);
                        } else {
                            recordNoteToGrid(detected, currentIndex, activeGrid);
                        }
                        lastNoteTime = now;
                        stepWasRecorded = true;
                        tally = {};

                        // Auto-finish Guided Calibration
                        if (isGuidedCalibrating && detected === '8' && currentIndex >= 16) {
                            setTimeout(analyzeGuidedResults, 1000);
                        }
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
            micCalOverlay.style.display = 'none';
            // calBtn.classList.remove('active'); // calBtn not defined? Assuming micCalBtn logic handles it or this was legacy
            localStorage.setItem('gp_cal', JSON.stringify(noteSensitivities));
            alert("Handpan Profile Calibrated!");
        } else {
            targetNoteDisplay.textContent = calQueue[calIndex];
        }
    }
}

// Record the detected note to the grid
function recordNoteToGrid(label, index, ctx = activeGrid) {
    if (index === -1) return;

    let currentArray = ctx.innerLabels[index];

    // Convert to array if it isn't one
    if (!Array.isArray(currentArray)) {
        currentArray = currentArray ? [currentArray] : [];
    }

    // Only add if not present and we have space (max 4)
    if (!currentArray.includes(label) && currentArray.length < 4) {
        currentArray.push(label);

        // Pass the array to setInnerLabel
        if (typeof setInnerLabel === 'function') setInnerLabel(index, currentArray, ctx);

        // Visual feedback flash
        const cellList = cells(ctx);
        const cell = cellList[index];
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

// --- 3. Guided Calibration Analysis ---
function analyzeGuidedResults() {
    const expected = ['D', '1', '2', '3', '4', '5', '6', '7', '8'];
    let adjustments = [];

    const ctx = activeGrid;

    expected.forEach((note, i) => {
        const targetStep = i * 2; // We expect one note every 2 beats
        const recorded = ctx.innerLabels[targetStep];
        const doubleTrigger = ctx.innerLabels[targetStep + 1];

        // MISS: Lower multiplier (make it easier to trigger)
        // recorded might be array or string. simplify check:
        const recVal = Array.isArray(recorded) ? recorded[0] : recorded;

        if (recVal !== note) {
            noteMultipliers[note] = Math.max(0.1, noteMultipliers[note] - 0.1);
            adjustments.push(`${note}: Sensitivity Increased`);
        }
        // DOUBLE: Raise multiplier (make it harder to trigger)
        else if ((Array.isArray(doubleTrigger) ? doubleTrigger[0] : doubleTrigger) === note) {
            noteMultipliers[note] = Math.min(0.95, noteMultipliers[note] + 0.1);
            adjustments.push(`${note}: Double-Trigger Fixed`);
        }
    });

    // UI Cleanup
    alert("Calibration Complete!\n" + (adjustments.length ? adjustments.join('\n') : "Perfect recording. No changes needed."));
    guidedCalModal.style.display = 'none';
    isGuidedCalibrating = false;
    resetGuideUI();

    localStorage.setItem('gp_multipliers', JSON.stringify(noteMultipliers));
    isGuidedCalibrating = false;
    stop(activeGrid);
}

// --- 4. Logic Fix: findClosestScaleNote returns label ---
function findClosestScaleNote(freq) {
    const currentScale = getScale();
    if (!currentScale) return null;

    let targets = [{ label: 'D', freq: NOTE_FREQS[currentScale.ding] }];
    for (let [label, noteName] of Object.entries(currentScale.map)) {
        targets.push({ label, freq: NOTE_FREQS[noteName] });
    }

    let closest = null;
    let minDiff = Infinity;

    targets.forEach(t => {
        const diff = Math.abs(t.freq - freq);
        if (diff < minDiff && diff < (t.freq * 0.05)) {
            minDiff = diff;
            closest = t.label; // Return the label string directly
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
    if (Math.sqrt(rms / SIZE) < 0.01) {
        // console.log("Signal too quiet", Math.sqrt(rms / SIZE));
        return -1;
    }

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

// Guided Calibration Modal
const guidedCalModal = document.getElementById('guidedCalModal');
const startGuidedBtn = document.getElementById('startGuidedBtn');
const closeGuidedBtn = document.getElementById('closeGuidedBtn');
const guideNoteBox = document.getElementById('guideNoteBox');
const guideProgress = document.getElementById('guideProgress');


// Update the "Bouncing Ball" (Call this inside transcriptionLoop)
function updateGuidedUI(currentIndex) {
    if (!isGuidedCalibrating) return;

    const expected = ['D', '1', '2', '3', '4', '5', '6', '7', '8'];
    // We expect a note every 2 steps: 0, 2, 4, 6...
    const noteIndex = Math.floor(currentIndex / 2);

    if (noteIndex < expected.length) {
        const targetNote = expected[noteIndex];
        const isStrikeStep = (currentIndex % 2 === 0);

        guideNoteBox.textContent = targetNote;
        guideNoteBox.style.opacity = isStrikeStep ? "1" : "0.3";

        // Update progress bar
        const progress = ((noteIndex + 1) / expected.length) * 100;
        guideProgress.style.width = progress + "%";
    }
}

function resetGuideUI() {
    guideNoteBox.textContent = "READY";
    guideNoteBox.style.opacity = "1";
    guideProgress.style.width = "0%";
    startGuidedBtn.disabled = false;
    startGuidedBtn.textContent = "Begin Calibration";
}


export function initTranscription() {
    micBtn = document.getElementById('micBtn');
    micCalBtn = document.getElementById('micCalBtn');
    guidedCalBtn = document.getElementById('guidedCalBtn');
    targetNoteDisplay = document.getElementById('targetNoteName');
    micCalOverlay = document.getElementById('calibrationStatus');
    sensValDisplay = document.getElementById('sensVal');
    meter = document.getElementById('micVisualizer');

    if (!micBtn) return;

    // Tick Observer for sync
    addTickObserver((ctx) => {
        if (ctx && ctx.id === 'A') {
            transcriptionIndex = ctx.step;
        }
    });

    // Listeners
    micBtn.addEventListener('click', (e) => {
        toggleListening();
    });

    micBtn?.addEventListener('mouseover', (e) => {
        const menu = document.getElementById('micDropdownMenu');
        if (menu) {
            if (menu.classList.contains('show'))
                menu.classList.remove('show');
            else
                menu.classList.add('show');
        }
    });

    micCalBtn?.addEventListener('click', (e) => {
        if (e) e.stopPropagation();
        if (!isListening) return;
        isCalibrating = true;
        calIndex = 0;
        micCalOverlay.style.display = 'block';
        targetNoteDisplay.textContent = calQueue[0];
    });

    guidedCalBtn?.addEventListener('click', (e) => {
        if (e) e.stopPropagation();
        if (!isListening) {
            alert("Please enable 'Listen Mode' first.");
            const menu = document.getElementById('micDropdownMenu');
            if (menu) menu.classList.remove('show');
            return;
        }

        // Clear the grid (Direct state update)
        ctx.innerLabels = Array(ctx.innerLabels.length).fill('');
        ctx.innerHands = Array(ctx.innerHands.length).fill(null);
        renderAllMeasures(ctx);

        // Set BPM super slow
        ctx.bpm = 40;
        if (ctx.bpmInput) ctx.bpmInput.value = '40';
        const bVal = document.getElementById('bpmVal-' + ctx.id);
        if (bVal) bVal.textContent = '40';

        // Ensure there are just enough empty measures
        if (typeof loadPatternByName === 'function') loadPatternByName(CALIBRATE_PATTERN_8_BEATS);

        lastActiveElement = document.activeElement;

        const modal = document.getElementById('guidedCalModal');
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', false);

        const menu = document.getElementById('micDropdownMenu');
        if (menu) menu.classList.remove('show');

        setTimeout(() => {
            document.getElementById('startGuidedBtn')?.focus();
        }, 10);

        resetGuideUI();
    });

    const closeGuidedBtnLocal = document.getElementById('closeGuidedBtn');
    closeGuidedBtnLocal?.addEventListener('click', () => {
        const modal = document.getElementById('guidedCalModal');
        modal.style.display = 'none';
        isGuidedCalibrating = false;
        modal.setAttribute('aria-hidden', true);

        if (activeGrid.playing) stop(activeGrid);
        if (lastActiveElement) lastActiveElement.focus();
    });

    const startGuidedBtnLocal = document.getElementById('startGuidedBtn');
    startGuidedBtnLocal?.addEventListener('click', () => {
        isGuidedCalibrating = true;
        startGuidedBtnLocal.disabled = true;
        startGuidedBtnLocal.textContent = "Calibrating...";

        const ctx = activeGrid;
        ctx.innerLabels = Array(ctx.innerLabels.length).fill('');
        ctx.innerHands = Array(ctx.innerHands.length).fill(null);
        renderAllMeasures(ctx);

        start(ctx);
    });
}