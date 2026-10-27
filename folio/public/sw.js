// Anqulas Folio service worker: makes the site installable. It deliberately caches nothing, so no client data
// is ever stored on a phone; every page comes fresh from the server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
