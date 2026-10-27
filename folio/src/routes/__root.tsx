import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import appCss from "../styles.css?url";
import { THEME_SCRIPT } from "@/components/theme";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Anqulas Folio" },
      { name: "description", content: "Back office for mutual fund distributors." },
      { name: "robots", content: "noindex" },
      { name: "theme-color", content: "#eeeae2", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#151c18", media: "(prefers-color-scheme: dark)" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Folio" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: "/icons/favicon-32.png" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
    ],
  }),
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
  notFoundComponent: () => (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="eyebrow text-bronze">Not found</p>
      <h1 className="text-[2.75rem]">
        <span className="line-mask">
          <span>This page isn't here.</span>
        </span>
      </h1>
      <Link to="/" className="link-draw font-medium text-bronze">
        Go to Anqulas Folio
      </Link>
    </main>
  ),
});

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved colour theme before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
        <script
          // Registers the service worker that makes the app installable (it caches nothing).
          dangerouslySetInnerHTML={{
            __html: `if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));`,
          }}
        />
      </body>
    </html>
  );
}
