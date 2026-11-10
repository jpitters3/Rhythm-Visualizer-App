/* Reports uncaught errors from users' browsers to the client_errors table, so a
   crash on someone's phone is visible (scripts/client-errors.js lists them).
   Off on localhost and in automated tests; a few reports per session at most. */
import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';

const MAX_PER_SESSION = 5;
const COUNT_KEY = 'gp_errorReports';

// Harmless or not ours: browser layout warnings, opaque cross-origin errors, lost connections
const IGNORED = [
  /ResizeObserver loop/,
  /^Script error\.?$/,
  /Failed to fetch|NetworkError|Load failed|access control checks|network connection was lost/i,
];

const seen = new Set();

function sessionCount() {
  try { return Number(sessionStorage.getItem(COUNT_KEY)) || 0; } catch { return MAX_PER_SESSION; }
}

function report(message, stack) {
  const text = String(message || 'Unknown error').slice(0, 500);
  if (IGNORED.some(re => re.test(text)) || seen.has(text)) return;
  seen.add(text);
  const count = sessionCount();
  if (count >= MAX_PER_SESSION) return;
  try { sessionStorage.setItem(COUNT_KEY, String(count + 1)); } catch { /* private mode */ }

  supabase.from('client_errors').insert({
    user_id: currentUser?.id ?? null,
    message: text,
    stack: stack ? String(stack).slice(0, 4000) : null,
    page: (location.pathname + location.hash).slice(0, 300),
    user_agent: navigator.userAgent.slice(0, 300),
  }).then(({ error }) => {
    if (error) console.warn('[errors] Could not report:', error.message);
  });
}

export function initErrorReporter() {
  if (navigator.webdriver || ['localhost', '127.0.0.1'].includes(location.hostname)) return;
  addEventListener('error', (e) => report(e.error?.message || e.message, e.error?.stack));
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    report(r?.message || String(r), r?.stack);
  });
}
