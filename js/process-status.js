/**
 * showProcess - non-blocking top-of-page status strip for background work
 * (audio rendering, exports, uploads, ...). The app keeps working while
 * it's shown - unlike a modal, it never traps focus or covers content.
 *
 * Usage:
 *   const status = showProcess('Rendering audio…');
 *   try {
 *     await doWork();
 *     status.done('Downloaded');
 *   } catch (err) {
 *     status.fail('Export failed');
 *   }
 *
 * If a second showProcess() call comes in before the first settles, the
 * newer one takes over the strip and the older handle's done()/fail()
 * become no-ops (guarded by token) so it can't clobber the newer state.
 */

const HOLD_MS = 1800;

let stripEl = null;
let messageEl = null;
let activeToken = 0;
let hideTimer = null;

function ensureStrip() {
  if (stripEl) return stripEl;

  stripEl = document.createElement('div');
  stripEl.id = 'processStrip';
  stripEl.className = 'process-strip';
  stripEl.setAttribute('role', 'status');
  stripEl.setAttribute('aria-live', 'polite');

  const spinner = document.createElement('span');
  spinner.className = 'process-strip-spinner';

  const icon = document.createElement('span');
  icon.className = 'process-strip-icon';

  messageEl = document.createElement('span');
  messageEl.className = 'process-strip-message';

  stripEl.append(spinner, icon, messageEl);
  document.body.appendChild(stripEl);
  return stripEl;
}

export function showProcess(message) {
  const el = ensureStrip();
  const token = ++activeToken;

  clearTimeout(hideTimer);
  el.classList.remove('success', 'fail');
  el.classList.add('busy', 'visible');
  messageEl.textContent = message;

  const settle = (state, finalMessage) => {
    if (token !== activeToken) return;
    el.classList.remove('busy');
    el.classList.add(state);
    if (finalMessage) messageEl.textContent = finalMessage;
    hideTimer = setTimeout(() => {
      if (token !== activeToken) return;
      el.classList.remove('visible');
    }, HOLD_MS);
  };

  return {
    done: (finalMessage) => settle('success', finalMessage),
    fail: (finalMessage) => settle('fail', finalMessage),
  };
}
