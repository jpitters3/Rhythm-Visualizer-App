// ===== PRESENTATION MODE =====
async function enterFullscreenIfPossible() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    // ignore
  }
}

async function exitFullscreenIfPossible() {
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch {
    // ignore
  }
}

async function setPresentation(on) {
  document.body.classList.toggle('present', on);
  localStorage.setItem(PRESENT_KEY, on ? 'on' : 'off');
  presentBtn.classList.toggle('active', on);
  presentBtn.textContent = on ? 'Exit Presentation' : 'Presentation';
  exitPresent.style.display = on ? 'inline-flex' : 'none';

  if (on) await enterFullscreenIfPossible();
  else await exitFullscreenIfPossible();
}