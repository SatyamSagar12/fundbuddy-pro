/**
 * Sign-up, email verification, sign-in and the authenticator step.
 *
 * Rules:
 *  - Every account must confirm its email, then set up an authenticator app before seeing any data.
 *  - Answers never reveal whether an email has an account (same message, similar timing).
 *  - Attempts are rate-limited per network and per account; 10 wrong passwords lock the account 15 minutes.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import QRCode from "qrcode";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { auditLog, emailTokens, memberships, practices, users } from "@/server/db/schema";
import { appEnv } from "@/server/env";
import { hmacHex, newWrappedDataKey, openWithMaster, randomToken, sealWithMaster } from "@/server/crypto";
import { dummyPasswordHash, hashPassword, passwordProblem, verifyPassword } from "@/server/password";
import { newTotpSecret, otpauthUrl, verifyTotp } from "@/server/totp";
import { createSession, endSession, getSession, markMfaPassed } from "@/server/session";
import { underLimit } from "@/server/rate-limit";
import { sendMail } from "@/server/mailer";

const TRIAL_DAYS = 30;
const VERIFY_HOURS = 48;
const LOCK_AFTER = 10;
const LOCK_MINUTES = 15;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function clientIp(): string {
  return getRequestHeader("cf-connecting-ip") ?? "local";
}

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: "Enter a valid email address." }));

async function tokenHash(token: string): Promise<string> {
  return hmacHex(appEnv().SESSION_SECRET, `email-token:${token}`);
}

async function sendVerification(userId: string, to: string, name: string): Promise<void> {
  const token = randomToken();
  await db()
    .insert(emailTokens)
    .values({
      id: await tokenHash(token),
      userId,
      purpose: "verify",
      expiresAt: new Date(Date.now() + VERIFY_HOURS * 3600 * 1000),
    });
  const link = `${appEnv().APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to,
    subject: "Confirm your email for Anqulas Folio",
    text: `Hello ${name},\n\nConfirm your email to finish setting up Anqulas Folio:\n${link}\n\nThe link works for ${VERIFY_HOURS} hours. If you didn't sign up, ignore this email.\n\nAnqulas Folio`,
  });
}

// ── Sign-up ─────────────────────────────────────────────────────────────────

const signupInput = z.object({
  practiceName: z.string().trim().min(2, "Enter your practice or business name.").max(120),
  name: z.string().trim().min(2, "Enter your name.").max(100),
  email,
  password: z.string().max(200),
  arn: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^(ARN-?\d{1,8})?$/, "ARN looks like ARN-123456.")
    .optional(),
});

export const signup = createServerFn({ method: "POST" })
  .validator((input: unknown) => signupInput.parse(input))
  .handler(async ({ data }): Promise<Result> => {
    if (!(await underLimit(`signup:ip:${clientIp()}`, 5, 3600))) {
      return { ok: false, error: "Too many sign-ups from this network. Try again in an hour." };
    }
    const problem = passwordProblem(data.password, data.email);
    if (problem) return { ok: false, error: problem };

    const [existing] = await db().select().from(users).where(eq(users.email, data.email));
    if (existing?.emailVerifiedAt) {
      // Never reveal that the account exists: tell the owner by email instead.
      await sendMail({
        to: data.email,
        subject: "You already have an Anqulas Folio account",
        text: `Someone (probably you) tried to sign up again with this email.\nSign in at ${appEnv().APP_URL}/login. If you forgot your password, use "Forgot password" there.\n\nAnqulas Folio`,
      });
      return { ok: true };
    }
    if (existing) {
      // An unconfirmed earlier sign-up: replace it, so nobody can squat an address they don't own.
      const owned = await db()
        .select({ practiceId: memberships.practiceId })
        .from(memberships)
        .where(and(eq(memberships.userId, existing.id), eq(memberships.role, "owner")));
      await db().delete(users).where(eq(users.id, existing.id));
      for (const m of owned) await db().delete(practices).where(eq(practices.id, m.practiceId));
    }

    const practiceId = crypto.randomUUID();
    const passwordHash = await hashPassword(data.password);
    const userId = await db().transaction(async (tx) => {
      await tx.insert(practices).values({
        id: practiceId,
        name: data.practiceName,
        arn: data.arn ? data.arn.replace(/^ARN-?/, "ARN-") : null,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 3600 * 1000),
        dataKeyWrapped: await newWrappedDataKey(appEnv().MASTER_KEY, practiceId),
      });
      const [user] = await tx
        .insert(users)
        .values({ email: data.email, name: data.name, passwordHash })
        .returning({ id: users.id });
      await tx.insert(memberships).values({ practiceId, userId: user!.id, role: "owner" });
      return user!.id;
    });
    await withPractice(practiceId, (tx) =>
      tx.insert(auditLog).values({ practiceId, userId, action: "practice.created", ip: clientIp() }),
    );
    await sendVerification(userId, data.email, data.name);
    return { ok: true };
  });

export const resendVerification = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ email }).parse(input))
  .handler(async ({ data }): Promise<Result> => {
    if (!(await underLimit(`resend:${data.email}`, 3, 3600))) return { ok: true };
    const [user] = await db().select().from(users).where(eq(users.email, data.email));
    if (user && !user.emailVerifiedAt) await sendVerification(user.id, user.email, user.name);
    return { ok: true };
  });

/** Called by the button on /verify-email, never by merely opening the link (mail scanners open links). */
export const verifyEmail = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: z.string().min(20).max(100) }).parse(input))
  .handler(async ({ data }): Promise<Result> => {
    const id = await tokenHash(data.token);
    const [row] = await db()
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailTokens.id, id),
          eq(emailTokens.purpose, "verify"),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: emailTokens.userId });
    if (!row) return { ok: false, error: "This link has expired or was already used. Sign in to get a new one." };
    await db().update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
    return { ok: true };
  });

