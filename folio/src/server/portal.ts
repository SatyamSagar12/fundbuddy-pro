/**
 * Client portal sign-in: a client opens their distributor's link (/c/<portal code>), enters the email on their client
 * record and gets a 6-digit code. They then see their own family's portfolio, read-only.
 *
 * Rules:
 *  - Who a client sees is worked out from the email on every request: the clients with that email, and everyone in
 *    those clients' family. If the email is on clients of different families (or on several clients without a
 *    family), nobody can sign in with it: the distributor must fix the records first.
 *  - Codes: only an HMAC is stored; 10 minutes, 5 tries, one use. Asking again replaces the old code.
 *  - Rate limits per network and per email, for asking and for entering codes.
 *  - Answers never say whether an email is on the records.
 *  - Portal sessions are their own kind (table, cookie), never a team member's session.
 */
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { deleteCookie, getCookie, getRequestHeader, setCookie } from "@tanstack/react-start/server";
import { db } from "./db/client";
import { families, investors, portalCodes, portalSessions, practices } from "./db/schema";
import type { InvestorScope } from "./db/scope";
import { hmacHex, randomBytes, randomToken } from "./crypto";
import { appEnv } from "./env";
import { underLimit } from "./rate-limit";
import { clientIp } from "./security";

export const PORTAL_COOKIE = "__Host-folio_portal";
const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const IDLE_MS = 3 * 24 * 3600 * 1000;
const ABSOLUTE_MS = 14 * 24 * 3600 * 1000;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/** The practice behind a portal link, if its portal is on. */
export async function portalPractice(code: string) {
  if (!/^[a-z0-9]{6,16}$/.test(code)) return null;
  const [p] = await db()
    .select({ id: practices.id, name: practices.name, arn: practices.arn, euin: practices.euin })
    .from(practices)
    .where(and(eq(practices.portalCode, code), eq(practices.portalEnabled, true), eq(practices.status, "active")));
  return p ?? null;
}

export type PortalPeople =
  | { ok: true; investorIds: string[]; people: { id: string; name: string }[]; familyName: string | null }
  | { ok: false; reason: "none" | "shared" };

/**
 * The clients an email may see in a practice: the clients with that email and their whole family. Runs as the
 * database owner (it decides the scope, like a team session's membership check).
 */
export async function peopleForEmail(practiceId: string, email: string): Promise<PortalPeople> {
  const e = normaliseEmail(email);
  if (!e) return { ok: false, reason: "none" };
  const matched = await db()
    .select({ id: investors.id, familyId: investors.familyId })
    .from(investors)
    .where(and(eq(investors.practiceId, practiceId), sql`lower(${investors.email}) = ${e}`));
  if (!matched.length) return { ok: false, reason: "none" };
  const groups = new Set(matched.map((m) => m.familyId ?? `self:${m.id}`));
  if (groups.size > 1) return { ok: false, reason: "shared" };
  const familyId = matched[0]!.familyId;
  const people = familyId
    ? await db()
        .select({ id: investors.id, name: investors.name })
        .from(investors)
        .where(and(eq(investors.practiceId, practiceId), eq(investors.familyId, familyId)))
        .orderBy(investors.name)
    : await db().select({ id: investors.id, name: investors.name }).from(investors).where(eq(investors.id, matched[0]!.id));
  const [family] = familyId ? await db().select({ name: families.name }).from(families).where(eq(families.id, familyId)) : [];
  return { ok: true, investorIds: people.map((p) => p.id), people, familyName: family?.name ?? null };
}

async function codeHash(practiceId: string, email: string, code: string): Promise<string> {
  return hmacHex(appEnv().SESSION_SECRET, `portal-code:${practiceId}:${normaliseEmail(email)}:${code}`);
}

/** A uniformly random 6-digit code. */
export function newPortalCode(): string {
  for (;;) {
    const b = randomBytes(4);
    const n = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
    // Reject the top sliver so every code is equally likely.
    if (n < 4294000000) return String(n % 1000000).padStart(6, "0");
  }
}

/** Makes a new code for this email (replacing any earlier unused one) and returns it, to be emailed. */
export async function issuePortalCode(practiceId: string, email: string): Promise<string> {
  const e = normaliseEmail(email);
  const code = newPortalCode();
  await db().transaction(async (tx) => {
    await tx.delete(portalCodes).where(and(eq(portalCodes.practiceId, practiceId), eq(portalCodes.email, e), isNull(portalCodes.usedAt)));
    await tx.insert(portalCodes).values({
      practiceId,
      email: e,
      codeHash: await codeHash(practiceId, e, code),
      expiresAt: new Date(Date.now() + CODE_MINUTES * 60 * 1000),
    });
  });
  return code;
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Checks a code. "used_up": no live code (expired, used, never asked, or 5 wrong tries): ask for a new one. */
export async function checkPortalCode(practiceId: string, email: string, code: string): Promise<"ok" | "wrong" | "used_up"> {
  const e = normaliseEmail(email);
  const [row] = await db()
    .select()
    .from(portalCodes)
    .where(and(eq(portalCodes.practiceId, practiceId), eq(portalCodes.email, e), isNull(portalCodes.usedAt), gt(portalCodes.expiresAt, new Date())))
    .orderBy(desc(portalCodes.createdAt))
    .limit(1);
  if (!row || row.attempts >= MAX_TRIES) return "used_up";
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6 || !sameText(await codeHash(practiceId, e, clean), row.codeHash)) {
    const [after] = await db()
      .update(portalCodes)
      .set({ attempts: sql`${portalCodes.attempts} + 1` })
      .where(eq(portalCodes.id, row.id))
      .returning({ attempts: portalCodes.attempts });
    return (after?.attempts ?? MAX_TRIES) >= MAX_TRIES ? "used_up" : "wrong";
  }
  // One use, even when two tabs send it at once.
  const used = await db()
    .update(portalCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(portalCodes.id, row.id), isNull(portalCodes.usedAt)))
    .returning({ id: portalCodes.id });
  return used.length ? "ok" : "used_up";
}

