// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// `npm run build:mobile` sets BUILD_TARGET=mobile. That build produces a plain static
// single-page app (dist/client/index.html + assets) that the Android app bundles.
// The normal web build (used by Lovable) is unchanged.
const isMobile = process.env["BUILD_TARGET"] === "mobile";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    ...(isMobile
      ? {
          spa: {
            enabled: true,
            maskPath: "/",
            prerender: { outputPath: "/index.html", crawlLinks: false, retryCount: 0 },
          },
        }
      : {}),
  },
  ...(isMobile
    ? {
        nitro: false as const,
        // The SPA shell is rendered by a short-lived local preview server; bind it to IPv4
        // so the build also works on machines without IPv6.
        vite: { preview: { host: "127.0.0.1" } },
      }
    : {}),
});
