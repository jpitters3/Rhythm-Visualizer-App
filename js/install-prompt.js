// Captured early (module-load time) since Chrome fires beforeinstallprompt
// once, on its own timing — we'd otherwise miss it if we only listened once
// the tour got around to asking.
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

export function isRunningStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

export function canPromptInstall() {
  return !!deferredPrompt;
}

export async function triggerInstallPrompt() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome === 'accepted';
}
