/**
 * Recovery codes, the audit log helper and security emails.
 *
 * Recovery codes: 10 one-time codes shown once when the authenticator is set up. Using one removes the old
 * authenticator and makes the person set up a new one straight away. Only HMACs are stored.
 */
import { and, count, eq, isNull } from "drizzle-orm";
import { getRequestHeader } from "@tanstack/react-start/server";
import { db } from "./db/client";
import { auditLog, recoveryCodes } from "./db/schema";
import { hmacHex, randomBytes } from "./crypto";
import { appEnv, appUrl } from "./env";
import { sendMail } from "./mailer";

/** No 0/O, 1/I/L: easy to read aloud and type from paper. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODES = 10;

function newCode(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

function normalise(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

async function codeHash(userId: string, code: string): Promise<string> {
  return hmacHex(appEnv().SESSION_SECRET, `recovery:${userId}:${normalise(code)}`);
}

/** Replaces all of a user's recovery codes; returns the new ones to show once. */
export async function newRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: CODES }, newCode);
  const hashes = await Promise.all(codes.map((c) => codeHash(userId, c)));
  await db().transaction(async (tx) => {
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.insert(recoveryCodes).values(hashes.map((h) => ({ userId, codeHash: h })));
  });
  return codes;
}

/** Marks a code used. True only for an unused code of this user (a code works once, even in a race). */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  if (normalise(code).length !== 10) return false;
  const used = await db()
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        eq(recoveryCodes.codeHash, await codeHash(userId, code)),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return used.length === 1;
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return row?.n ?? 0;
}

export function clientIp(): string {
  try {
    return getRequestHeader("cf-connecting-ip") ?? "local";
  } catch {
    // Outside a web request (scripts, tests).
    return "local";
  }
}

/** Appends to the audit log as the owner role (works for account events without a practice too). */
export async function audit(
  practiceId: string | null,
  userId: string | null,
  action: string,
  extra: { target?: string; meta?: Record<string, unknown> } = {},
): Promise<void> {
  await db()
    .insert(auditLog)
    .values({ practiceId, userId, action, target: extra.target ?? null, meta: extra.meta ?? null, ip: clientIp() });
}

/** Tells the account owner about a change to how they sign in. */
export async function securityEmail(to: string, name: string, what: string): Promise<void> {
  await sendMail({
    to,
    subject: `Security notice: ${what}`,
    text: `Hello ${name},\n\n${what} on your Anqulas Folio account (${new Date().toUTCString()}).\n\nIf this was you, no action is needed. If it wasn't, reset your password at ${appUrl()}/forgot-password straight away and tell your practice owner.\n\nAnqulas Folio`,
  });
}
