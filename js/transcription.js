import { unlockAudio, getAudioCtx, addTickObserver, stop, start } from './noteplayer.js';
import { activeGrid } from './grid-context.js';
import { cells, setInnerLabel, renderAllMeasures } from './notegrid.js';
import { loadPatternByName } from './controls.js';
import { isListening, setIsListening, getScale, getCurrentScaleId, currentUser, setIsCalibrationMode } from './state.js';
import { isCoaching, evaluateDetectedNote, logCoachingEvent, gridLabels } from './coaching-mode.js';
import { Bus, BUS_EVENT } from './bus.js';
import { supabase } from './supabase-client.js';
import { alert, confirm } from './alert.js';

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
let latestStableBackgroundNote = null; // Tracks the *true* background note currently ringing
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
let noteBlossomTimes = JSON.parse(localStorage.getItem('gp_blossom_times')) || {};
let calBlossomStartTime = 0;

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


export async function turnOnMic() {
    if (isListening) return;

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
        await alert("Microphone access denied or audio device error.\nPlease check your settings.");
    }
}

export async function turnOffMic() {
    if (!isListening) return;

    setIsListening(false);
    micBtn.textContent = "🎤";
    micBtn.classList.remove('active');
    document.getElementById('cwAutoRecord')?.classList.remove('active');
    meter.style.display = 'none';
    if (micStream) micStream.getTracks().forEach(t => t.stop());
}

