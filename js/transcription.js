import { unlockAudio, getAudioCtx, addTickObserver, stop, start } from './noteplayer.js';
import { activeGrid } from './grid-context.js';
import { cells, setInnerLabel, renderAllMeasures } from './notegrid.js';
import { loadPatternByName } from './controls.js';
import { isListening, setIsListening, getScale, getCurrentScaleId, currentUser } from './state.js';
import { isCoaching, evaluateDetectedNote, logCoachingEvent } from './coaching-mode.js';
import { ACCENT_RMS_MULTIPLIER } from './config.js';
import { Bus, BUS_EVENT } from './bus.js';
import { supabase } from './supabase-client.js';

export let micStream = null, audioAnalyser = null;
let lastActiveElement = null;
const BUFSIZE = 2048, buf = new Float32Array(BUFSIZE);

// --- Settings & State ---
let baseSensitivity = 0.05;
let roomNoiseFloor = 0.01;
let prevRMS = 0;
// Transcription State
let lastNoteTime = 0;
let currentIndex = 0;
let lastFrameTranscriptionIndex = -1;
let stepWasRecorded = false;
let tally = {};
let lastDetectedType = null;
let lastGlobalDetectedNote = null; // Track across steps to prevent sustain re-triggers
const CONFIDENCE_THRESHOLD = 2;
const PENDING_ACCENT_WINDOW = 100; // ms to wait for a pitch after an accent
let pendingAccent = null; // { step, timestamp, startTime }

// --- Calibration State ---
let isCalibrating = false; // Standard note-by-note volume check
let calIndex = 0;
const calQueue = ['Ding', '1', '2', '3', '4', '5', '6', '7', '8', 'Tak', 'Slap'];
const CAL_SAMPLES_REQUIRED = 20;
let noteSensitivities = JSON.parse(localStorage.getItem('gp_cal')) || {};
let noteClarityAverages = JSON.parse(localStorage.getItem('gp_clarity_profiles')) || {};

// --- Frequency Profiling ---
let currentCalibratedFreqs = {}; // Map of { label: freq } for current scale
let skipCalibrationCheck = {};   // Track if user clicked "Continue Anyway" for a scale

// --- Guided Calibration State (Self-Correction) ---
let isGuidedCalibrating = false;
let isFullCalWizard = false;
let lastGuidedIndex = -1;

const CALIBRATE_PATTERN_8_BEATS = 'Calibrate - 8 Beats Per Measure';

