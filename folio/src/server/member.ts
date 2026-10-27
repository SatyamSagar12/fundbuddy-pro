/**
 * The signed-in team member behind a request. Every server function that touches practice data starts with
 * `requireMember()`: it needs a valid session, a passed authenticator step and an active membership.
 */
import { redirect } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { getSession } from "./session";
import { db } from "./db/client";
import { practices } from "./db/schema";
import { practiceCrypto, type PracticeCrypto } from "./crypto";
import { appEnv } from "./env";
import type { Scope } from "./db/scope";
import { billingFor } from "./billing";

export type Member = { userId: string; practiceId: string; role: string; name: string; email: string };

export type Role = "owner" | "staff" | "subbroker";
export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", staff: "Staff", subbroker: "Sub-broker" };

/** The database scope for this member: sub-brokers see only the clients assigned to them. */
export function scopeOf(m: Member): Scope {
  return { practiceId: m.practiceId, userId: m.userId, limited: m.role === "subbroker" };
}

/**
 * @param options.allowLocked  billing pages must still work when the practice is locked for non-payment.
 */
export async function requireMember(
  roles?: readonly string[],
  options: { allowLocked?: boolean } = {},
): Promise<Member> {
  const s = await getSession();
  if (!s) throw redirect({ to: "/login" });
  if (s.step) throw redirect({ to: s.step === "code" ? "/two-factor" : "/two-factor/setup" });
  if (!s.practiceId || !s.role) throw redirect({ to: "/no-access" });
  if (roles && !roles.includes(s.role)) throw new Error("Only the practice owner can do this.");
  if (!options.allowLocked && (await billingFor(s.practiceId)).state === "locked") {
    throw redirect({ to: s.role === "owner" ? "/app/settings/billing" : "/locked" });
  }
  return { userId: s.userId, practiceId: s.practiceId, role: s.role, name: s.name, email: s.email };
}

export async function cryptoFor(practiceId: string): Promise<PracticeCrypto> {
  const [p] = await db()
    .select({ key: practices.dataKeyWrapped })
    .from(practices)
    .where(eq(practices.id, practiceId));
  if (!p) throw new Error("Practice not found");
  return practiceCrypto(appEnv().MASTER_KEY, practiceId, p.key);
}
