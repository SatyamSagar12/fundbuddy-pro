/**
 * Sign-up, email verification, sign-in and the authenticator step.
 *
 * Rules:
 *  - Every account must confirm its email, then set up an authenticator app before seeing any data.
 *  - Answers never reveal whether an email has an account (same message, similar timing).
 *  - Attempts are rate-limited per network and per account; 10 wrong passwords lock the account 15 minutes.
 */
import { createServerFn } from "@tanstack/react-start";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import QRCode from "qrcode";
import { db } from "@/server/db/client";
import { emailTokens, memberships, practices, recoveryCodes, users } from "@/server/db/schema";
import { appEnv } from "@/server/env";
import { hmacHex, newWrappedDataKey, randomToken, sealWithMaster } from "@/server/crypto";
import { dummyPasswordHash, hashPassword, passwordProblem, verifyPassword } from "@/server/password";
import { newTotpSecret, otpauthUrl } from "@/server/totp";
import { checkCode } from "@/server/two-factor";
import { billingFor } from "@/server/billing";
import { createSession, endAllSessions, endSession, getSession, markMfaPassed } from "@/server/session";
import { audit, clientIp, newRecoveryCodes, securityEmail, consumeRecoveryCode } from "@/server/security";
import { underLimit } from "@/server/rate-limit";
import { sendMail } from "@/server/mailer";

const TRIAL_DAYS = 30;
const VERIFY_HOURS = 48;
const LOCK_AFTER = 10;
const LOCK_MINUTES = 15;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

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
    await audit(practiceId, userId, "practice.created");
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
      .select({ practiceId: memberships.practiceId, requireTotp: practices.requireTotp })
      .from(memberships)
      .innerJoin(practices, eq(practices.id, memberships.practiceId))
      .where(and(eq(memberships.userId, user.id), eq(memberships.active, true)))
      .orderBy(memberships.createdAt)
      .limit(1);
    await createSession(user.id, membership?.practiceId ?? null, false);
    // The authenticator is optional: with one, the code comes next; without one, the person is signed in,
    // unless their practice requires an authenticator, in which case they set one up first.
    if (user.totpEnabledAt) return { ok: true, next: "/two-factor" };
    if (membership?.requireTotp) return { ok: true, next: "/two-factor/setup" };
    await audit(membership?.practiceId ?? null, user.id, "user.signed_in");
    return { ok: true, next: "/app" };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  await endSession();
  return { ok: true as const };
});

/** Who is signed in, for route guards. Never includes secrets. */
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const s = await getSession();
  if (!s) return null;
  const billing = s.practiceId && s.mfaPassed ? await billingFor(s.practiceId) : null;
  return {
    billing: billing && { state: billing.state, endsAt: billing.endsAt, locksAt: billing.locksAt },
    name: s.name,
    email: s.email,
    totpEnabled: s.totpEnabled,
    totpRequired: s.totpRequired,
    /** null = fully signed in; "code" = enter the authenticator code; "setup" = the practice requires one. */
    step: s.step,
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

export const confirmTotpSetup = createServerFn({ method: "POST" })
  .validator((input: unknown) => codeInput.parse(input))
  .handler(async ({ data }): Promise<Result<{ recoveryCodes: string[] }>> => {
    const s = await getSession();
    if (!s) return { ok: false, error: "Sign in again." };
    if (s.totpEnabled) return { ok: false, error: "Your authenticator is already set up." };
    if (!(await checkCode(s.userId, data.code))) {
      return { ok: false, error: "That code didn't match. Check the time on your phone and try the newest code." };
    }
    await db().update(users).set({ totpEnabledAt: new Date() }).where(eq(users.id, s.userId));
    await markMfaPassed(s.sessionId);
    const codes = await newRecoveryCodes(s.userId);
    await audit(s.practiceId, s.userId, "user.totp_enabled");
    return { ok: true, recoveryCodes: codes };
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
    await audit(s.practiceId, s.userId, "user.signed_in");
    return { ok: true };
  });

/**
 * Lost phone: a recovery code (after the password) removes the old authenticator. The person must set up a
 * new one straight away, which also issues new recovery codes. The account owner is emailed.
 */
export const redeemRecoveryCode = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ code: z.string().trim().max(20) }).parse(input))
  .handler(async ({ data }): Promise<Result> => {
    const s = await getSession();
    if (!s) return { ok: false, error: "Sign in again." };
    if (!s.totpEnabled) return { ok: false, error: "Set up your authenticator first." };
    if (!(await underLimit(`recovery:${s.userId}`, 5, 3600)) || !(await consumeRecoveryCode(s.userId, data.code))) {
      return { ok: false, error: "That recovery code didn't work. Each code works once." };
    }
    await db()
      .update(users)
      .set({ totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null })
      .where(eq(users.id, s.userId));
    await db().delete(recoveryCodes).where(eq(recoveryCodes.userId, s.userId));
    await audit(s.practiceId, s.userId, "user.totp_reset_with_recovery_code");
    await securityEmail(s.email, s.name, "A recovery code was used and your authenticator app was removed");
    return { ok: true };
  });