// Load custom multipliers or set defaults
let noteMultipliers = JSON.parse(localStorage.getItem('gp_multipliers')) || {
    'Ding': 0.85, '1': 0.5, '2': 0.5, '3': 0.5, '4': 0.5, '5': 0.5, '6': 0.5, '7': 0.5, '8': 0.5
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
let micBtn, micCalBtn, guidedCalBtn, targetNoteDisplay, micCalOverlay, sensValDisplay, meter, calProgressCircle;

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

    // Get pitch AND clarity
    const pitchObj = autoCorrelate(buf, audioCtx.sampleRate);
    const pitch = (pitchObj && pitchObj.freq) ? pitchObj.freq : -1;
    const clarity = (pitchObj && pitchObj.clarity) ? pitchObj.clarity : 0;

    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const now = Date.now();
    const nowAudioMs = audioCtx.currentTime * 1000; // Unified Audio Clock (ms)

    // Update current index from grid (User confirmed transcriptionIndex is correct)
    currentIndex = activeGrid.transcriptionIndex;
    transcriptionIndex = currentIndex; // Sync local global variable

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

    // --- COMMIT PENDING ACCENTS ---
    if (pendingAccent) {
        // Only commit if the 100ms window has passed.
        // We REMOVED the "currentIndex !== pendingAccent.step" check so that 
        // a pitch landing on the NEXT step can still claim/cancel this accent.
        if (now - pendingAccent.startTime > PENDING_ACCENT_WINDOW) {
            console.log(`[Transcription] Committing Buffered Accent: Step ${pendingAccent.step}`);
            const commitTimestamp = pendingAccent.timestamp;
            const commitStep = pendingAccent.step;
            pendingAccent = null;

            if (isCoaching()) {
                evaluateDetectedNote('ACCENT', commitStep, commitTimestamp);
            } else {
                recordNoteToGrid('S', commitStep, activeGrid);
            }
            lastNoteTime = now;
            stepWasRecorded = true;
            lastDetectedType = 'ACCENT';
            tally = {};
        }
    }

    // Adaptive Noise Floor
    if (rms < baseSensitivity * 0.5 || pitch === -1) {
        roomNoiseFloor = (roomNoiseFloor * 0.95) + (rms * 0.05);
    }

    // Step Boundary Detection
    if (currentIndex !== lastFrameTranscriptionIndex) {
        logCoachingEvent(`--- Step Boundary: ${lastFrameTranscriptionIndex} -> ${currentIndex} ---`, currentIndex);
        tally = {};
        stepWasRecorded = false;
        lastDetectedType = null;
        lastFrameTranscriptionIndex = currentIndex;
    }

    if (isCalibrating) {
        handleCalibration(pitch, rms, clarity);
    } else if (activeGrid.playing) {
        // Debug every potential hit (loud enough)
        // if (rms > roomNoiseFloor) {
        //     console.log(`[Check] Pitch: ${pitch}, RMS: ${rms}, Floor: ${roomNoiseFloor}, StepRecorded: ${stepWasRecorded}`);
        // }

        // In Coaching Mode, if we have a PENDING ACCENT, we are in "Refinement Mode"
        // This is much more reliable than stepWasRecorded/lastDetectedType checks.
        const canRefine = (pendingAccent !== null);

        if ((!stepWasRecorded || canRefine) && rms > roomNoiseFloor) {

            // 0. Pre-calculate Clarity info
            const detectedNoteLabel = findClosestScaleNote(pitch);
            let CLARITY_THRESHOLD = userClarityThreshold;

            // DYNAMIC CLARITY ADJUSTMENT based on calibration
            // If we have calibrated 'Tak' or 'Slap' clarity, we use it to nudge the threshold.
            // This prevents "dirty" notes (like Dings) from being seen as accents if they are clearer than actual accents.
            const takClarity = noteClarityAverages['Tak'] || 0.4;
            const slapClarity = noteClarityAverages['Slap'] || 0.4;
            const baselineAccentClarity = Math.max(takClarity, slapClarity);

            // Get Ding Frequency for dynamic protection
            const currentScale = getScale();
            const dingFreq = (currentScale && NOTE_FREQS[currentScale.ding]) ? NOTE_FREQS[currentScale.ding] : 0;
            const dingProtectionLimit = dingFreq ? (dingFreq + 40) : 150;

            // If we have a detected note, we want to ensure its clarity is safely above
            // the calibrated "noise" level of a true accent.
            if (detectedNoteLabel) {
                // If it's a Ding, be extra lenient, but still watch the accent baseline
                if (detectedNoteLabel === 'D' || pitch < dingProtectionLimit) {
                    CLARITY_THRESHOLD = Math.max(baselineAccentClarity + 0.05, userClarityThreshold - 0.1);
                } else {
                    // Regular notes should be significantly clearer than a Tak/Slap
                    CLARITY_THRESHOLD = Math.max(baselineAccentClarity + 0.1, userClarityThreshold);
                }
            }

            const isClearNote = detectedNoteLabel && clarity > CLARITY_THRESHOLD;

            // 1. Check for NOTES first (Priority)
            if (isClearNote) {
                // If it's a clear note, we trust it over any accent/strike logic
                // We let the standard pitch detection logic below handle it
            }

            // 2. Check for ACCENTS (Secondary)
            const flux = rms / prevRMS;
            const isStrike = flux > 1.3 || rms > (baseSensitivity * 2);
            const MIN_ACCENT_RMS = 0.02;

            // It is an accent only if:
            // - It is a strike
            // - It is NOT a clear note
            // - It has low clarity OR extreme pitch (Very low thumps or high clicks)
            // * Changed pitch < 100 to pitch < 50 to protect D2 (approx 73Hz)
            const isAccent = !isClearNote && isStrike && rms > MIN_ACCENT_RMS && (clarity < CLARITY_THRESHOLD || pitch < 50 || pitch > 3000);
            const dynamicGate = getDynamicGate();
            const isGateOpen = (now - lastNoteTime > dynamicGate);
            const isNewStrike = flux > 1.35;

            if (isAccent) {
                logCoachingEvent(`ACCENT Candidate: RMS ${rms.toFixed(4)}, Clarity ${clarity.toFixed(3)}, Pitch ${pitch.toFixed(1)}`, transcriptionIndex);

                if (isGateOpen || isNewStrike) {
                    // Fast Trigger for Slaps (1 Frame)
                    tally['ACCENT'] = (tally['ACCENT'] || 0) + 1;

                    if (tally['ACCENT'] >= 1) { // Immediate
                        logCoachingEvent(`ACCENT Buffered...`, transcriptionIndex);
                        // Instead of committing immediately, we buffer to wait for pitch refinement
                        if (!stepWasRecorded && !pendingAccent) {
                            pendingAccent = {
                                step: currentIndex,
                                timestamp: nowAudioMs,
                                startTime: now
                            };
                        }
                    }
                }
            } else {
                // Regular Note Logic

                // Pitch-based detection for regular notes
                const detected = findClosestScaleNote(pitch); // Returns label string directly

                if (detected) {
                    logCoachingEvent(`NOTE Candidate: ${detected}, Pitch ${pitch.toFixed(1)}, Clarity ${clarity.toFixed(3)}, RMS ${rms.toFixed(4)}`, transcriptionIndex);

                    // Use the note-specific multiplier from Guided Calibration
                    const multiplier = noteMultipliers[detected] || 0.5;

                    // Calculate specific threshold
                    let noteSpecificThreshold = baseSensitivity * multiplier;
                    if (noteSensitivities[detected]) {
                        noteSpecificThreshold = noteSensitivities[detected] * multiplier;
                    }

                    const isPassRMS = rms > noteSpecificThreshold;
                    const isPassGate = (isGateOpen || isNewStrike || canRefine);

                    if (!isPassGate || !isPassRMS) {
                        // Log why it was rejected early if needed, but maybe too noisy?
                        // Let's log if it's loud enough but gate is closed.
                        if (isPassRMS && !isPassGate) {
                            const gateRemaining = Math.max(0, dynamicGate - (now - lastNoteTime));
                            logCoachingEvent(`NOTE Rejected: Gate Closed (Remaining: ${gateRemaining.toFixed(0)}ms, Flux: ${flux.toFixed(2)})`, transcriptionIndex);
                        } else if (!isPassRMS) {
                            // Too quiet, don't log every frame
                        }
                    }

                    if (isPassGate && isPassRMS) {
                        // console.log(`[Check] Note: ${detected}, Flux: ${flux.toFixed(2)}, NewStrike: ${isNewStrike}, Gate: ${isGateOpen}, RMS: ${rms.toFixed(4)}`);

                        // SUSTAIN FIX: If we are detecting the SAME note as before,
                        // we MUST have a confirmed new strike (higher flux) to record it.
                        // REFINEMENT EXCEPTION: If we are currently refining an accent,
                        // we SKIP the sustain check because the accent ITSELF is the new strike.
                        let isSustainBlocked = false;
                        if (detected === lastGlobalDetectedNote && !canRefine) {
                            if (flux < 1.35) {
                                logCoachingEvent(`NOTE Rejected: Sustain Blocked (Flux ${flux.toFixed(2)} < 1.35)`, transcriptionIndex);
                                isSustainBlocked = true;
                            } else {
                                logCoachingEvent(`NOTE Passed: Sustain Allowed (Flux ${flux.toFixed(2)} > 1.35)`, transcriptionIndex);
                            }
                        }

                        if (!isSustainBlocked) {
                            tally[detected] = (tally[detected] || 0) + 1;

                            if (tally[detected] >= CONFIDENCE_THRESHOLD) {
                                // --- PERFORMANCE: Calculate the EXACT hit time ---
                                // If refined, use the original percussive attack time.
                                // If not refined, we subtract the confidence lag (approx 32ms for 2 frames).
                                let hitTime = nowAudioMs;
                                let hitStep = transcriptionIndex;

                                if (pendingAccent) {
                                    console.log(`[Transcription] Refining Accent -> Note: ${detected} (Using True Attack Timing)`);
                                    hitTime = pendingAccent.timestamp;
                                    hitStep = pendingAccent.step;
                                    pendingAccent = null;
                                } else {
                                    // Compensation for the 2-frame confidence threshold (~16ms * 2 = 32ms)
                                    hitTime = nowAudioMs - 32;
                                }

                                logCoachingEvent(`NOTE Confirmed: ${detected} (Hit Time: ${hitTime.toFixed(0)})`, hitStep);
                                // Update global tracker
                                lastGlobalDetectedNote = detected;

                                if (isCoaching()) {
                                    evaluateDetectedNote(detected, hitStep, hitTime);
                                } else {
                                    recordNoteToGrid(detected, hitStep, activeGrid);
                                }
                                lastNoteTime = now;
                                stepWasRecorded = true;
                                lastDetectedType = detected;
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
        }
    }
    prevRMS = rms;
    requestAnimationFrame(transcriptionLoop);
}

// Calibration Logic
function handleCalibration(pitch, rms, clarity) {
    if (!isCalibrating) return;

    console.log("Calibrating...")

    const target = calQueue[calIndex];
    const isAccentCal = (target === 'Tak' || target === 'Slap');
    let isHit = false;

    if (isAccentCal) {
        // For accents, we look for a sharp strike (rms > floor) 
        // with low clarity (as expected for percussive hits)
        const flux = rms / prevRMS;
        if (rms > baseSensitivity * 1.5 && flux > 1.3) {
            isHit = true;
        }
    } else {
        // Standard Note Calibration
        const detected = findClosestScaleNote(pitch);
        if (rms > baseSensitivity && detected && detected === target) {
            isHit = true;
        }
    }

    if (isHit) {
        // Standard volume calibration
        if (!noteSensitivities[target]) noteSensitivities[target] = [];
        if (Array.isArray(noteSensitivities[target])) {
            noteSensitivities[target].push(rms);
        } else {
            noteSensitivities[target] = [rms];
        }

        // Clarity Profile for Accents (and notes too, why not?)
        if (!noteClarityAverages[target]) noteClarityAverages[target] = [];
        noteClarityAverages[target].push(clarity);

        // Personalized Pitch Calibration (Notes only)
        if (!isAccentCal && pitch && pitch > 50 && pitch < 1200) {
            if (!currentCalibratedFreqs[target]) currentCalibratedFreqs[target] = [];
            if (Array.isArray(currentCalibratedFreqs[target])) {
                currentCalibratedFreqs[target].push(pitch);
            } else {
                currentCalibratedFreqs[target] = [pitch];
            }
        }

        const currentTally = Array.isArray(noteSensitivities[target]) ? noteSensitivities[target].length : CAL_SAMPLES_REQUIRED;

        // Update UI with progress
        if (targetNoteDisplay) {
            targetNoteDisplay.textContent = target;
        }
        if (calProgressCircle) {
            const progress = (currentTally / CAL_SAMPLES_REQUIRED) * 100;
            calProgressCircle.style.strokeDashoffset = 100 - progress;
        }

        if (currentTally >= CAL_SAMPLES_REQUIRED) {
            if (calProgressCircle) calProgressCircle.style.strokeDashoffset = 100;

            // Average Volume
            const avgVol = noteSensitivities[target].reduce((a, b) => a + b, 0) / noteSensitivities[target].length;
            noteSensitivities[target] = avgVol;
            localStorage.setItem('gp_cal', JSON.stringify(noteSensitivities));

            // Average Clarity
            const avgClarity = noteClarityAverages[target].reduce((a, b) => a + b, 0) / noteClarityAverages[target].length;
            noteClarityAverages[target] = avgClarity;
            localStorage.setItem('gp_clarity_profiles', JSON.stringify(noteClarityAverages));

            // Average Pitch (Notes only)
            if (!isAccentCal) {
                if (currentCalibratedFreqs[target] && Array.isArray(currentCalibratedFreqs[target]) && currentCalibratedFreqs[target].length >= CAL_SAMPLES_REQUIRED) {
                    const avgPitch = currentCalibratedFreqs[target].reduce((a, b) => a + b, 0) / currentCalibratedFreqs[target].length;
                    currentCalibratedFreqs[target] = avgPitch;
                    saveCalibrationProfile();
                } else if (currentCalibratedFreqs[target] && !Array.isArray(currentCalibratedFreqs[target])) {
                    // Use already calculated pitch
                } else {
                    currentCalibratedFreqs[target] = getTheoreticalFreq(target);
                    saveCalibrationProfile();
                }
            }

            calIndex++;
            if (calIndex < calQueue.length) {
                targetNoteDisplay.textContent = calQueue[calIndex];
            } else {
                finishCalibration();
            }
        }
    }
}

function getTheoreticalFreq(label) {
    const scale = getScale();
    if (label === 'Ding') return NOTE_FREQS[scale.ding];
    return NOTE_FREQS[scale.map[label]];
}

/**
 * Persists the current frequency profile to DB and local cache
 */
async function saveCalibrationProfile() {
    const scaleId = getCurrentScaleId();
    const storageKey = `gp_pitch_cal_${scaleId}`;

    // Cache locally
    localStorage.setItem(storageKey, JSON.stringify(currentCalibratedFreqs));

    if (currentUser && supabase) {
        try {
            const { error } = await supabase
                .from('scale_calibrations')
                .upsert({
                    user_id: currentUser.id,
                    scale_id: scaleId,
                    frequency_map: currentCalibratedFreqs
                }, { onConflict: 'user_id,scale_id' });

            if (error) console.error("Error syncing calibration to DB:", error);
        } catch (err) {
            console.error("Failed to sync calibration:", err);
        }
    }
}

/**
 * Loads the calibration profile for the current scale
 */
export async function loadCalibrationProfile() {
    const scaleId = getCurrentScaleId();
    const storageKey = `gp_pitch_cal_${scaleId}`;

    // 1. Try local cache first for speed
    const cached = localStorage.getItem(storageKey);
    if (cached) {
        currentCalibratedFreqs = JSON.parse(cached);
        return currentCalibratedFreqs;
    }

    // 2. Try DB
    if (currentUser && supabase) {
        try {
            const { data, error } = await supabase
                .from('scale_calibrations')
                .select('frequency_map')
                .eq('user_id', currentUser.id)
                .eq('scale_id', scaleId)
                .maybeSingle();

            if (data?.frequency_map) {
                currentCalibratedFreqs = data.frequency_map;
                localStorage.setItem(storageKey, JSON.stringify(currentCalibratedFreqs));
                return currentCalibratedFreqs;
            }
        } catch (err) {
            console.error("Failed to load calibration from DB:", err);
        }
    }

    currentCalibratedFreqs = {};
    return null;
}

export function hasCalibrationForCurrentScale() {
    return Object.values(currentCalibratedFreqs).some(v => typeof v === 'number');
}

function finishCalibration() {
    isCalibrating = false;
    micCalOverlay.style.display = 'none';

    if (isFullCalWizard) {
        // Confirmation for Phase 2
        const response = confirm("1. Pitch Calibration Complete!\n\nReady to start Phase 2: Sensitivity Calibration?\n\nThis will load a rhythmic pattern for you to play along with.");
        if (response) {
            // Trigger Guided (Sensitivity) Calibration
            guidedCalBtn?.click();
        } else {
            isFullCalWizard = false;
            setIsListening(false);
            alert("Full Calibration cancelled.");
        }
    } else {
        alert("Pitch Calibration Complete!");
        setIsListening(false);
    }
    Bus.emit(BUS_EVENT.CALIBRATION_DONE);
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
    const expected = ['Ding', '1', '2', '3', '4', '5', '6', '7', '8'];
    let adjustments = [];
    const ctx = activeGrid;

    expected.forEach((note, i) => {
        // Note i is expected in measure i+1
        const measureStart = (i + 1) * 8;
        const measureEnd = measureStart + 7;

        let targetCount = 0;
        let otherLabels = new Set();

        // Scan the entire measure range
        for (let s = measureStart; s <= measureEnd; s++) {
            const recorded = ctx.innerLabels[s];
            const labArr = Array.isArray(recorded) ? recorded : (recorded ? [recorded] : []);

            labArr.forEach(label => {
                if (label === note) {
                    targetCount++;
                } else {
                    otherLabels.add(label);
                }
            });
        }

        const hasExpected = targetCount > 0;
        const hasOthers = otherLabels.size > 0;

        if (!hasExpected) {
            // MISS: Sensitivity Increased (Lower multiplier makes threshold easier to hit)
            if (!noteMultipliers[note]) noteMultipliers[note] = 0.5;
            noteMultipliers[note] = Math.max(0.05, noteMultipliers[note] - 0.1);
            adjustments.push(`${note}: Missed (Sensitivity Increased)`);
        } else if (targetCount > 1) {
            // DOUBLE: Double-Trigger Fixed (Higher multiplier makes threshold harder to hit)
            if (!noteMultipliers[note]) noteMultipliers[note] = 0.5;
            noteMultipliers[note] = Math.min(0.95, noteMultipliers[note] + 0.1);
            adjustments.push(`${note}: Double-Trigger Fixed`);
        }

        if (hasOthers) {
            otherLabels.forEach(intruder => {
                // NOISE FIX: Make the intruder less sensitive
                if (!noteMultipliers[intruder]) noteMultipliers[intruder] = 0.5;
                noteMultipliers[intruder] = Math.min(0.95, noteMultipliers[intruder] + 0.1);
                adjustments.push(`${note}: Unclear (Fixed ${intruder} noise)`);
            });
        }
    });

    const isPerfect = adjustments.length === 0;
    const summary = isPerfect ? "Perfect recording! No changes needed." : adjustments.join('\n');
    alert("Sensitivity Calibration Results:\n\n" + summary);

    localStorage.setItem('gp_multipliers', JSON.stringify(noteMultipliers));
    return isPerfect;
}

// Module-level Clarity Threshold (User Configurable)
// default 0.5. Higher = Harder to trigger Note (Easier to trigger Accent)
// Lower = Easier to trigger Note (Harder to trigger Accent)
let userClarityThreshold = parseFloat(localStorage.getItem('gp_clarity_threshold') || '0.5');

export function setClarityThreshold(val) {
    userClarityThreshold = val;
    localStorage.setItem('gp_clarity_threshold', val);
    console.log("Clarity Threshold set to:", val);
}

export function getClarityThreshold() {
    return userClarityThreshold;
}

// --- 4. Logic Fix: findClosestScaleNote returns label ---
function findClosestScaleNote(freq) {
    const currentScale = getScale();
    if (!currentScale) return null;

    // Use a tighter tolerance if we have a calibrated frequency (3% instead of 5-8%)
    const hasCal = hasCalibrationForCurrentScale();
    const standardNoteTolerance = standardNoteToleranceValue || 0.05; // 5%
    const dingTolerance = dingToleranceValue || 0.08; // 8%

    let targets = [];

    // Check Ding
    let dFreq = currentCalibratedFreqs['Ding'];
    if (typeof dFreq !== 'number') dFreq = NOTE_FREQS[currentScale.ding];
    if (dFreq) {
        targets.push({ label: 'Ding', freq: dFreq, tolerance: hasCal ? 0.03 : dingTolerance });
    }

    // Check Numbers
    for (let [label, noteName] of Object.entries(currentScale.map)) {
        let targetFreq = currentCalibratedFreqs[label];
        if (typeof targetFreq !== 'number') targetFreq = NOTE_FREQS[noteName];
        if (targetFreq) {
            targets.push({ label, freq: targetFreq, tolerance: hasCal ? 0.03 : standardNoteTolerance });
        }
    }

    let closest = null;
    let minDiff = Infinity;

    targets.forEach(t => {
        const diff = Math.abs(t.freq - freq);
        if (diff < minDiff && diff < (t.freq * t.tolerance)) {
            minDiff = diff;
            closest = t.label;
        }
    });

    return closest;
}

// Internal defaults for findClosestScaleNote
const dingToleranceValue = 0.08;
const standardNoteToleranceValue = 0.05;

// Listen for sensitivity changes from UI
Bus.on(BUS_EVENT.SET_ACCENT_SENSITIVITY, (e) => {
    if (e.detail && typeof e.detail.threshold === 'number') {
        setClarityThreshold(e.detail.threshold);
    }
});

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
    // return sampleRate / T0;

    // Calculate Clarity (Normalized Correlation Coefficient)
    // c[0] is the total energy (autocorrelation at lag 0)
    // clarity = c[T0] / c[0]
    let clarity = (c[0] > 0) ? (maxval / c[0]) : 0;

    return {
        freq: sampleRate / T0,
        clarity: clarity,
        rms: Math.sqrt(rms / SIZE)
    };
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

    // Smooth Color Interpolation (Red -> Green)
    // We strike every 8 steps (4 beats in 4/4)
    const audioCtx = getAudioCtx();
    const cycleDur = (60000 / activeGrid.bpm) * 4;
    const now = audioCtx.currentTime * 1000;
    const startTime = activeGrid.audioStartTime || 0;
    const elapsed = now - startTime;

    // Phase 0->1 over a 4-beat measure (8 steps)
    let phase = 0;

    if (elapsed < 0) {
        phase = 0;
    } else {
        // Linear phase from 0 to 1 over the 8 beats
        phase = (elapsed % cycleDur) / cycleDur;
    }

    const isStrikeStep = (currentIndex % 8 === 0) && (currentIndex >= 8);

    // Use phase for STRIKE TIMING bar
    // Force 100% on strike steps so it looks full exactly on the hit
    const barWidth = isStrikeStep ? 100 : (phase * 100);
    guideProgress.style.width = barWidth + "%";

    // Bar gradient color (only on bar)
    const hue = Math.floor(phase * 120);
    // Use green (120) on strike
    guideProgress.style.background = isStrikeStep ? `hsl(120, 70%, 50%)` : `hsl(${hue}, 70%, 50%)`;

    if (currentIndex === lastGuidedIndex) return;
    lastGuidedIndex = currentIndex;

    const expected = ['Ding', '1', '2', '3', '4', '5', '6', '7', '8'];
    // 8 steps per cycle (4 beats)
    const cycleIndex = Math.floor(currentIndex / 8);

    // Check for completion
    if (cycleIndex > expected.length) {
        finishGuidedCalibration();
        return;
    }

    if (cycleIndex <= expected.length) {

        // Show the note we are about to strike (or are striking)
        const displayNoteIndex = isStrikeStep ? cycleIndex - 1 : cycleIndex;
        const targetNote = expected[displayNoteIndex];

        if (targetNote && guideNoteBox.textContent !== targetNote) {
            guideNoteBox.textContent = targetNote;
        }

        // Visual strike feedback
        if (isStrikeStep) {
            guideNoteBox.classList.remove('pulse');
            guideNoteBox.classList.add('strike'); // Green background from CSS
            void guideNoteBox.offsetWidth; // Trigger reflow
            guideNoteBox.classList.add('pulse');

            // Revert green after pulse
            setTimeout(() => {
                guideNoteBox.classList.remove('strike');
            }, 300);
        }
    }
}

function finishGuidedCalibration() {
    isGuidedCalibrating = false;
    if (activeGrid.playing) stop(activeGrid);

    // Show results and check if perfect
    const isPerfect = analyzeGuidedResults();

    if (!isPerfect) {
        const goAgain = confirm("Automatic adjustments have been applied to improve your calibration.\n\nWould you like to run the test again to verify the fixes?");
        if (goAgain) {
            // Restart guided calibration
            resetGuideUI();
            const startBtn = document.getElementById('startGuidedBtn');
            if (startBtn) startBtn.click();
            return;
        }
    }

    // If perfect or user declines restart, close modal
    const modal = document.getElementById('guidedCalModal');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', true);
    }

    isFullCalWizard = false;
    resetGuideUI();

    if (lastActiveElement) lastActiveElement.focus();
}

function resetGuideUI() {
    guideNoteBox.textContent = "Ding";
    guideNoteBox.classList.remove('pulse', 'strike');
    guideProgress.style.width = "0%";
    guideProgress.style.background = 'hsl(0, 70%, 50%)';
    const startBtn = document.getElementById('startGuidedBtn');
    if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = "Begin";
    }
}

function startCountdown(callback) {
    const overlay = document.getElementById('countdownOverlay');
    const number = document.getElementById('countdownNumber');
    if (!overlay || !number) return callback();

    overlay.style.display = 'flex';
    let count = 4;

    const playTick = () => {
        const audioCtx = getAudioCtx();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(count === 1 ? 880 : 440, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    };

    const nextCount = () => {
        if (count > 0) {
            number.textContent = count;

            // Trigger animation restrike
            number.style.animation = 'none';
            void number.offsetWidth; // Force reflow
            number.style.animation = null;

            playTick();
            count--;
            // Sync with BPM demo (40 BPM = 1500ms per beat)
            const interval = (60000 / activeGrid.bpm);
            setTimeout(nextCount, interval);
        } else {
            overlay.style.display = 'none';
            callback();
        }
    };
    nextCount();
}

export function initTranscription() {
    const ctx = activeGrid;

    micBtn = document.getElementById('micBtn');
    micCalBtn = document.getElementById('micCalBtn');
    guidedCalBtn = document.getElementById('guidedCalBtn');
    targetNoteDisplay = document.getElementById('targetNoteName');
    micCalOverlay = document.getElementById('calibrationStatus');
    sensValDisplay = document.getElementById('sensVal');
    meter = document.getElementById('micVisualizer');
    calProgressCircle = document.getElementById('calProgressCircle');

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

    micCalBtn?.addEventListener('click', async (e) => {
        if (e) e.stopPropagation();

        // 1. Auto-enable microphone if not listening
        if (!isListening) {
            const originalText = micCalBtn.textContent;
            micCalBtn.textContent = "Initializing Microphone...";
            micCalBtn.disabled = true;
            try {
                await toggleListening();
            } finally {
                micCalBtn.textContent = originalText;
                micCalBtn.disabled = false;
            }
        }

        // 2. Start calibration if listening (might have failed above)
        if (isListening) {
            isCalibrating = true;
            calIndex = 0;
            micCalOverlay.style.display = 'block';
            targetNoteDisplay.textContent = calQueue[0];
        } else {
            alert("Please enable microphone access to calibrate.");
        }
    });

    guidedCalBtn?.addEventListener('click', (e) => {
        if (e) e.stopPropagation();
        if (!isListening) toggleListening();

        // Clear the grid (Direct state update)
        ctx.innerLabels = Array(ctx.innerLabels.length).fill('');
        ctx.innerHands = Array(ctx.innerHands.length).fill(null);
        renderAllMeasures(ctx);

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

    const fullCalBtn = document.getElementById('fullCalBtn');
    fullCalBtn?.addEventListener('click', (e) => {
        if (e) e.stopPropagation();
        isFullCalWizard = true;
        // Start Step 1
        micCalBtn?.click();
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
        startGuidedBtnLocal.disabled = true;
        startGuidedBtnLocal.textContent = "Get Ready...";

        startCountdown(() => {
            isGuidedCalibrating = true;
            startGuidedBtnLocal.textContent = "Calibrating...";

            const ctx = activeGrid;
            ctx.innerLabels = Array(ctx.innerLabels.length).fill('');
            ctx.innerHands = Array(ctx.innerHands.length).fill(null);
            renderAllMeasures(ctx);
            lastGuidedIndex = -1;

            // start(ctx, isSync, skipCountdown)
            // Skip the internal countdown since we just did one!
            start(ctx, true, true);
        });
    });
}