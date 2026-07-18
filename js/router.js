/**
 * Simple ESM-based hash router for switching views.
 */
import { stop } from './noteplayer.js';
import { gridA } from './grid-context.js';
import { Sidepanel } from './sidepanel.js';

const validRoutes = ['studio', 'home', 'dashboard', 'compose', 'community', 'library', 'method', 'method-welcome', 'practice'];
let currentRoute = '';

export function initRouter() {
  window.addEventListener('hashchange', handleHashChange);
  handleHashChange();
}

function handleHashChange() {
  let hash = window.location.hash.replace('#', '');

  // Supabase auth callbacks (email confirmation, magic link, password recovery)
  // land here as #access_token=...&type=signup etc. — never valid routes. Don't
  // clobber the hash via replaceState: Supabase's own detectSessionInUrl logic
  // needs to read and clear it itself. Just render a sensible default view and
  // let the auth SDK finish; it'll clean up the URL when it's done.
  const isAuthCallback = hash.includes('access_token=') || hash.includes('refresh_token=');

  if (isAuthCallback) {
    hash = 'dashboard';
  } else if (!hash || !validRoutes.includes(hash)) {
    hash = 'dashboard';
    history.replaceState(null, null, `#${hash}`);
  }

  const prev = currentRoute;
  currentRoute = hash;

  // Leaving freeplay: stop playback and close all panels (clears panel nav highlights)
  if (prev === 'studio' && hash !== 'studio') {
    if (gridA.playing) stop(gridA);
    Sidepanel.closeAll();
  }

  // Body class
  document.body.classList.forEach(cls => {
    if (cls.startsWith('route-')) document.body.classList.remove(cls);
  });
  document.body.classList.add(`route-${hash}`);

  // Show/hide views via class only (CSS handles display)
  document.querySelectorAll('.route-view').forEach(view => {
    view.classList.toggle('active', view.id === `view-${hash}`);
    view.style.display = '';
  });

  // Sync nav link active states (data-also-route lets one link cover two routes)
  document.querySelectorAll('.nav-link[data-route]').forEach(link => {
    const alsoRoutes = (link.dataset.alsoRoute || '').split(',').map(s => s.trim());
    link.classList.toggle('active', link.dataset.route === hash || alsoRoutes.includes(hash));
  });

  window.dispatchEvent(new CustomEvent('routeChanged', { detail: { route: hash } }));
}

export function navigate(routeName) {
  if (validRoutes.includes(routeName)) {
    window.location.hash = `#${routeName}`;
  }
}

export function getCurrentRoute() {
  return currentRoute;
}
