/**
 * The Worker's entry point.
 *  - fetch:     every web request, via TanStack Start, inside its own database context.
 *  - scheduled: cron jobs from wrangler.jsonc (housekeeping, NAV import), when run as a Worker.
 *
 * Cloudflare Pages has no cron, so after a request the NAV import also runs in the background when it is due
 * (src/server/nav.ts decides; at most one instance at a time).
 */
import handler from "@tanstack/react-start/server-entry";
import { runWithDb } from "./server/db/client";
import { deleteExpiredSessions } from "./server/session";
import { deleteOldRateLimits } from "./server/rate-limit";
import { ensureReady, maintenance } from "./server/maintenance";
import { refreshIfDue, runNavJobs } from "./server/nav";
import { sendBriefingsIfDue } from "./server/briefing-mail";
import { deleteOldInbox, inboxEndpoint } from "./server/inbox";
import { deleteExpiredPortalRows } from "./server/portal";

type Env = { HYPERDRIVE: Hyperdrive; MIGRATE_TOKEN?: string; INBOX_TOKEN?: string; PLATFORM_ADMIN_EMAILS?: string };

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
        const special = (await maintenance(request, env)) ?? (await inboxEndpoint(request, env));
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
    ctx.waitUntil(backgroundJobs(env));
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

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const { close } = await runWithDb(env.HYPERDRIVE.connectionString, async () => {
      await deleteExpiredSessions();
      await deleteOldRateLimits();
      await deleteOldInbox().catch((e) => console.error("Inbox housekeeping failed:", e));
      await deleteExpiredPortalRows().catch((e) => console.error("Portal housekeeping failed:", e));
      // AMFI publishes by about 11 pm IST (17:30 UTC): import at the 18:17 UTC run.
      if (new Date(event.scheduledTime).getUTCHours() === 18) await runNavJobs().catch((e) => console.error("NAV import failed:", e));
      await sendBriefingsIfDue().catch((e) => console.error("Morning briefing failed:", e));
    });
    ctx.waitUntil(close());
  },
} satisfies ExportedHandler<Env>;

/** Work that must not hold up the page: its own database connection, errors only logged. */
async function backgroundJobs(env: Env): Promise<void> {
  try {
    const { result, close } = await runWithDb(env.HYPERDRIVE.connectionString, async () => {
      const nav = await refreshIfDue().catch((e) => {
        console.error("NAV import failed:", e instanceof Error ? e.message : e);
        return null;
      });
      const briefings = await sendBriefingsIfDue().catch((e) => {
        console.error("Morning briefing failed:", e instanceof Error ? e.message : e);
        return null;
      });
      return { nav, briefings };
    });
    await close();
    if (result.nav) console.log(`NAV import: ${result.nav.schemes} schemes, ${result.nav.changed} changed, NAV date ${result.nav.navDate}`);
    if (result.briefings) console.log(`Morning briefing: ${result.briefings.sent} sent`);
  } catch (e) {
    console.error("Background jobs failed:", e instanceof Error ? e.message : e);
  }
}
