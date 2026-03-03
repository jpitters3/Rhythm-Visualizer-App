/**
 * Simple ESM-based hash router for switching views.
 */

// We maintain a list of valid routes here
const validRoutes = ['freeplay', 'dashboard', 'compose'];
let currentRoute = '';

/**
 * Initializes the router, attaching the hashchange listener.
 * Called once during app startup.
 */
export function initRouter() {
  window.addEventListener('hashchange', handleHashChange);

  // Trigger initial route based on current URL hash
  handleHashChange();
}

/**
 * The core routing logic. Hides all views and shows the one matching the hash.
 */
function handleHashChange() {
  let hash = window.location.hash.replace('#', '');

  // Default to freeplay if no hash or invalid hash
  if (!hash || !validRoutes.includes(hash)) {
    hash = 'freeplay';
    // Update the URL without triggering another hashchange event unnecessarily
    history.replaceState(null, null, `#${hash}`);
  }

  currentRoute = hash;

  // Sync body class for route-specific global styling
  document.body.classList.forEach(cls => {
    if (cls.startsWith('route-')) document.body.classList.remove(cls);
  });
  document.body.classList.add(`route-${hash}`);

  // Find all elements with the 'route-view' class
  const views = document.querySelectorAll('.route-view');

  views.forEach(view => {
    if (view.id === `view-${hash}`) {
      view.style.display = 'block';
      view.classList.add('active');
    } else {
      view.style.display = 'none';
      view.classList.remove('active');
    }
  });

  // Optional: We can dispatch a custom event here if other modules need to know 
  // that the view changed (e.g. to pause audio if they leave freeplay).
  window.dispatchEvent(new CustomEvent('routeChanged', { detail: { route: hash } }));
}

/**
 * Programmatically navigate to a route.
 * @param {string} routeName - the name of the route (e.g., 'dashboard')
 */
export function navigate(routeName) {
  if (validRoutes.includes(routeName)) {
    window.location.hash = `#${routeName}`;
  }
}

/**
 * Retrieves the currently active route.
 */
export function getCurrentRoute() {
  return currentRoute;
}
