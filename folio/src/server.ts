/**
 * The Worker's entry point.
 *  - fetch:     every web request, via TanStack Start, inside its own database context.
 *  - scheduled: cron jobs from wrangler.jsonc (housekeeping now; NAV import and briefings in later phases).
 */
import handler from "@tanstack/react-start/server-entry";
import { runWithDb } from "./server/db/client";
import { deleteExpiredSessions } from "./server/session";
import { deleteOldRateLimits } from "./server/rate-limit";
import { ensureReady, maintenance } from "./server/maintenance";

type Env = { HYPERDRIVE: Hyperdrive; MIGRATE_TOKEN?: string; PLATFORM_ADMIN_EMAILS?: string };

const SECURITY_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { result, close } = await runWithDb(
      env.HYPERDRIVE.connectionString,
      async () => {
        const special = await maintenance(request, env);
        if (special) return special;
        try {
          await ensureReady(env);
        } catch (e) {
          console.error("Startup (migrations) failed:", e);
          return new Response("Anqulas Folio is starting up. Please try again in a minute.", {
            status: 503,
            headers: { "retry-after": "30" },
          });
        }
        return handler.fetch(request);
      },
    );
    // Pages stream; keep the database connection until the whole body has been sent, then close it.
    let body: ReadableStream | null = null;
    if (result.body) {
      const { readable, writable } = new TransformStream();
      ctx.waitUntil(result.body.pipeTo(writable).catch(() => {}).finally(close));
      body = readable;
    } else {
      ctx.waitUntil(close());
    }
    const response = new Response(body, result);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(k)) response.headers.set(k, v);
    }
    // Signed-in pages and server-function answers must never be cached by browsers or proxies.
    if (!response.headers.has("cache-control")) response.headers.set("cache-control", "no-store");
    return response;
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const { close } = await runWithDb(env.HYPERDRIVE.connectionString, async () => {
      await deleteExpiredSessions();
      await deleteOldRateLimits();
    });
    ctx.waitUntil(close());
  },
} satisfies ExportedHandler<Env>;
