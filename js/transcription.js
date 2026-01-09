let micStream = null;
let audioAnalyser = null;
let isListening = false;
const BUFSIZE = 2048;
const buf = new Float32Array(BUFSIZE);

// Note frequencies (C0 to B8)
const NOTE_FREQS = {
    "D3": 146.83, "Eb3": 155.56, "E3": 164.81, "F3": 174.61, "Fs3": 185.00, "G3": 196.00, "Gs3": 207.65, "A3": 220.00, "Bb3": 233.08, "B3": 246.94,
    "C4": 261.63, "Cs4": 277.18, "D4": 293.66, "Eb4": 311.13, "E4": 329.63, "F4": 349.23, "Fs4": 369.99, "G4": 392.00, "Gs4": 415.30, "A4": 440.00, "Bb4": 466.16, "B4": 493.88,
    "C5": 523.25 // Add more as needed based on your scales
};

async function toggleListening() {
    const btn = document.getElementById('micBtn');
    const meter = document.getElementById('micVisualizer');

    if (isListening) {
        isListening = false;
        btn.textContent = "🎤 Listen Mode: Off";
        btn.classList.remove('active');
        meter.style.display = 'none';
        if (micStream) micStream.getTracks().forEach(t => t.stop());
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream = stream;
        ensureAudio(); // From noteplayer.js
        
        const source = audioCtx.createMediaStreamSource(stream);
        audioAnalyser = audioCtx.createAnalyser();
        audioAnalyser.fftSize = BUFSIZE;
        source.connect(audioAnalyser);

        isListening = true;
        btn.textContent = "🎤 Listening...";
        btn.classList.add('active');
        meter.style.display = 'block';
        
        requestAnimationFrame(transcriptionLoop);
    } catch (err) {
        alert("Microphone access denied or not supported.");
    }
}

let lastDetectedNote = null;
let sensitivityThreshold = 0.05;

// UI Listener for the slider
const micSensInput = document.getElementById('micSensitivity');
const sensValDisplay = document.getElementById('sensVal');

micSensInput?.addEventListener('input', () => {
    sensitivityThreshold = parseFloat(micSensInput.value);
    if (sensValDisplay) sensValDisplay.textContent = sensitivityThreshold.toFixed(2);
});

function transcriptionLoop() {
    if (!isListening) return;

    audioAnalyser.getFloatTimeDomainData(buf);
    const pitch = autoCorrelate(buf, audioCtx.sampleRate);
    
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    
    // Update visual meter
    document.getElementById('micLevel').style.width = Math.min(100, rms * 500) + "%";

    // 1. Check if the sound is LOUD enough based on our slider
    if (rms > sensitivityThreshold && pitch !== -1) {
        const detectedLabel = findClosestScaleNote(pitch);
        
        // 2. DEBOUNCE: Only write if this is a NEW note event
        // If the detected note is the same as the last one, we skip writing 
        // until the note actually stops (rms falls below threshold) or changes.
        if (detectedLabel && detectedLabel !== lastDetectedNote) {
            recordNoteToGrid(detectedLabel);
            lastDetectedNote = detectedLabel; // Lock this note
            console.log(`VOLUME GOOD: ${rms} | ${sensitivityThreshold}`);
        }
    } else {
        // 3. Reset the lock when it gets quiet
        // This allows the same note to be played twice in a row (e.g., Ding-Ding)
        lastDetectedNote = null;
        console.log(`VOLUME BAD: ${rms} | ${sensitivityThreshold}`);
    }

    requestAnimationFrame(transcriptionLoop);
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
            console.log(`[${freq}] || Target: [${t.freq}]) || Diff: ${diff} || Label: [[[${t.label}]]]`);
        }
        // For debug purpose only
        else 
        {
          console.log(`[${freq}] || Target: [${t.freq}]) || Diff: ${diff} || Label: ${t.label}`);
        }
    });

    return closest;
}

function recordNoteToGrid(label) {
    // Only transcribe if the app is currently PLAYING (so we have a timing reference)
    if (!playing) return;

    // Use the current loop position (defined in noteplayer.tick()) to determine the cell
    const currentIndex = step-1 > 0 ? step-1 : 0;
    
    // Debounce: Don't overwrite the same cell multiple times in one tick
    if (innerLabels[currentIndex] !== label) {
        setInnerLabel(currentIndex, label);
        console.log(`WRITING: [[[${label}]]] to ${currentIndex}`);
        // Highlight virtual handpan
        highlightHandpan(label, currentIndex);
    }
    // For debug only
    console.log(`<<<DEBOUNCE>>>: [[[${label}]]] at ${currentIndex}`);
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

document.getElementById('micBtn')?.addEventListener('click', toggleListening);