/** Asking for a code: 10 per network and 3 per email every 15 minutes, 10 per email a day. */
export async function mayAskForCode(practiceId: string, email: string, ip = clientIp()): Promise<boolean> {
  const e = normaliseEmail(email);
  return (
    (await underLimit(`portal:ask:ip:${ip}`, 10, 900)) &&
    (await underLimit(`portal:ask:email:${practiceId}:${e}`, 3, 900)) &&
    (await underLimit(`portal:ask:day:${practiceId}:${e}`, 10, 86400))
  );
}

/** Entering a code: 30 per network and 10 per email every 15 minutes (each code also allows only 5 tries). */
export async function mayEnterCode(practiceId: string, email: string, ip = clientIp()): Promise<boolean> {
  return (await underLimit(`portal:enter:ip:${ip}`, 30, 900)) && (await underLimit(`portal:enter:email:${practiceId}:${normaliseEmail(email)}`, 10, 900));
}

// ── Sessions ────────────────────────────────────────────────────────────────

async function tokenId(token: string): Promise<string> {
  return hmacHex(appEnv().SESSION_SECRET, `portal-session:${token}`);
}

export async function createPortalSession(practiceId: string, email: string): Promise<void> {
  // Housekeeping on the way: the hourly job doesn't run on Cloudflare Pages.
  await deleteExpiredPortalRows();
  const token = randomToken();
  await db()
    .insert(portalSessions)
    .values({
      id: await tokenId(token),
      practiceId,
      email: normaliseEmail(email),
      expiresAt: new Date(Date.now() + ABSOLUTE_MS),
      ip: clientIp(),
      userAgent: (getRequestHeader("user-agent") ?? "").slice(0, 300),
    });
  setCookie(PORTAL_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: ABSOLUTE_MS / 1000 });
}

/** The portal session behind this request, if any: practice (with its branding) and email. */
export async function getPortalSession() {
  const token = getCookie(PORTAL_COOKIE);
  if (!token || token.length > 100) return null;
  const id = await tokenId(token);
  const now = new Date();
  const [row] = await db()
    .select({
      id: portalSessions.id,
      email: portalSessions.email,
      lastSeenAt: portalSessions.lastSeenAt,
      practiceId: practices.id,
      name: practices.name,
      arn: practices.arn,
      euin: practices.euin,
      portalCode: practices.portalCode,
      enabled: practices.portalEnabled,
      status: practices.status,
    })
    .from(portalSessions)
    .innerJoin(practices, eq(practices.id, portalSessions.practiceId))
    .where(and(eq(portalSessions.id, id), gt(portalSessions.expiresAt, now)));
  if (!row) return null;
  // Idle too long, or the distributor turned the portal off (or the practice is suspended): signed out.
  if (now.getTime() - row.lastSeenAt.getTime() > IDLE_MS || !row.enabled || row.status !== "active") {
    await db().delete(portalSessions).where(eq(portalSessions.id, id));
    return null;
  }
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db().update(portalSessions).set({ lastSeenAt: now }).where(eq(portalSessions.id, id));
  }
  return { sessionId: row.id, email: row.email, practice: { id: row.practiceId, name: row.name, arn: row.arn, euin: row.euin, code: row.portalCode } };
}

export async function endPortalSession(): Promise<void> {
  const token = getCookie(PORTAL_COOKIE);
  if (token) await db().delete(portalSessions).where(eq(portalSessions.id, await tokenId(token)));
  deleteCookie(PORTAL_COOKIE, { path: "/", secure: true });
}

/**
 * The signed-in client's scope, worked out afresh: null when not signed in, or when the email no longer belongs
 * to exactly one client or family (the session then ends).
 */
export async function requirePortal(): Promise<
  (NonNullable<Awaited<ReturnType<typeof getPortalSession>>> & { scope: InvestorScope; people: { id: string; name: string }[]; familyName: string | null }) | null
> {
  const s = await getPortalSession();
  if (!s) return null;
  const who = await peopleForEmail(s.practice.id, s.email);
  if (!who.ok) {
    await endPortalSession();
    return null;
  }
  return { ...s, scope: { practiceId: s.practice.id, investorIds: who.investorIds }, people: who.people, familyName: who.familyName };
}

/** A short random code for a practice's portal link, e.g. folio.anqulas.com/c/k7m2q9xw. */
export function newPortalLinkCode(): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  return [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join("");
}

export async function deleteExpiredPortalRows(): Promise<void> {
  await db().delete(portalSessions).where(sql`${portalSessions.expiresAt} < now() or ${portalSessions.lastSeenAt} < now() - interval '3 days'`);
  await db().delete(portalCodes).where(sql`${portalCodes.expiresAt} < now() - interval '1 day'`);
}
