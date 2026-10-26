/**
 * Fixed-window rate limits kept in Postgres, so they hold across every Cloudflare location.
 * Returns true while under the limit.
 */
import { sql } from "drizzle-orm";
import { db } from "./db/client";
import { rateLimits } from "./db/schema";

export async function underLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await db()
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  return (row?.count ?? 1) <= limit;
}

export async function deleteOldRateLimits(): Promise<void> {
  await db().delete(rateLimits).where(sql`${rateLimits.windowStart} < now() - interval '1 day'`);
}
