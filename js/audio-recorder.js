/**
 * js/audio-recorder.js
 * Handles the MediaRecorder API for capturing raw user audio clips directly from the microphone.
 */

import fixWebmDuration from './fix-webm-duration.js';
import { getAudioCtx, unlockAudio } from './noteplayer.js';
import { micStream } from './transcription.js';

let rawAudioRecorder = null;
let rawAudioChunks = [];
let isRawRecordingActive = false;
let recordingStartTime = 0;

/**
 * Starts recording audio from the microphone
 * @param {Function} onStop - Callback triggered when recording stops. Passed the resulting audio Blob.
 * @returns {Promise<boolean>} True if successful, false if mic permission denied
 */
export async function startRawAudioRecording(onStop) {
  try {
    // Ensure the global AudioContext is initialized and wait a moment for Mac CoreAudio hardware lock to settle.
    // If we request the mic at the exact moment AudioContext starts, Mac hardware returns NotFoundError.
    await unlockAudio();
    await new Promise(resolve => setTimeout(resolve, 300));

    const audioCtx = getAudioCtx();

    let constraints = {
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false
      }
    };

    if (audioCtx && audioCtx.sampleRate) {
      constraints.audio.sampleRate = audioCtx.sampleRate;
    }

    let stream;
    let isBorrowedStream = false;

    // First try to reuse the existing transcription mic stream to avoid hardware conflicts
    if (micStream && micStream.active) {
      stream = micStream;
      isBorrowedStream = true;
    } else {
      try {
        // First try with exact sample rate to prevent CoreAudio reset freezes on Mac
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        console.warn("Could not get matching sample rate, trying default settings", e);
        // Fallback 1: remove the sampleRate constraint
        constraints = {
          audio: {
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false
          }
        };

        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e2) {
          console.warn("Could not disable processing, trying bare minimum", e2);
          // Fallback 2: The device rejects specific processing constraints entirely
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      }
    }

    rawAudioRecorder = new MediaRecorder(stream);
    rawAudioChunks = [];

    rawAudioRecorder.ondataavailable = e => {
      if (e.data.size > 0) {
        rawAudioChunks.push(e.data);
      }
    };

    rawAudioRecorder.onstart = () => {
      recordingStartTime = Date.now();
    };

    const mimeType = rawAudioRecorder.mimeType || 'audio/webm';

    rawAudioRecorder.onstop = async () => {
      const duration = Date.now() - recordingStartTime;
      const audioBlob = new Blob(rawAudioChunks, { type: mimeType });

      try {
        // Inject duration and seek cues into the WebM header so the browser doesn't hang on playback
        const fixedBlob = await fixWebmDuration(audioBlob, duration);
        if (!isBorrowedStream) {
          stream.getTracks().forEach(track => track.stop());
        }
        rawAudioRecorder = null;
        if (onStop) onStop(fixedBlob);
      } catch (e) {
        console.error("Failed to fix webm duration. Falling back to original blob.", e);
        if (!isBorrowedStream) {
          stream.getTracks().forEach(track => track.stop());
        }
        rawAudioRecorder = null;
        if (onStop) onStop(audioBlob);
      }
    };

    rawAudioRecorder.start();
    isRawRecordingActive = true;
    return true;
  } catch (err) {
    console.error("Failed to start raw audio recording", err);
    alert("Microphone access is required to record audio.");
    return false;
  }
}

/**
 * Stops the active recording
 */
export function stopRawAudioRecording() {
  if (rawAudioRecorder && rawAudioRecorder.state !== "inactive") {
    rawAudioRecorder.stop();
  }
  isRawRecordingActive = false;
}