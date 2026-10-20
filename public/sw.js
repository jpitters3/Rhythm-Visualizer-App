// Minimal service worker to enable "Add to Home Screen"
self.addEventListener('install', (event) => {
  console.log('[Panafide SW] Installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Panafide SW] Activated');
  // Take control of already-open pages/PWA instances immediately, instead
  // of leaving them on the previous service worker until fully closed.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Leave cross-origin and non-GET requests to the browser: re-fetching them
  // here turns a failed third-party call into a SW respondWith error.
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => Response.error()));
});

// ── Web Push ─────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* non-JSON payload — ignore */ }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Panafide', {
      body: data.body || '',
      icon: '/assets/images/icon-192.png',
      badge: '/assets/images/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