async function toggleListening() {
    if (isListening) turnOffMic();
    else turnOnMic();
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
    // Fallback to local transcriptionIndex (from observer) if activeGrid property is missing
    if (typeof activeGrid.transcriptionIndex === 'number') {
        currentIndex = activeGrid.transcriptionIndex;
        transcriptionIndex = currentIndex; // Sync local global variable
    } else {
        currentIndex = transcriptionIndex;
    }

    // DEBUG: Heartbeat to ensure loop is alive and see state
    if (Math.random() < 0.05) {
        console.log(`[Transcription Heartbeat] Listening: ${isListening}, Index: ${currentIndex}, RMS: ${rms.toFixed(4)}, Floor: ${roomNoiseFloor.toFixed(4)}, Pitch: ${pitch}`);
    }

    // Update Guided Calibration display
    if (isGuidedCalibrating) {
        updateGuidedUI(currentIndex);
    }

    // Visual Meter
    const micLevel = document.getElementById('micLevel');
    if (micLevel) micLevel.style.width = Math.min(100, rms * 500) + "%";

    const MAX_PENDING_ACCENT_WINDOW = 200; // Hard limit to commit accent

    // --- COMMIT PENDING ACCENTS ---
    if (pendingAccent) {
        const timeSinceStart = now - pendingAccent.startTime;
        const timeSinceFirstDetection = now - pendingAccent.firstDetectionTime; // We need to track total time

        // "SNOOZE" LOGIC:
        // If we see a POTENTIAL note (good pitch but maybe low clarity), 
        // we extend the window to give it a chance to stabilize.
        // Pitch must be valid (> 0) and RMS decent (> baseSensitivity).
        // This prevents the accent from committing while the note is "blooming".
        const potentialNote = (pitch > 50 && rms > baseSensitivity);

        if (potentialNote && timeSinceFirstDetection < MAX_PENDING_ACCENT_WINDOW) {
            // Bump the start time to delay commit, but don't exceed MAX window
            pendingAccent.startTime = now;
            // console.log(`[Transcription] Snoozing Accent Commit (Potential Note Detected: ${pitch.toFixed(1)}Hz)`);
        }

        // Commit if window passed OR (Crucial) if we exceeded the hard limit
        if ((now - pendingAccent.startTime > PENDING_ACCENT_WINDOW) || (timeSinceFirstDetection > MAX_PENDING_ACCENT_WINDOW)) {

            console.log(`[Transcription] Committing Buffered Accent: Step ${pendingAccent.step} (Waited: ${timeSinceFirstDetection.toFixed(0)}ms)`);
            const commitTimestamp = pendingAccent.timestamp;
            const commitStep = pendingAccent.step;
            pendingAccent = null;

            if (isCoaching()) {
                evaluateDetectedNote('ACCENT', commitStep, commitTimestamp);
            } else {
                recordNoteToGrid('S', commitStep, activeGrid);
            }

            Bus.emit(BUS_EVENT.ACCENT_DETECTED, { step: commitStep, time: commitTimestamp });
            lastNoteTime = now;

            // CRITICAL FIX: We do NOT set stepWasRecorded = true here.
            // If we did, and the accent committed, it would permanently close the 
            // window for any legitimate notes trying to blossom in this very same timeframe.
            // stepWasRecorded = true; 

            lastDetectedType = 'ACCENT';
            tally['ACCENT'] = 0; // FIX: Only clear the accent tally, do not wipe out blooming notes.
        }
    }

    // Adaptive Noise Floor
    if (rms < baseSensitivity * 0.5 || pitch === -1) {
        roomNoiseFloor = (roomNoiseFloor * 0.95) + (rms * 0.05);
    }

    // Step Boundary Detection
    if (currentIndex !== lastFrameTranscriptionIndex) {
        logCoachingEvent(`--- Step Boundary: ${lastFrameTranscriptionIndex} -> ${currentIndex} ---`, currentIndex);

        const notesInCurrentStep = activeGrid.innerLabels[currentIndex];
        logCoachingEvent(`Expected Notes: ${notesInCurrentStep}`, currentIndex);

        tally = {};
        stepWasRecorded = false;
        lastDetectedType = null;
        lastFrameTranscriptionIndex = currentIndex;
    }

    if (isCalibrating) {
        handleCalibration(pitch, rms, clarity, nowAudioMs);
    } else if (activeGrid.playing) {
        // Debug every potential hit (loud enough)
        if (rms > roomNoiseFloor) {
            console.log(`[Check] Pitch: ${pitch}, RMS: ${rms}, Floor: ${roomNoiseFloor}, StepRecorded: ${stepWasRecorded}`);
        }

        // In Coaching Mode, if we have a PENDING ACCENT, we are in "Refinement Mode"
        // This is much more reliable than stepWasRecorded/lastDetectedType checks.
        const canRefine = (pendingAccent !== null);

        if ((!stepWasRecorded || canRefine) && rms > roomNoiseFloor) {

            // 0. Pre-calculate Clarity info
            const detectedNoteLabel = findClosestScaleNote(pitch);
            let CLARITY_THRESHOLD = userClarityThreshold;

            // SMART CALIBRATION: Use dynamic thresholds
            if (isGuidedCalibrating) {
                // During calibration learning, be permissive (0.4) to capture even low-clarity notes
                // so we can measure their true average clarity.
                CLARITY_THRESHOLD = 0.4;
            } else {
                // Normal Play: Use learned profile
                CLARITY_THRESHOLD = getNoteClarityThreshold(detectedNoteLabel);
            }

            // DYNAMIC CLARITY ADJUSTMENT based on calibration
            // If we have calibrated 'Tak' or 'Slap' clarity, we use it to nudge the threshold.
            // This prevents "dirty" notes (like Dings) from being seen as accents if they are clearer than actual accents.
            const getClarityAvg = (label) => {
                const val = noteClarityAverages[label];
                if (Array.isArray(val) && val.length > 0) {
                    return val.reduce((a, b) => a + b, 0) / val.length;
                }
                return typeof val === 'number' ? val : 0.4;
            };

            const takClarity = getClarityAvg('Tak');
            const slapClarity = getClarityAvg('Slap');
            const baselineAccentClarity = Math.max(takClarity, slapClarity);

            // Get Ding Frequency for dynamic protection
            const currentScale = getScale();

            // LOGIC SPLIT:
            // 1. Guided Calibration: Force low threshold (already set to 0.4 above, preserve it).
            // 2. Smart Profile: If we have data, use it (already set via getNoteClarityThreshold above).
            // 3. Heuristic Fallback: If no data, use "Ding Protection" logic.

            const hasSpecificProfile = (typeof noteClarityAverages[detectedNoteLabel] === 'number');

            if (!isGuidedCalibrating && !hasSpecificProfile && detectedNoteLabel) {
                // Fallback to Heuristic Protection only if we don't have better data
                const dingFreq = (currentScale && NOTE_FREQS[currentScale.ding]) ? NOTE_FREQS[currentScale.ding] : 0;
                const dingProtectionLimit = dingFreq ? (dingFreq + 40) : 150;

                // If it's a Ding, be extra lenient, but still watch the accent baseline
                if (detectedNoteLabel === 'Ding' || pitch < dingProtectionLimit) {
                    CLARITY_THRESHOLD = Math.max(baselineAccentClarity + 0.05, userClarityThreshold - 0.1);
                    // console.log(`[Transcription] Ding detected (Heuristic), adjusting clarity threshold to: ${CLARITY_THRESHOLD.toFixed(2)}`);
                } else {
                    // Regular notes should be significantly clearer than a Tak/Slap
                    CLARITY_THRESHOLD = Math.max(baselineAccentClarity + 0.1, userClarityThreshold);
                    // console.log(`[Transcription] Regular note detected (Heuristic), adjusting clarity threshold to: ${CLARITY_THRESHOLD.toFixed(2)}`);
                }
            } else if (!isGuidedCalibrating && hasSpecificProfile) {
                // Ensure we use the profile (already set, but let's confirm precedence against baseline?)
                // Generally we trust the profile more than baselineAccentClarity, presuming calibration captured the "real" instrument.
                // So we do nothing, letting CLARITY_THRESHOLD remain what getNoteClarityThreshold returned.
            }

            const isClearNote = detectedNoteLabel && clarity > CLARITY_THRESHOLD;

            // Track background stability (even if gate is closed) to know what was ringing BEFORE a strike
            if (isClearNote) {
                latestStableBackgroundNote = detectedNoteLabel;
            }

            // 1. Check for NOTES first (Priority)
            if (isClearNote) {
                // If it's a clear note, we trust it over any accent/strike logic
                // We let the standard pitch detection logic below handle it
            }

            // 2. Check for ACCENTS (Secondary)
            // Use calibrated multipliers if available (S, Tak, Slap). Default is 0.5 (Base Sensitivity)
            // If multiplier > 0.5 (e.g. 0.6), we make it HARDER to trigger (1.2x threshold).
            const accentMult = noteMultipliers['S'] || noteMultipliers['Tak'] || noteMultipliers['Slap'] || 0.5;
            const sensitivityFactor = accentMult / 0.5;

            const flux = rms / prevRMS;
            const isStrike = flux > 1.3 || rms > (baseSensitivity * 2 * sensitivityFactor);
            const MIN_ACCENT_RMS = 0.02 * sensitivityFactor;

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
                                startTime: now,
                                firstDetectionTime: now, // Track absolute start for hard limit
                                backgroundNote: latestStableBackgroundNote,
                                preStrikeRMS: prevRMS
                            };
                        }
                    }
                }
            } else {
                // Regular Note Logic

                // Pitch-based detection for regular notes
                const detected = findClosestScaleNote(pitch); // Returns label string directly

                if (detected) {
                    logCoachingEvent(`NOTE Candidate: ${detected}, Pitch ${pitch.toFixed(1)}, Clarity ${clarity.toFixed(3)} (Thresh ${CLARITY_THRESHOLD.toFixed(2)}), RMS ${rms.toFixed(4)}`, transcriptionIndex);

                    // Use the note-specific multiplier from Guided Calibration
                    const multiplier = noteMultipliers[detected] || 0.5;

                    // Calculate specific threshold
                    let sens = noteSensitivities[detected];
                    if (Array.isArray(sens)) {
                        // If it's still an array from active calibration, use the latest sample or average
                        sens = sens.length > 0 ? (sens.reduce((a, b) => a + b, 0) / sens.length) : baseSensitivity;
                    }
                    let noteSpecificThreshold = (sens || baseSensitivity) * multiplier;

                    const isPassRMS = rms > noteSpecificThreshold;
                    const isPassGate = (isGateOpen || isNewStrike || canRefine);

                    if (!isPassGate || !isPassRMS) {
                        // Log why it was rejected early if needed, but maybe too noisy?
                        // Let's log if it's loud enough but gate is closed.
                        if (isPassRMS && !isPassGate) {
                            const gateRemaining = Math.max(0, dynamicGate - (now - lastNoteTime));
                            logCoachingEvent(`NOTE Rejected: Gate Closed (Remaining: ${gateRemaining.toFixed(0)}ms, Flux: ${flux.toFixed(2)})`, transcriptionIndex);
                        } else if (!isPassRMS && rms > (baseSensitivity * 0.5)) {
                            // Log the silent drop due to note-specific threshold
                            logCoachingEvent(`NOTE Rejected: RMS Too Low (${rms.toFixed(4)} < Thresh ${noteSpecificThreshold.toFixed(4)})`, transcriptionIndex);
                        }
                    }

                    if (isPassGate && isPassRMS) {
                        console.log(`[Check] Note: ${detected}, Flux: ${flux.toFixed(2)}, NewStrike: ${isNewStrike}, Gate: ${isGateOpen}, RMS: ${rms.toFixed(4)}`);

                        // SUSTAIN FIX: If we are detecting the SAME note as before,
                        // we MUST have a confirmed new strike (higher flux) to record it.
                        // REFINEMENT EXCEPTION: If we are refining an accent, we bypass this block
                        // BUT ONLY if the refinement is fast (< 65ms). True consecutive notes resolve
                        // their pitch quickly. If it takes > 65ms for the pitch to appear, it's just 
                        // the previous note bleeding through after a percussive slap decays.
                        let isSustainBlocked = false;
                        let bypassSustainBlock = false;

                        if (canRefine) {
                            const timeSinceStrike = now - pendingAccent.firstDetectionTime;

                            const maxBlossomTime = (noteBlossomTimes[detected] && typeof noteBlossomTimes[detected] === 'number')
                                ? noteBlossomTimes[detected] + 20 // Buffer
                                : 65; // Default fallback

                            const isBackgroundBleed = (detected === pendingAccent.backgroundNote);

                            if (isBackgroundBleed) {
                                // If the candidate is exactly what was already ringing in the background, 
                                // it MUST have received new tonal energy from the strike to be considered a new strike.
                                if (timeSinceStrike <= maxBlossomTime) {
                                    if (rms > pendingAccent.preStrikeRMS * 1.25) {
                                        bypassSustainBlock = true;
                                    } else {
                                        logCoachingEvent(`[Transcription] Refinement Rejected (Late bleed. Tonal energy ${rms.toFixed(4)} <= pre-strike background ${pendingAccent.preStrikeRMS.toFixed(4)} * 1.25)`, transcriptionIndex);
                                        isSustainBlocked = true;
                                    }
                                } else {
                                    logCoachingEvent(`[Transcription] Refinement Rejected (Late bleed: ${timeSinceStrike}ms vs ${maxBlossomTime}ms allowed)`, transcriptionIndex);
                                    isSustainBlocked = true;
                                }
                            } else {
                                // It's a genuinely different note than what was ringing! Pass.
                                bypassSustainBlock = true;
                            }
                        }

                        // Also apply standard sustain block logic (outside of refinement) if it's the same note
                        if (detected === lastGlobalDetectedNote && !bypassSustainBlock) {
                            if (flux < 1.35) {
                                logCoachingEvent(`NOTE Rejected: Sustain Blocked (Flux ${flux.toFixed(2)} < 1.35)`, transcriptionIndex);
                                isSustainBlocked = true;
                            } else {
                                logCoachingEvent(`NOTE Passed: Sustain Allowed (Flux ${flux.toFixed(2)} > 1.35)`, transcriptionIndex);
                            }
                        }

                        if (!isSustainBlocked) {
                            tally[detected] = (tally[detected] || 0) + 1;

                            // DYNAMIC CONFIDENCE: Strong new attacks only need 1 frame of high clarity.
                            // Sustaining notes need 2 frames to prevent ghost harmonics from registering as hits.
                            // CRUENCIAL FIX: If we are actively refining an Accent, we *know* there was a high-flux strike, 
                            // even if the flux has dropped by the time the note's pitch blossoms.
                            const effectiveIsNewStrike = isNewStrike || (canRefine && bypassSustainBlock);
                            const requiredConfidence = effectiveIsNewStrike ? 1 : CONFIDENCE_THRESHOLD;

                            if (tally[detected] >= requiredConfidence) {
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

                                // Collect Clarity Data for Smart Calibration (Phase 2)
                                if (isGuidedCalibrating) {
                                    if (!Array.isArray(noteClarityAverages[detected])) noteClarityAverages[detected] = [];
                                    noteClarityAverages[detected].push(clarity);
                                }

                                Bus.emit(BUS_EVENT.NOTE_DETECTED, { label: detected, step: hitStep, time: hitTime });
                                lastNoteTime = now;
                                stepWasRecorded = true;
                                lastDetectedType = detected;
                                tally[detected] = 0; // FIX: Only clear this note's tally.

                                // Auto-finish Guided Calibration
                                if (isGuidedCalibrating && detected === '8' && currentIndex >= 16) {
                                    setTimeout(finishGuidedCalibration, 1000);
                                }
                            }
                        }
                    }
                } else {
                    // Log the unrecognized pitch so we can see what it actually was
                    const isPassRMS = rms > (baseSensitivity * 0.5); // At least loud enough to care
                    const dynamicGate = getDynamicGate();
                    const isGateOpen = (now - lastNoteTime > dynamicGate);
                    const isNewStrike = flux > 1.35;
                    const canRefine = (pendingAccent !== null);
                    const isPassGate = (isGateOpen || isNewStrike || canRefine);

                    if (isPassRMS && isPassGate && pitch > 50 && pitch < 1200) {
                        logCoachingEvent(`NOTE Rejected: Unrecognized Pitch ${pitch.toFixed(1)}Hz (Clarity ${clarity.toFixed(3)}, RMS ${rms.toFixed(4)})`, transcriptionIndex);
                    }
                }
            }
        }
    }
    prevRMS = rms;
    requestAnimationFrame(transcriptionLoop);
}

