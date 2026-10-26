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

export type Member = { userId: string; practiceId: string; role: string; name: string };

export async function requireMember(roles?: readonly string[]): Promise<Member> {
  const s = await getSession();
  if (!s) throw redirect({ to: "/login" });
  if (!s.mfaPassed) throw redirect({ to: s.totpEnabled ? "/two-factor" : "/two-factor/setup" });
  if (!s.practiceId || !s.role) throw redirect({ to: "/login" });
  if (roles && !roles.includes(s.role)) throw new Error("Only the practice owner can do this.");
  return { userId: s.userId, practiceId: s.practiceId, role: s.role, name: s.name };
}

export async function cryptoFor(practiceId: string): Promise<PracticeCrypto> {
  const [p] = await db()
    .select({ key: practices.dataKeyWrapped })
    .from(practices)
    .where(eq(practices.id, practiceId));
  if (!p) throw new Error("Practice not found");
  return practiceCrypto(appEnv().MASTER_KEY, practiceId, p.key);
}
