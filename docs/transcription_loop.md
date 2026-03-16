# Transcription Engine: Technical Guide

This document explains the core audio processing logic in `transcription.js` and its interaction with `coaching-mode.js`.

## 1. Core Variables & Input
The `transcriptionLoop` runs via `requestAnimationFrame` and processes the microphone stream buffer.

- **RMS**: Volume. Used for "Strike" detection.
- **Pitch**: Detected via `PitchFinder`. 
- **Clarity**: Confidence score (0 to 1) of the pitch detection.
- **Flux**: The ratio of `RMS / prevRMS`. A high flux (e.g., > 1.35) indicates a new physical attack.

---

## 2. The Logic Matrix (Accents vs. Notes)
The engine differentiates between a "Clear Note" (Ding, 1-8) and a "Percussive Accent" (Slap/Tak).

| Feature | Clear Note | Percussive Accent |
| :--- | :--- | :--- |
| **Clarity** | High (> user threshold) | Low (< user threshold) |
| **Strike (Flux)** | Required (if same note) | Required (always) |
| **Timing** | Confirmed after 4-5 frames | Confirmed in 1 frame (buffered) |

---

## 3. The Pitch Refinement System (The "Waiting Room")
To achieve high accuracy WITHOUT lag, we use a "Pending Accent" buffer.

1. **Detection**: If a "Strike" is heard but the pitch is unclear, it is labeled an **ACCENT**.
2. **Buffering**: Instead of committing the accent immediately, it is stored in `pendingAccent` for up to **100ms**.
3. **Refinement**: If a clear pitch (e.g., "Ding") appears within that 100ms, it "Refines" the accent.
    - The accent is **canceled**.
    - The note is confirmed using the **original attack timestamp** from the accent.
4. **Expiration**: If 100ms passes without a clear pitch, the accent is committed as a "Slap" (S) or "Tak" (T).

### The Deadlock Fix
We avoid "Sustain Blocking" (where the app ignores a note because it's the same as the last one) whenever `pendingAccent` is active. Since the accent is proof of a new strike, we "lower the guard" and let the pitch confirm regardless of flux.

---

## 4. Coaching Mode Integration (Smart Search)
Because the Handpan resonates and our buffer is 100ms, a note might physically finish confirming after the metronome has already moved to the next step.

- **Smart Search**: `evaluateDetectedNote` in `coaching-mode.js` searches a **±1 step radius** around the current index.
- **Outcome**: If you hit exactly on the beat but the app takes 80ms to confirm, the "Smart Search" pulling the note back to the correct cell, preventing the dreaded "Missed Note" error.

---

## 5. Sensitivity Calibration
The `noteMultipliers` object stores per-note sensitivity. 
- **Missed a note?** The multiplier is lowered (easier to hit).
- **Double-triggered?** The multiplier is increased (harder to hit).
- these values are persisted in `localStorage`.
