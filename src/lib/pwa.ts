import { isNativeApp } from "./native";

/**
 * Registers the service worker that lets people install the website as an app from their
 * phone's browser. Skipped in development, inside the Android app (which already is an app)
 * and inside the Lovable editor preview, where a worker would get in the way of live reloads.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || isNativeApp()) return;
  if (window.self !== window.top) return;
  const host = window.location.hostname;
  if (host.endsWith(".lovableproject.com") || host.startsWith("id-preview--")) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Installing as an app is optional; the site works the same without it.
  });
}
