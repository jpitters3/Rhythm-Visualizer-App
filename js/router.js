/**
 * Simple ESM-based hash router for switching views.
 */
import { stop } from './noteplayer.js';
import { gridA } from './grid-context.js';
import { Sidepanel } from './sidepanel.js';

const validRoutes = ['freeplay', 'dashboard', 'compose', 'community', 'library'];
let currentRoute = '';

export function initRouter() {
  window.addEventListener('hashchange', handleHashChange);
  handleHashChange();
}

function handleHashChange() {
  let hash = window.location.hash.replace('#', '');

  if (!hash || !validRoutes.includes(hash)) {
    hash = 'freeplay';
    history.replaceState(null, null, `#${hash}`);
  }

  const prev = currentRoute;
  currentRoute = hash;

  // Leaving freeplay: stop playback and close all panels (clears panel nav highlights)
  if (prev === 'freeplay' && hash !== 'freeplay') {
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

  // Sync nav link active states
  document.querySelectorAll('.nav-link[data-route]').forEach(link => {
    link.classList.toggle('active', link.dataset.route === hash);
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
