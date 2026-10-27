/**
 * Sign-in sessions.
 *
 * The browser holds a random 256-bit token in a `__Host-` cookie (HTTPS only, this host only, not readable
 * by page scripts). The database stores only an HMAC of it, so a leaked sessions table cannot be used to
 * sign in. Sessions end after 7 days without use or 30 days in total, whichever comes first.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { deleteCookie, getCookie, getRequestHeader, getRequestIP, setCookie } from "@tanstack/react-start/server";
import { db } from "./db/client";
import { memberships, practices, sessions, users } from "./db/schema";
import { hmacHex, randomToken } from "./crypto";
import { appEnv } from "./env";

export const SESSION_COOKIE = "__Host-folio_session";
const IDLE_MS = 7 * 24 * 3600 * 1000;
const ABSOLUTE_MS = 30 * 24 * 3600 * 1000;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export type SessionInfo = {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  totpEnabled: boolean;
  /** This session entered an authenticator code. */
  codePassed: boolean;
  /** The practice requires an authenticator app from everyone. */
  totpRequired: boolean;
  /**
   * What the person must still do before seeing any data: enter a code (they have an authenticator), set one up
   * (their practice requires it), or nothing. The authenticator itself is optional unless the practice requires it.
   */
  step: "code" | "setup" | null;
  /** True when `step` is null: fully signed in. */
  mfaPassed: boolean;
  practiceId: string | null;
  practiceName: string | null;
  role: string | null;
  /** When the session started, or passed the authenticator step (sessions are re-created at that moment). */
  createdAt: Date;
};

async function tokenId(token: string): Promise<string> {
  return hmacHex(appEnv().SESSION_SECRET, `session:${token}`);
}

export async function createSession(userId: string, practiceId: string | null, mfaPassed: boolean): Promise<void> {
  const token = randomToken();
  await db()
    .insert(sessions)
    .values({
      id: await tokenId(token),
      userId,
      practiceId,
      mfaPassed,
      expiresAt: new Date(Date.now() + ABSOLUTE_MS),
      ip: getRequestIP({ xForwardedFor: false }) ?? getRequestHeader("cf-connecting-ip") ?? null,
      userAgent: (getRequestHeader("user-agent") ?? "").slice(0, 300),
    });
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ABSOLUTE_MS / 1000,
  });
}

export async function getSession(): Promise<SessionInfo | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const id = await tokenId(token);
  const now = new Date();
  const [row] = await db()
    .select({
      sessionId: sessions.id,
      createdAt: sessions.createdAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
      totpEnabledAt: users.totpEnabledAt,
      mfaPassed: sessions.mfaPassed,
      lastSeenAt: sessions.lastSeenAt,
      practiceId: sessions.practiceId,
      practiceName: practices.name,
      practiceStatus: practices.status,
      practiceRequireTotp: practices.requireTotp,
      role: memberships.role,
      memberActive: memberships.active,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(practices, eq(practices.id, sessions.practiceId))
    .leftJoin(
      memberships,
      and(eq(memberships.practiceId, sessions.practiceId), eq(memberships.userId, sessions.userId)),
    )
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)));
  if (!row) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > IDLE_MS) {
    await db().delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  // A removed team member, or a suspended practice, loses access at once.
  const practiceOk = row.practiceId !== null && row.memberActive === true && row.practiceStatus === "active";
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db().update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
  }
  const totpEnabled = row.totpEnabledAt !== null;
  const totpRequired = practiceOk && row.practiceRequireTotp === true;
  const step = totpEnabled ? (row.mfaPassed ? null : "code") : totpRequired ? "setup" : null;
  return {
    sessionId: row.sessionId,
    createdAt: row.createdAt,
    userId: row.userId,
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerifiedAt !== null,
    totpEnabled,
    codePassed: row.mfaPassed,
    totpRequired,
    step,
    mfaPassed: step === null,
    practiceId: practiceOk ? row.practiceId : null,
    practiceName: practiceOk ? row.practiceName : null,
    role: practiceOk ? row.role : null,
  };
}

export async function markMfaPassed(sessionId: string): Promise<void> {
  // A fresh token after the second step, so a token seen before it (e.g. on a shared computer) is useless.
  const [old] = await db().delete(sessions).where(eq(sessions.id, sessionId)).returning();
  if (!old) return;
  await createSession(old.userId, old.practiceId, true);
}

export async function endSession(): Promise<void> {
  const token = getCookie(SESSION_COOKIE);
  if (token) await db().delete(sessions).where(eq(sessions.id, await tokenId(token)));
  deleteCookie(SESSION_COOKIE, { path: "/", secure: true });
}

export async function endAllSessions(userId: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions(): Promise<void> {
  await db()
    .delete(sessions)
    .where(sql`${sessions.expiresAt} < now() or ${sessions.lastSeenAt} < now() - interval '7 days'`);
}
