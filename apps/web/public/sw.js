/* global self */
// Studio AutoPilot service worker.
//
// It exists so the app can be installed to a phone's home screen and open
// full-screen. It deliberately caches NOTHING: every request goes to the
// network, exactly as without it, so a deploy is live on the next load and
// nobody is ever stuck on an old version or old numbers.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {
  // No respondWith: the browser handles the request as if we were not here.
})