// ── Sign-in ─────────────────────────────────────────────────────────────────

const WRONG = "Wrong email or password.";

export const login = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ email, password: z.string().max(200) }).parse(input))
  .handler(async ({ data }): Promise<Result<{ next: string }>> => {
    if (!(await underLimit(`login:ip:${clientIp()}`, 30, 900))) {
      return { ok: false, error: "Too many attempts from this network. Wait 15 minutes." };
    }
    const [user] = await db().select().from(users).where(eq(users.email, data.email));
    if (!user) {
      await verifyPassword(data.password, await dummyPasswordHash());
      return { ok: false, error: WRONG };
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return { ok: false, error: `Too many wrong passwords. Try again after ${LOCK_MINUTES} minutes.` };
    }
    if (!(await verifyPassword(data.password, user.passwordHash))) {
      const failed = user.failedLogins + 1;
      await db()
        .update(users)
        .set({
          failedLogins: failed >= LOCK_AFTER ? 0 : failed,
          lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
        })
        .where(eq(users.id, user.id));
      return { ok: false, error: WRONG };
    }
    if (!user.emailVerifiedAt) {
      return { ok: false, error: "Confirm your email first. We can send the link again." };
    }
    await db().update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
    const [membership] = await db()
      .select({ practiceId: memberships.practiceId })
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.active, true)))
      .orderBy(memberships.createdAt)
      .limit(1);
    await createSession(user.id, membership?.practiceId ?? null, false);
    return { ok: true, next: user.totpEnabledAt ? "/two-factor" : "/two-factor/setup" };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  await endSession();
  return { ok: true as const };
});

/** Who is signed in, for route guards. Never includes secrets. */
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const s = await getSession();
  if (!s) return null;
  return {
    name: s.name,
    email: s.email,
    totpEnabled: s.totpEnabled,
    mfaPassed: s.mfaPassed,
    practiceName: s.practiceName,
    role: s.role,
    hasPractice: s.practiceId !== null,
  };
});

