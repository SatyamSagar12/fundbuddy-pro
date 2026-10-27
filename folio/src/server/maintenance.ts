/**
 * Setup tasks the app can run on itself, for hosting where nothing else can reach the database
 * (Cloudflare Pages): apply database migrations, and approve the platform admin's own sign-up.
 *
 *   POST /__maintenance/migrate          Authorization: Bearer <MIGRATE_TOKEN>
 *   POST /__maintenance/approve-admin    Authorization: Bearer <MIGRATE_TOKEN>
 *   POST /__maintenance/nav              Authorization: Bearer <MIGRATE_TOKEN>   (import today's NAVs now)
 *
 * Without a MIGRATE_TOKEN secret these answer 404. Migrations are recorded in the same table and format as
 * drizzle-kit's migrator (`drizzle.__drizzle_migrations`), so both ways of migrating agree.
 */
import { and, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "./db/client";
import { users } from "./db/schema";
import journal from "../../db/migrations/meta/_journal.json";
import { runNavJobs } from "./nav";

const files = import.meta.glob("../../db/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function migrate(): Promise<string[]> {
  await db().execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db().execute(
    sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  const last = await db().execute<{ created_at: string }>(
    sql`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
  );
  const lastWhen = Number([...last][0]?.created_at ?? 0);
  const applied: string[] = [];
  for (const entry of [...journal.entries].sort((a, b) => a.when - b.when)) {
    if (entry.when <= lastWhen) continue;
    const text = files[`../../db/migrations/${entry.tag}.sql`];
    if (text === undefined) throw new Error(`Migration file missing: ${entry.tag}`);
    const statements = text.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    const hash = await sha256Hex(text);
    const ran = await db().transaction(async (tx) => {
      // One runner at a time: several app instances may start together after a publish.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(727101)`);
      const done = await tx.execute(sql`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when}`);
      if ([...done].length) return false;
      for (const statement of statements) await tx.execute(sql.raw(statement));
      await tx.execute(sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})`);
      return true;
    });
    if (ran) applied.push(entry.tag);
  }
  return applied;
}

/**
 * Confirms the platform admins' sign-ups made in the last 24 hours (no email service yet).
 * With `onlyIfNoAdmin`, does nothing once any admin account is confirmed: the automatic bootstrap happens once.
 */
export async function approveAdmins(adminEmails: string, onlyIfNoAdmin = false): Promise<string[]> {
  const emails = adminEmails.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return [];
  if (onlyIfNoAdmin) {
    const confirmed = await db()
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.email, emails), isNotNull(users.emailVerifiedAt)))
      .limit(1);
    if (confirmed.length) return [];
  }
  const rows = await db()
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(
      and(inArray(users.email, emails), isNull(users.emailVerifiedAt), gt(users.createdAt, new Date(Date.now() - 86400000))),
    )
    .returning({ email: users.email });
  return rows.map((r) => r.email);
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Handles /__maintenance/* requests; returns null for any other path. */
export async function maintenance(
  request: Request,
  env: { MIGRATE_TOKEN?: string; PLATFORM_ADMIN_EMAILS?: string },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/__maintenance/")) return null;
  const token = env.MIGRATE_TOKEN ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (token.length < 32 || request.method !== "POST" || !sameText(given, token)) {
    return new Response("Not found", { status: 404 });
  }
  const task = url.pathname.slice("/__maintenance/".length);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  try {
    if (task === "migrate") return json({ applied: await migrate() });
    if (task === "approve-admin") return json({ approved: await approveAdmins(env.PLATFORM_ADMIN_EMAILS ?? "") });
    if (task === "nav") return json(await runNavJobs());
    return json({ error: "unknown task" }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

let ready: Promise<void> | null = null;

/**
 * Runs once per app instance, before the first request: applies new migrations and, until an admin account
 * exists, approves the admin's own sign-up. Retried on the next request if it fails.
 */
export function ensureReady(env: { PLATFORM_ADMIN_EMAILS?: string }): Promise<void> {
  ready ??= (async () => {
    const applied = await migrate();
    if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);
    const approved = await approveAdmins(env.PLATFORM_ADMIN_EMAILS ?? "", true);
    if (approved.length) console.log(`Approved admin sign-up: ${approved.join(", ")}`);
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}
