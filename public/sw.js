// Minimal service worker: makes the site installable as a phone app and shows a friendly
// page instead of the browser's error screen when the phone is offline. It deliberately
// caches nothing, so a new deploy is always picked up straight away.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;margin:0;align-items:center;
justify-content:center;text-align:center;padding:24px;color:#1f2937}button{margin-top:16px;padding:10px 18px;
border:0;border-radius:8px;background:#152a43;color:#fff;font-size:15px}</style></head><body><div>
<h1 style="font-size:20px">You're offline</h1><p>Check your internet connection and try again.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
    ),
  );
});