// ── Authenticator ───────────────────────────────────────────────────────────

/** Starts (or restarts) authenticator setup: a new secret, shown once as a QR code. */
export const startTotpSetup = createServerFn({ method: "POST" }).handler(
  async (): Promise<Result<{ qrSvg: string; secret: string }>> => {
    const s = await getSession();
    if (!s) return { ok: false, error: "Sign in again." };
    if (s.totpEnabled) return { ok: false, error: "Your authenticator is already set up." };
    const secret = newTotpSecret();
    await db()
      .update(users)
      .set({ totpSecretEnc: await sealWithMaster(appEnv().MASTER_KEY, secret, `totp:${s.userId}`), totpLastStep: null })
      .where(eq(users.id, s.userId));
    const qrSvg = await QRCode.toString(otpauthUrl(secret, s.email), { type: "svg", margin: 1, width: 200 });
    return { ok: true, qrSvg, secret: secret.replace(/(.{4})/g, "$1 ").trim() };
  },
);

const codeInput = z.object({ code: z.string().trim().max(10) });

async function checkCode(userId: string, code: string): Promise<boolean> {
  if (!(await underLimit(`totp:${userId}`, 6, 300))) return false;
  const [user] = await db().select().from(users).where(eq(users.id, userId));
  if (!user?.totpSecretEnc) return false;
  const secret = await openWithMaster(appEnv().MASTER_KEY, user.totpSecretEnc, `totp:${userId}`);
  const step = await verifyTotp(secret, code, user.totpLastStep ?? null);
  if (step === null) return false;
  // Only one request can claim a step: the update matches nothing if another request already stored this
  // step or a later one, so two simultaneous requests with the same code cannot both succeed.
  const claimed = await db()
    .update(users)
    .set({ totpLastStep: step })
    .where(
      and(
        eq(users.id, userId),
        eq(users.totpSecretEnc, user.totpSecretEnc),
        or(isNull(users.totpLastStep), lt(users.totpLastStep, step)),
      ),
    )
    .returning({ id: users.id });
  return claimed.length === 1;
}

export const confirmTotpSetup = createServerFn({ method: "POST" })
  .validator((input: unknown) => codeInput.parse(input))
  .handler(async ({ data }): Promise<Result> => {
    const s = await getSession();
    if (!s) return { ok: false, error: "Sign in again." };
    if (s.totpEnabled) return { ok: false, error: "Your authenticator is already set up." };
    if (!(await checkCode(s.userId, data.code))) {
      return { ok: false, error: "That code didn't match. Check the time on your phone and try the newest code." };
    }
    await db().update(users).set({ totpEnabledAt: new Date() }).where(eq(users.id, s.userId));
    await markMfaPassed(s.sessionId);
    if (s.practiceId) {
      const practiceId = s.practiceId;
      await withPractice(practiceId, (tx) =>
        tx.insert(auditLog).values({ practiceId, userId: s.userId, action: "user.totp_enabled", ip: clientIp() }),
      );
    }
    return { ok: true };
  });

export const verifyTotpCode = createServerFn({ method: "POST" })
  .validator((input: unknown) => codeInput.parse(input))
  .handler(async ({ data }): Promise<Result> => {
    const s = await getSession();
    if (!s) return { ok: false, error: "Sign in again." };
    if (!s.totpEnabled) return { ok: false, error: "Set up your authenticator first." };
    if (!(await checkCode(s.userId, data.code))) {
      return { ok: false, error: "That code didn't match. Try the newest code in your app." };
    }
    await markMfaPassed(s.sessionId);
    if (s.practiceId) {
      const practiceId = s.practiceId;
      await withPractice(practiceId, (tx) =>
        tx.insert(auditLog).values({ practiceId, userId: s.userId, action: "user.signed_in", ip: clientIp() }),
      );
    }
    return { ok: true };
  });