// ── Password reset ──────────────────────────────────────────────────────────

const RESET_MINUTES = 60;

/** Always answers the same, whether or not the email has an account. */
export const forgotPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ email }).parse(input))
  .handler(async ({ data }): Promise<Result> => {
    const allowed =
      (await underLimit(`forgot:ip:${clientIp()}`, 10, 3600)) && (await underLimit(`forgot:${data.email}`, 3, 3600));
    if (!allowed) return { ok: true };
    const [user] = await db().select().from(users).where(eq(users.email, data.email));
    if (!user?.emailVerifiedAt) return { ok: true };
    const token = randomToken();
    await db()
      .insert(emailTokens)
      .values({
        id: await tokenHash(token),
        userId: user.id,
        purpose: "reset",
        expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000),
      });
    await sendMail({
      to: user.email,
      subject: "Reset your Anqulas Folio password",
      text: `Hello ${user.name},\n\nTo choose a new password, open:\n${appEnv().APP_URL}/reset-password?token=${encodeURIComponent(token)}\n\nThe link works for ${RESET_MINUTES} minutes, once. If you didn't ask for this, ignore this email; your password stays the same.\n\nAnqulas Folio`,
    });
    return { ok: true };
  });

export const resetPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ token: z.string().min(20).max(100), password: z.string().max(200) }).parse(input),
  )
  .handler(async ({ data }): Promise<Result> => {
    const id = await tokenHash(data.token);
    const [row] = await db()
      .select({ userId: emailTokens.userId, email: users.email, name: users.name })
      .from(emailTokens)
      .innerJoin(users, eq(users.id, emailTokens.userId))
      .where(
        and(
          eq(emailTokens.id, id),
          eq(emailTokens.purpose, "reset"),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, new Date()),
        ),
      );
    if (!row) return { ok: false, error: "This link has expired or was already used. Ask for a new one." };
    const problem = passwordProblem(data.password, row.email);
    if (problem) return { ok: false, error: problem };
    const claimed = await db()
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(emailTokens.id, id), isNull(emailTokens.usedAt)))
      .returning({ id: emailTokens.id });
    if (claimed.length !== 1) return { ok: false, error: "This link was already used. Ask for a new one." };
    await db()
      .update(users)
      .set({ passwordHash: await hashPassword(data.password), failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, row.userId));
    // Every device is signed out. The authenticator is still needed at the next sign-in.
    await endAllSessions(row.userId);
    await audit(null, row.userId, "user.password_reset");
    await securityEmail(row.email, row.name, "Your password was changed");
    return { ok: true };
  });

/** Turns the authenticator off (needs a current code). Not allowed when the practice requires one. */
export const disableTotp = createServerFn({ method: "POST" })
  .validator((input: unknown) => codeInput.parse(input))
  .handler(async ({ data }): Promise<Result> => {
    const s = await getSession();
    if (!s || !s.mfaPassed) return { ok: false, error: "Sign in again." };
    if (!s.totpEnabled) return { ok: false, error: "Your authenticator is already off." };
    if (s.totpRequired) return { ok: false, error: "Your practice requires an authenticator app, so it can't be turned off." };
    if (!(await checkCode(s.userId, data.code))) {
      return { ok: false, error: "That code didn't match. Try the newest code in your app." };
    }
    await db().update(users).set({ totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null }).where(eq(users.id, s.userId));
    await db().delete(recoveryCodes).where(eq(recoveryCodes.userId, s.userId));
    await audit(s.practiceId, s.userId, "user.totp_disabled");
    await securityEmail(s.email, s.name, "The authenticator app was turned off");
    return { ok: true };
  });
