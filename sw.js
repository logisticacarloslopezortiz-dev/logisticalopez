// A basic service worker to make the app installable and resolve the 404 error.
// For a more robust, production-ready service worker, you'll want to add caching strategies.

self.addEventListener('install', (event) => {
  console.log('Service Worker installing.');
});

self.addEventListener('fetch', (event) => {
  // For now, just pass through network requests.
  event.respondWith(fetch(event.request));
});