// Calibration Logic
function handleCalibration(pitch, rms, clarity, nowStr) {
    if (!isCalibrating) return;

    console.log("Calibrating...")

    const target = calQueue[calIndex];
    const isAccentCal = (target === 'Tak' || target === 'Slap');
    let isHit = false;

    const flux = rms / prevRMS;

    // Track Blossom Start Time
    if (rms > baseSensitivity * 1.5 && flux > 1.35) {
        calBlossomStartTime = nowStr;
    }

    if (isAccentCal) {
        // For accents, we look for a sharp strike (rms > floor) 
        // with low clarity (as expected for percussive hits)
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
        if (Array.isArray(noteClarityAverages[target])) {
            noteClarityAverages[target].push(clarity);
        } else {
            noteClarityAverages[target] = [clarity];
        }

        // Personalized Pitch Calibration (Notes only)
        if (!isAccentCal && pitch && pitch > 50 && pitch < 1200) {
            if (!currentCalibratedFreqs[target]) currentCalibratedFreqs[target] = [];
            if (Array.isArray(currentCalibratedFreqs[target])) {
                currentCalibratedFreqs[target].push(pitch);
            } else {
                currentCalibratedFreqs[target] = [pitch];
            }
        }

        // Track Blossom Time (Notes only)
        if (!isAccentCal && calBlossomStartTime > 0) {
            const blossomTime = nowStr - calBlossomStartTime;
            if (blossomTime >= 0 && blossomTime < 300) { // Sanity check
                if (!noteBlossomTimes[target]) noteBlossomTimes[target] = [];
                if (Array.isArray(noteBlossomTimes[target])) {
                    noteBlossomTimes[target].push(blossomTime);
                } else {
                    noteBlossomTimes[target] = [blossomTime];
                }
            }
            calBlossomStartTime = 0; // Reset
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
                // Average Blossom Time
                if (noteBlossomTimes[target] && Array.isArray(noteBlossomTimes[target]) && noteBlossomTimes[target].length > 0) {
                    const avgBlossom = noteBlossomTimes[target].reduce((a, b) => a + b, 0) / noteBlossomTimes[target].length;
                    noteBlossomTimes[target] = Math.max(20, Math.round(avgBlossom)); // At least 20ms
                    localStorage.setItem('gp_blossom_times', JSON.stringify(noteBlossomTimes));
                }

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

async function finishCalibration() {
    isCalibrating = false;
    micCalOverlay.style.display = 'none';

    Bus.emit(BUS_EVENT.CALIBRATION_DONE);

    setTimeout(async () => {
        if (isFullCalWizard) {
            // Confirmation for Phase 2
            const response = await confirm("1. Pitch Calibration Complete!\n\nReady to start Phase 2: Sensitivity Calibration?\n\nThis will load a rhythmic pattern for you to play along with.");
            if (response) {
                // Trigger Guided (Sensitivity) Calibration
                guidedCalBtn?.click();
            } else {
                isFullCalWizard = false;
                turnOffMic();
                await alert("Full Calibration cancelled.");
            }
        } else {
            await alert("Pitch Calibration Complete!");
            turnOffMic();
        }
    }, 100);
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
            if (hasOthers) {
                // Sound was heard, just wrong label. Don't increase sensitivity.
                adjustments.push(`${note}: Misclassified (Found ${Array.from(otherLabels).join(', ')})`);
            } else {
                // Sound was not heard at all. Sensitivity Increased (Lower multiplier makes threshold easier to hit)
                if (!noteMultipliers[note]) noteMultipliers[note] = 0.5;
                noteMultipliers[note] = Math.max(0.05, noteMultipliers[note] - 0.1);
                adjustments.push(`${note}: Missed (Sensitivity Increased)`);
            }
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

    // Create structured results for review mode
    const detailedResults = expected.map((note, i) => {
        const measureStart = (i + 1) * 8;
        const measureEnd = measureStart + 7;
        let foundLabel = null;
        let status = 'Correct';

        // Find what was actually recorded in this measure
        for (let s = measureStart; s <= measureEnd; s++) {
            const recorded = ctx.innerLabels[s];
            if (recorded) {
                foundLabel = recorded;
                break;
            }
        }

        if (foundLabel === note) {
            status = 'Correct';
        } else if (!foundLabel) {
            status = 'Missed';
        } else {
            status = 'Misclassified';
        }

        // Check for double triggers
        let count = 0;
        for (let s = measureStart; s <= measureEnd; s++) {
            if (ctx.innerLabels[s] === note) count++;
        }
        if (count > 1) status = 'Double-Trigger';

        // Add Average Clarity info to result
        let avgClarity = null;
        if (noteClarityAverages[note] && Array.isArray(noteClarityAverages[note])) {
            const vals = noteClarityAverages[note];
            avgClarity = vals.reduce((a, b) => a + b, 0) / vals.length;
        }

        return { note, step: measureStart, status, found: foundLabel, avgClarity };
    });

    // Compute final averages for persistent storage
    // We only update keys that were actually calibrated in this session (found as arrays)
    Object.keys(noteClarityAverages).forEach(key => {
        const val = noteClarityAverages[key];
        if (Array.isArray(val) && val.length > 0) {
            noteClarityAverages[key] = val.reduce((a, b) => a + b, 0) / val.length;
        }
    });

    const isPerfect = adjustments.length === 0;
    const summary = isPerfect ? "Perfect recording! No changes needed." : adjustments.join('\n');

    localStorage.setItem('gp_multipliers', JSON.stringify(noteMultipliers));
    localStorage.setItem('gp_clarity_profiles', JSON.stringify(noteClarityAverages));

    return { isPerfect, summary, detailedResults };
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

/**
 * Challenge Feature: Apply smart correction for a specific note
 * Called when user says "I played a X but you heard an Accent/Nothing"
 */
export function applyChallengeCorrection(targetNote) {
    if (!targetNote) return { success: false, msg: "Invalid note" };

    const updates = [];
    const isAccentType = ['S', 'T', 'Tak', 'Slap'].includes(targetNote);

    if (isAccentType) {
        // CASE A: User played an Accent, but we missed it (or heard a weak note?)
        // Action: Make Accents EASIER to trigger
        ['S', 'Tak', 'Slap'].forEach(acc => {
            if (!noteMultipliers[acc]) noteMultipliers[acc] = 0.5;
            const oldMult = noteMultipliers[acc];
            // Decrease by 0.05 -> Lower threshold -> Easier to trigger
            const newMult = Math.max(0.1, oldMult - 0.05);
            noteMultipliers[acc] = newMult;
        });
        localStorage.setItem('gp_multipliers', JSON.stringify(noteMultipliers));
        updates.push(`Made Accents easier to detect (Sensitivity increased)`);

    } else {
        // CASE B: User played a Note (e.g. '4'), but we heard an Accent (or nothing)

        // 1. Relax Clarity Requirement for this specific note
        if (!noteClarityAverages[targetNote]) noteClarityAverages[targetNote] = 0.6;

        const oldAvg = noteClarityAverages[targetNote];
        let currentVal = Array.isArray(oldAvg) ? (oldAvg.reduce((a, b) => a + b, 0) / oldAvg.length) : oldAvg;

        // Reduce required clarity by 10%
        const newAvg = Math.max(0.1, currentVal * 0.9);
        noteClarityAverages[targetNote] = newAvg;
        localStorage.setItem('gp_clarity_profiles', JSON.stringify(noteClarityAverages));
        updates.push(`Reduced Clarity req for ${targetNote} (${currentVal.toFixed(2)} -> ${newAvg.toFixed(2)})`);

        // 2. Harden Accent Trigger (Make it harder to trigger Accents globally)
        // Only do this if we actually misfired an accent (which is the common case for '4').
        // We increase the multiplier -> Higher threshold -> Harder to trigger
        ['S', 'Tak', 'Slap'].forEach(acc => {
            if (!noteMultipliers[acc]) noteMultipliers[acc] = 0.5;
            const oldMult = noteMultipliers[acc];
            const newMult = Math.min(0.95, oldMult + 0.05);
            noteMultipliers[acc] = newMult;
        });
        localStorage.setItem('gp_multipliers', JSON.stringify(noteMultipliers));
        updates.push(`Increased Accent resistance (to prevent false positives)`);
    }

    console.log(`[Calibration] Challenge accepted for ${targetNote}:`, updates);
    return { success: true, msg: updates.join(', ') };
}

// --- 4. Logic Fix: findClosestScaleNote returns label ---

/**
 * Get Dynamic Clarity Threshold for a specific note.
 * Uses calibrated data if available, otherwise falls back to global setting.
 */
function getNoteClarityThreshold(noteLabel) {
    if (!noteLabel) return userClarityThreshold;

    const profile = noteClarityAverages[noteLabel];

    // If we have a calibrated average (number), use it with safety margin.
    if (typeof profile === 'number' && profile > 0) {
        // Smart Logic: Threshold should be slightly below the average clarity.
        // e.g. Avg 0.65 -> Threshold 0.55 (approx 15% margin)
        // Check "Tak" and "Slap" interference? Maybe stricter if overlapping?
        // For now, simpler is better.
        // Clamp to reasonable bounds (0.4 - 0.9)
        // RELAXED from 0.85 to 0.75 to capture "messy" valid notes (like 4)
        const smartThreshold = Math.max(0.4, Math.min(0.9, profile * 0.75));
        return smartThreshold;
    }

    return userClarityThreshold;
}

function findClosestScaleNote(freq) {
    const currentScale = getScale();
    if (!currentScale) return null;

    // Use a tighter tolerance if we have a calibrated frequency
    const hasCal = hasCalibrationForCurrentScale();
    const standardNoteTolerance = standardNoteToleranceValue || 0.05; // 5%
    const dingTolerance = dingToleranceValue || 0.08; // 8%

    let targets = [];

    // Check Ding
    let dFreq = currentCalibratedFreqs['Ding'];
    if (typeof dFreq !== 'number') dFreq = NOTE_FREQS[currentScale.ding];
    if (dFreq) {
        targets.push({ label: 'Ding', freq: dFreq, tolerance: hasCal ? 0.05 : dingTolerance });
    }

    // Check Numbers
    for (let [label, noteName] of Object.entries(currentScale.map)) {
        let targetFreq = currentCalibratedFreqs[label];
        if (typeof targetFreq !== 'number') targetFreq = NOTE_FREQS[noteName];
        if (targetFreq) {
            targets.push({ label, freq: targetFreq, tolerance: hasCal ? 0.05 : standardNoteTolerance });
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

// Listen for Challenge Corrections
Bus.on(BUS_EVENT.CHALLENGE_CORRECTION, async (e) => {
    if (e.detail && e.detail.targetNote) {
        const result = applyChallengeCorrection(e.detail.targetNote);
        if (result.success) {
            await alert(`Got it! I've adjusted my hearing for '${e.detail.targetNote}'.\n\nChanges applied:\n- ${result.msg}`);
        }
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

    // Short delay to let UI stop visibly before the alert blocks
    setTimeout(async () => {
        // Show results and check if perfect
        const { isPerfect, summary } = analyzeGuidedResults();
        await alert("Sensitivity Calibration Results:\n\n" + summary);

        if (!isPerfect) {
            // const printLogs = confirm("Print logs?");
            // if (printLogs) {
            //     logCoachingEvent(summary);
            // }
            const goAgain = await confirm("Automatic adjustments have been applied to improve your calibration.\n\nWould you like to run the test again to verify the fixes?");
            if (goAgain) {
                // Restart guided calibration
                resetGuideUI();
                const startBtn = document.getElementById('startGuidedBtn');
                if (startBtn) startBtn.click();
                return;
            }
        }

        // If perfect or user declines restart, enable review mode
        const modal = document.getElementById('guidedCalModal');
        if (modal) {
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', true);
        }

        isFullCalWizard = false;
        resetGuideUI();

        // Enable Review Mode and show Calibration HUD
        enableCalibrationReview();

        if (lastActiveElement) lastActiveElement.focus();
    }, 150);
}

function enableCalibrationReview() {
    // Import the review functions from coaching-mode
    import('./coaching-mode.js').then(({ enableReviewMode, mapCalibrationResultsToGrid }) => {
        // Map calibration results to grid for visual feedback
        const calibrationResults = analyzeGuidedResults();
        mapCalibrationResultsToGrid(calibrationResults, activeGrid);

        // Enable review mode
        enableReviewMode();

        // Show Calibration HUD
        const calibrationHUD = document.getElementById('calibrationHUD');
        if (calibrationHUD) {
            calibrationHUD.style.display = 'block';
        }
    });
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
            await alert("Please enable microphone access to calibrate.");
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
        setIsCalibrationMode(true); // Enable calibration mode immediately for logging

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

    initExitCalibrationButton();
}
// Exit Calibration Button Handler (added separately)
export function initExitCalibrationButton() {
    const exitCalibrationBtn = document.getElementById('exitCalibrationBtn');
    exitCalibrationBtn?.addEventListener('click', () => {
        // Clear calibration mode
        setIsCalibrationMode(false);

        // Hide Calibration HUD
        const calibrationHUD = document.getElementById('calibrationHUD');
        if (calibrationHUD) {
            calibrationHUD.style.display = 'none';
        }

        // Disable review mode and clear grid feedback
        import('./coaching-mode.js').then(({ disableReviewMode }) => {
        });
    });
}

// --- ADVANCED CALIBRATION LOGIC ---
const DEFAULT_MULTIPLIERS = { 'Ding': 0.85, '1': 0.5, '2': 0.5, '3': 0.5, '4': 0.5, '5': 0.5, '6': 0.5, '7': 0.5, '8': 0.5, 'Tak': 0.5, 'Slap': 0.5 };
const DEFAULT_CLARITY_V2 = { 'Ding': 0.5, '1': 0.5, '2': 0.5, '3': 0.5, '4': 0.5, '5': 0.5, '6': 0.5, '7': 0.5, '8': 0.5, 'Tak': 0.5, 'Slap': 0.5 };
const DEFAULT_VOLUMES = { 'Ding': 0.05, '1': 0.05, '2': 0.05, '3': 0.05, '4': 0.05, '5': 0.05, '6': 0.05, '7': 0.05, '8': 0.05, 'Tak': 0.05, 'Slap': 0.05 };

function openAdvancedCalibrationModal() {
    const modal = document.getElementById('advancedCalModal');
    const listContainer = document.getElementById('advancedCalList');
    if (!modal || !listContainer) return;

    // Get current scale to know which notes to show
    const scale = getScale();
    const notes = ['Ding', '1', '2', '3', '4', '5', '6', '7', '8', 'Tak', 'Slap'];

    // Build the HTML for the list
    listContainer.innerHTML = notes.map(note => {
        const isScaleNote = (note === 'Ding' || note === 'Tak' || note === 'Slap' || scale.map[note]);
        if (!isScaleNote && note !== 'Tak' && note !== 'Slap') return ''; // Skip disabled notes

        const currentMult = noteMultipliers[note] !== undefined ? noteMultipliers[note] : (DEFAULT_MULTIPLIERS[note] || 0.5);

        // Handle Clarity: Might be a raw number from new profiles or old global
        let currentClarity = typeof noteClarityAverages[note] === 'number'
            ? noteClarityAverages[note]
            : (window.userClarityThreshold !== undefined ? window.userClarityThreshold : 0.5);

        // Handle Sensitivity: Might be raw number or array
        let currentVol = noteSensitivities[note];
        if (Array.isArray(currentVol)) currentVol = currentVol.reduce((a, b) => a + b, 0) / currentVol.length;
        if (typeof currentVol !== 'number') currentVol = (note === 'Tak' || note === 'Slap' ? 0.07 : 0.05);

        // Handle Blossom Time
        const currentBlossom = (noteBlossomTimes[note] !== undefined && typeof noteBlossomTimes[note] === 'number') ? Math.max(20, noteBlossomTimes[note]) : 65;

        return `
            <div class="adv-cal-row">
                <div class="adv-cal-row-header">
                    <div class="adv-cal-note-label">
                        ${note} 
                        ${scale.map[note] || note === 'Ding' ? `<span class="adv-cal-pill">${note === 'Ding' ? scale.ding : scale.map[note]}</span>` : ''}
                    </div>
                </div>
                <div class="adv-cal-controls">
                    <div class="adv-cal-control-group">
                        <label>Sensitivity Tolerance (Multiplier) <span>0.05 - 1.0</span></label>
                        <div class="adv-cal-input-row">
                            <input type="range" class="adv-mult-input" data-note="${note}" min="0.05" max="1.0" step="0.05" value="${currentMult.toFixed(2)}">
                            <span class="adv-cal-val">${currentMult.toFixed(2)}x</span>
                        </div>
                    </div>
                    <div class="adv-cal-control-group">
                        <label>Baseline Volume (RMS) <span>0.01 - 0.20</span></label>
                        <div class="adv-cal-input-row">
                            <input type="range" class="adv-vol-input" data-note="${note}" min="0.01" max="0.20" step="0.01" value="${currentVol.toFixed(2)}">
                            <span class="adv-cal-val">${currentVol.toFixed(2)}</span>
                        </div>
                    </div>
                    <div class="adv-cal-control-group">
                        <label>Expected Clarity Threshold <span>0.1 - 0.9</span></label>
                        <div class="adv-cal-input-row">
                            <input type="range" class="adv-clarity-input" data-note="${note}" min="0.1" max="0.9" step="0.05" value="${currentClarity.toFixed(2)}">
                            <span class="adv-cal-val">${currentClarity.toFixed(2)}</span>
                        </div>
                    </div>
                    <div class="adv-cal-control-group">
                        <label>Pitch Stabilization (Blossom) <span>65ms - 200ms</span></label>
                        <div class="adv-cal-input-row">
                            <input type="range" class="adv-blossom-input" data-note="${note}" min="65" max="200" step="5" value="${currentBlossom}">
                            <span class="adv-cal-val">${currentBlossom}ms</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Attach dynamic listeners to sliders
    listContainer.querySelectorAll('input[type="range"]').forEach(input => {
        input.addEventListener('input', (e) => {
            const valDisplay = e.target.nextElementSibling;
            if (e.target.classList.contains('adv-mult-input')) {
                valDisplay.textContent = parseFloat(e.target.value).toFixed(2) + 'x';
            } else if (e.target.classList.contains('adv-blossom-input')) {
                valDisplay.textContent = parseInt(e.target.value) + 'ms';
            } else {
                valDisplay.textContent = parseFloat(e.target.value).toFixed(2);
            }
        });
    });

    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');

    // Close Mic dropdown
    const menu = document.getElementById('micDropdownMenu');
    if (menu) menu.classList.remove('show');
}

async function saveAdvancedCalibration() {
    const listContainer = document.getElementById('advancedCalList');
    if (!listContainer) return;

    // Collect all values
    const newMults = { ...noteMultipliers };
    const newClarity = { ...noteClarityAverages };
    const newVols = { ...noteSensitivities };
    const newBlossoms = { ...noteBlossomTimes };

    listContainer.querySelectorAll('.adv-cal-row').forEach(row => {
        const note = row.querySelector('.adv-mult-input').dataset.note;

        const multVal = parseFloat(row.querySelector('.adv-mult-input').value);
        const volVal = parseFloat(row.querySelector('.adv-vol-input').value);
        const clarityVal = parseFloat(row.querySelector('.adv-clarity-input').value);
        const blossomVal = parseInt(row.querySelector('.adv-blossom-input').value);

        newMults[note] = multVal;
        newVols[note] = volVal;
        newClarity[note] = clarityVal;
        newBlossoms[note] = blossomVal;
    });

    // Update in-memory
    noteMultipliers = newMults;
    noteSensitivities = newVols;
    noteClarityAverages = newClarity;
    noteBlossomTimes = newBlossoms;

    // Persist
    localStorage.setItem('gp_multipliers', JSON.stringify(noteMultipliers));
    localStorage.setItem('gp_cal', JSON.stringify(noteSensitivities));
    localStorage.setItem('gp_clarity_profiles', JSON.stringify(noteClarityAverages));
    localStorage.setItem('gp_blossom_times', JSON.stringify(noteBlossomTimes));

    await alert('Advanced Calibration Settings Saved!');
    closeAdvancedCalibrationModal();
}

async function resetAdvancedCalibration() {
    // Check if they had a perfect calibration
    const perfectCalFlag = localStorage.getItem('gp_perfect_cal');
    const hasPerfect = perfectCalFlag === 'true';

    let msg = "Are you sure you want to reset all sensitivity and clarity profiles to factory defaults?";
    if (hasPerfect) {
        msg = "You previously achieved a PERFECT auto-calibration score.\n\n[OK] to restore your PERFECT baseline.\n[Cancel] to aggressively wipe to Factory Defaults.";
    }

    if (await confirm(msg)) {
        if (hasPerfect) {
            // Restore Perfect
            const perfectMultStr = localStorage.getItem('gp_perfect_cal_mults');
            if (perfectMultStr) {
                noteMultipliers = JSON.parse(perfectMultStr);
                localStorage.setItem('gp_multipliers', perfectMultStr);
            }
            await alert("Restored to your Perfect Calibration baseline.");
        } else {
            // Factory Reset everything but Pitch
            noteMultipliers = { ...DEFAULT_MULTIPLIERS };
            noteClarityAverages = {};
            noteSensitivities = {};
            noteBlossomTimes = {};

            localStorage.setItem('gp_multipliers', JSON.stringify(noteMultipliers));
            localStorage.removeItem('gp_cal');
            localStorage.removeItem('gp_clarity_profiles');
            localStorage.removeItem('gp_blossom_times');

            await alert("Factory Defaults Restored.");
        }

        // Re-populate modal to show new values
        openAdvancedCalibrationModal();
    } else {
        if (hasPerfect && await confirm("Force wipe everything to Factory Defaults instead?")) {
            noteMultipliers = { ...DEFAULT_MULTIPLIERS };
            noteClarityAverages = {};
            noteSensitivities = {};
            noteBlossomTimes = {};

            localStorage.setItem('gp_multipliers', JSON.stringify(noteMultipliers));
            localStorage.removeItem('gp_cal');
            localStorage.removeItem('gp_clarity_profiles');
            localStorage.removeItem('gp_blossom_times');
            localStorage.removeItem('gp_perfect_cal');
            localStorage.removeItem('gp_perfect_cal_mults');

            await alert("Factory Defaults Restored. Perfect calibration flag cleared.");
            openAdvancedCalibrationModal();
        }
    }
}

function closeAdvancedCalibrationModal() {
    const modal = document.getElementById('advancedCalModal');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
}

// Attach listeners inside initialization
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('advancedCalBtn')?.addEventListener('click', openAdvancedCalibrationModal);
    document.getElementById('closeAdvancedCalBtn')?.addEventListener('click', closeAdvancedCalibrationModal);
    document.getElementById('cancelAdvancedCalBtn')?.addEventListener('click', closeAdvancedCalibrationModal);
    document.getElementById('saveAdvancedCalBtn')?.addEventListener('click', saveAdvancedCalibration);
    document.getElementById('resetAdvancedCalBtn')?.addEventListener('click', resetAdvancedCalibration);
});

