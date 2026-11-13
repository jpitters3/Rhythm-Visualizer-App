// Speech-to-text for spoken commands, on the browser's own recogniser (Chrome,
// Edge, Safari; not Firefox). Keeps listening until stopped: browsers end a
// session after a pause, so it restarts itself.
const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

let rec = null;
let wanted = false;
let handlers = {};
let speaking = false;

export function voiceSupported() {
  return !!Recognition;
}

// handlers: { onSpeech() — words started coming in, onInterim(text),
//   onFinal(alternatives[]) — best guess first, onError(code) }
export function startVoice(nextHandlers) {
  if (!Recognition) return false;
  handlers = nextHandlers || {};
  wanted = true;
  if (rec) return true;
  rec = new Recognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 4;
  rec.lang = navigator.language || 'en-US';

  // Only words count as talking: Chrome's speechstart also fires for a struck note
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (!result[0]?.transcript.trim()) continue;
      if (!speaking) { speaking = true; handlers.onSpeech?.(); }
      if (result.isFinal) {
        speaking = false;
        handlers.onFinal?.([...result].map(alt => alt.transcript.trim()).filter(Boolean));
      } else {
        handlers.onInterim?.(result[0].transcript.trim());
      }
    }
  };
  rec.onerror = (e) => {
    // no-speech / aborted are routine; the restart below covers them
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') wanted = false;
    if (e.error !== 'no-speech' && e.error !== 'aborted') handlers.onError?.(e.error);
  };
  rec.onend = () => {
    speaking = false;
    handlers.onIdle?.();
    if (!wanted) { rec = null; return; }
    try { rec.start(); } catch { rec = null; }
  };
  try {
    rec.start();
  } catch {
    rec = null;
    return false;
  }
  return true;
}

export function stopVoice() {
  wanted = false;
  speaking = false;
  handlers = {};
  try { rec?.stop(); } catch { /* already stopped */ }
}
