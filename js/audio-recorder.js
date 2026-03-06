/**
 * js/audio-recorder.js
 * Handles the MediaRecorder API for capturing raw user audio clips directly from the microphone.
 */

import fixWebmDuration from 'fix-webm-duration';

let rawAudioRecorder = null;
let rawAudioChunks = [];
let isRawRecordingActive = false;
let recordingStartTime = 0;

/**
 * Starts recording audio from the microphone
 * @param {Function} onStop - Callback triggered when recording stops. Passed the resulting audio Blob.
 * @returns {Promise<boolean>} True if successful, false if mic permission denied
 */
async function startRawAudioRecording(onStop) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        stream.getTracks().forEach(track => track.stop());
        rawAudioRecorder = null;
        if (onStop) onStop(fixedBlob);
      } catch (e) {
        console.error("Failed to fix webm duration. Falling back to original blob.", e);
        stream.getTracks().forEach(track => track.stop());
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
function stopRawAudioRecording() {
  if (rawAudioRecorder && rawAudioRecorder.state !== "inactive") {
    rawAudioRecorder.stop();
  }
  isRawRecordingActive = false;
}

window.startRawAudioRecording = startRawAudioRecording;
window.stopRawAudioRecording = stopRawAudioRecording;
