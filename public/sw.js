// Minimal service worker to enable "Add to Home Screen"
self.addEventListener('install', (event) => {
  console.log('[Panafide SW] Installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Panafide SW] Activated');
});

self.addEventListener('fetch', (event) => {
  // Pass-through strategy for now
  event.respondWith(fetch(event.request));
});
