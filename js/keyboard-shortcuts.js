// ===== KEYBOARD LABELING + SHORTCUTS =====
import { gridA } from './grid-context.js';
import { activeGrid, isEditFlam, setIsEditFlam } from './state.js';
import { start, stop, ensureAudio, getAudioCtx } from './noteplayer.js';
import { clearSelection, deleteSelection, copySelection, pasteSelection, setInnerFlam } from './notegrid.js';
import { getRange, clearRange } from './range-selection.js';
import { setPresentation } from './presentation-mode.js';
import { TransportRegistry } from './transport-ui.js';
import { writeToSession, getComposeOn } from './compose-mode.js';
import { Modal } from './modal.js';
import { Sidepanel } from './sidepanel.js';

export function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

    // Esc
    if (e.key === 'Escape') {
      if (Modal.closeTopmost() || Sidepanel.closeTopmost()) return;

      // Presentation Mode
      if (document.body.classList.contains('present')) {
        setPresentation(false);
        return;
      }

      // Clear Selection
      clearSelection(activeGrid);
      clearRange(activeGrid);
      return;
    }

    // Metronome shortcut
    if (e.key.toLowerCase() === 'm') {
      const ctx = activeGrid;
      ctx.metronomeOn = !ctx.metronomeOn;
      // We hardcoded gridA for storage key in init.js logic, but usually it's ctx.id or similar
      // Using simple ctx.id logic here
      const key = ctx.id ? `groovepan_metro-${ctx.id}` : 'groovepan_metro';
      localStorage.setItem(key, ctx.metronomeOn ? 'on' : 'off');

      // Update UI
      TransportRegistry.updateAll(ctx);

      if (ctx.metronomeOn) ensureAudio();
      return;
    }

    // Presentation Mode shortcut
    if (e.key.toLowerCase() === 'p') {
      const on = !document.body.classList.contains('present');
      setPresentation(on);
      return;
    }

    // Enter: Groove modal 'Go!'
    const grooveModalEl = document.getElementById('grooveModal');
    if (grooveModalEl?.classList?.contains('open') && e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('grooveGo')?.click();
      return;
    }

    // Cmd/Ctrl+C / V for selection
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const ctx = activeGrid;

    if (mod && e.key.toLowerCase() === 'c') {
      const r = getRange(ctx);
      if (r && r.length >= 1) {
        e.preventDefault();
        copySelection(ctx);
      }
    }

    if (mod && e.key.toLowerCase() === 'v') {
      // We need to know if clipboard has content.
      // Usually 'beatClipboard' was exported from notegrid.js?
      // Let's assume pasteSelection handles empty clipboard gracefully.
      // or checks internal variable.
      e.preventDefault();
      pasteSelection(ctx);
    }

    // Esc cancels range selection -- Handled above in "Escape" block generally

    // Space: Play / Stop (suppressed when flash card overlay is open)
    if (e.code === 'Space') {
      if (document.getElementById('flashCardOverlay')?.classList.contains('open')) return;
      e.preventDefault();
      if (ctx.playing) {
        stop(ctx);
      } else {
        start(ctx);
      }
      TransportRegistry.updateAll(ctx);
      return;
    }

    // From this point onwards in this function,
    // assign the beat to a ding, tak, slap, or note
    // based on the key that was pressed
    if (ctx.caretIndex === null) return;

    const noAdvance = e.altKey; // Alt = write without advancing

    const k = e.key;
    const lower = k.toLowerCase();
    const map = { d: 'Ding', t: 'T', s: 'S' };

    // F: toggle flam edit mode on the selected cell
    if (lower === 'f' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const i = ctx.caretIndex;
      if (!isEditFlam) {
        if (ctx.innerLabels[i]) {
          setIsEditFlam(true);
          Array.from(ctx.cells).forEach(c => {
            c.classList.toggle('flam-editing', +c.dataset.index === i);
          });
        }
      } else {
        setIsEditFlam(false);
        Array.from(ctx.cells).forEach(c => c.classList.remove('flam-editing'));
      }
      return;
    }

    // While in flam edit mode, intercept note keys → write to grace note slot
    if (isEditFlam) {
      const i = ctx.caretIndex;
      const label = map[lower] || (/^[0-9?]$/.test(k) ? k : null);

      if (label !== null) {
        setInnerFlam(i, label, ctx);
        setIsEditFlam(false);
        Array.from(ctx.cells).forEach(c => c.classList.remove('flam-editing'));
        return;
      }

      if (k === 'Backspace' || k === 'Delete' || k === 'g') {
        e.preventDefault();
        setInnerFlam(i, '', ctx);
        setIsEditFlam(false);
        Array.from(ctx.cells).forEach(c => c.classList.remove('flam-editing'));
        return;
      }

      // Any other key exits flam mode without changing anything
      setIsEditFlam(false);
      Array.from(ctx.cells).forEach(c => c.classList.remove('flam-editing'));
      return;
    }

    if (map[lower]) {
      writeToSession(map[lower], { advance: !noAdvance }, ctx);
      return;
    }

    if (/^[0-9?]$/.test(k)) {
      writeToSession(k, { advance: !noAdvance }, ctx);
      return;
    }

    // Delete single cell or selection
    if (k === 'Backspace' || k === 'Delete' || k === 'g') {
      e.preventDefault();
      const r = getRange(ctx);
      if (r && r.length > 1) {
        deleteSelection(ctx);
      } else {
        writeToSession('', { advance: !noAdvance }, ctx);
      }
    }
  });

  document.addEventListener('click', (ev) => {
    // Unlock audio if anything is clicked
    const locked = getAudioCtx()?.state === 'suspended';
    if (locked) ensureAudio(); // includes resume logic

    // Clear selection when clicking / tapping anywhere except
    // on the beat cells, or on the handpan notes while Compose mode is ON
    let shouldClear = true;

    if (ev.target.closest('.cell')) shouldClear = false;

    // Compose logic
    if (getComposeOn() && ev.target.closest('.hp-dot')) shouldClear = false;

    // Also don't clear if interacting with key UI elements
    if (ev.target.closest('#aiFab') || ev.target.closest('#aiChatContainer')) shouldClear = false;
    if (ev.target.closest('.sel-bar')) shouldClear = false; // Add selection bar protection

    // Don't clear if clicking transport controls
    if (ev.target.closest('button')) shouldClear = false;

    if (shouldClear) {
      clearRange(activeGrid);
    }
  });
}