/* Free play: a big, centred handpan with no grid or composing tools. The transport
   stays, so you can play along to the metronome; the grid's notes stay silent. */
import { Bus, BUS_EVENT } from './bus.js';
import { freePlay, setFreePlay } from './state.js';
import { gridA } from './grid-context.js';
import { clearSelection } from './notegrid.js';

function setMode(on) {
  if (on === freePlay) return;
  setFreePlay(on);
  if (on) clearSelection(gridA); // no caret, so nothing gets written
  document.body.classList.toggle('free-play', on);
  document.querySelectorAll('[data-free-play]').forEach(b => b.setAttribute('aria-pressed', String(on)));
  Bus.emit(BUS_EVENT.FREE_PLAY_CHANGED, { on });
}

export function initFreePlay() {
  document.querySelectorAll('[data-free-play]').forEach(b => {
    b.addEventListener('click', () => setMode(!freePlay));
  });
  // Leaving the Studio ends it, so the next visit starts in the composer
  window.addEventListener('routeChanged', (e) => {
    if (e.detail?.route !== 'studio') setMode(false);
  });
}
