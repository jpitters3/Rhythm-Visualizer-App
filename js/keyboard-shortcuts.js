// ===== KEYBOARD LABELING + SHORTCUTS =====
import { gridA } from './grid-context.js';
import { activeGrid } from './state.js';
import { start, stop, ensureAudio, getAudioCtx } from './noteplayer.js';
import { clearSelection, deleteSelection, copySelection, pasteSelection, clearGridDom } from './notegrid.js';
import { getRange, clearRange } from './range-selection.js';
import { setPresentation } from './presentation-mode.js';
import { closeSidebar } from './courses.js';
import { closeCourseCreator } from './course-creator.js';
import { closeGrooveModal } from './groove-generator.js';
import { closeAuthModal } from './auth.js';
import { closeProfileEditor } from './profile.js';
import { TransportRegistry } from './transport-ui.js';
import { writeToSelected, getComposeOn } from './compose-mode.js';
import { aiAssistant } from './ai-assistant.js'; // Assuming aiAssistant is exported as a singleton or similar

export function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

    // Esc
    if (e.key === 'Escape') {

      // e.preventDefault();
      // e.stopPropagation();
      // 0. Priorities: Top-most overlays first

      // Guided Calibration
      const guided = document.getElementById('guidedCalModal');
      if (guided && guided.style.display !== 'none') {
        document.getElementById('closeGuidedBtn')?.click();
        return;
      }

      // Profile Modal
      const profileModal = document.getElementById('profileModal');
      if (profileModal?.classList.contains('open')) {
        if (typeof closeProfileEditor === 'function') closeProfileEditor();
        return;
      }

      // Auth Modal
      const authModal = document.getElementById('authModal');
      if (authModal?.classList.contains('open')) {
        if (typeof closeAuthModal === 'function') closeAuthModal();
        return;
      }

      // Groove Modal
      const grooveModal = document.getElementById('grooveModal');
      if (grooveModal && grooveModal.classList.contains('open')) {
        if (typeof closeGrooveModal === 'function') closeGrooveModal();
        return;
      }

      // Course Creator Modal
      const courseModal = document.getElementById('courseModal');
      if (courseModal?.classList.contains('open')) {
        if (typeof closeCourseCreator === 'function') closeCourseCreator();
        return;
      }

      // AI Assistant
      const aiCont = document.getElementById('aiChatContainer');
      if (aiCont && aiCont.classList.contains('open')) {
        aiCont.classList.remove('open');
        return;
      }
      if (aiAssistant && aiAssistant.isOpen) {
        aiAssistant.toggleChat(false);
        return;
      }

      // Course Sidebar
      const sb = document.getElementById('courseSidebar');
      if (sb?.classList.contains('open')) {
        closeSidebar();
        return;
      }

      // Presentation Mode
      if (document.body.classList.contains('present')) {
        setPresentation(false);
        return;
      }

      // Clear Selection
      clearSelection(activeGrid);
      // clearGridDom(activeGrid); // Should not clear dom on escape, just selection
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

    // Space: Play / Stop
    if (e.code === 'Space') {
      e.preventDefault();
      if (ctx.playing) stop(ctx);
      else start(ctx);
      return;
    }

    // From this point onwards in this function,
    // assign the beat to a ding, tak, slap, or note
    // based on the key that was pressed
    if (ctx.caretIndex === null) return;

    const noAdvance = e.altKey; // Alt = write without advancing

    const k = e.key;
    const lower = k.toLowerCase();
    const map = { d: 'D', t: 'T', s: 'S' };

    if (map[lower]) {
      writeToSelected(map[lower], { advance: !noAdvance }, ctx);
      return;
    }

    if (/^[0-9?]$/.test(k)) {
      writeToSelected(k, { advance: !noAdvance }, ctx);
      return;
    }

    // Delete single cell or selection
    if (k === 'Backspace' || k === 'Delete' || k === 'g') {
      e.preventDefault();
      const r = getRange(ctx);
      if (r && r.length > 1) {
        deleteSelection(ctx);
      } else {
        writeToSelected('', { advance: !noAdvance }, ctx);
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