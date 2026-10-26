/**
 * Team: the owner invites staff and sub-brokers, changes roles, and switches people off.
 * Sub-brokers see only the clients assigned to them (enforced by the database, migration 0003).
 */
import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { invites, investors, memberships, practices, sessions, users } from "@/server/db/schema";
import { requireMember, scopeOf } from "@/server/member";
import { billingFor, seatsUsed } from "@/server/billing";
import { hmacHex, randomToken } from "@/server/crypto";
import { appEnv } from "@/server/env";
import { sendMail } from "@/server/mailer";
import { audit, clientIp } from "@/server/security";
import { underLimit } from "@/server/rate-limit";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/password";

const INVITE_DAYS = 7;
const inviteRole = z.enum(["staff", "subbroker"]);

async function inviteId(token: string) {
  return hmacHex(appEnv().SESSION_SECRET, `invite:${token}`);
}

export const getTeam = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember();
  const members = await db()
    .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, active: memberships.active })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.practiceId, m.practiceId))
    .orderBy(asc(memberships.createdAt));
  const canManage = m.role === "owner";
  const pending = canManage
    ? await db()
        .select({ id: invites.id, email: invites.email, role: invites.role, expiresAt: invites.expiresAt })
        .from(invites)
        .where(
          and(
            eq(invites.practiceId, m.practiceId),
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
    : [];
  const billing = await billingFor(m.practiceId);
  return {
    me: m.userId,
    canManage,
    members: members.map((x) => ({ ...x, isMe: x.userId === m.userId })),
    pending,
    seats: { used: await seatsUsed(m.practiceId), max: billing.limits.users },
  };
});

export const inviteMember = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        email: z.string().trim().toLowerCase().max(254).pipe(z.email({ message: "Enter a valid email address." })),
        role: inviteRole,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const m = await requireMember(["owner"]);
    if (!(await underLimit(`invite:${m.practiceId}`, 20, 86400))) {
      return { ok: false as const, error: "Too many invitations today. Try again tomorrow." };
    }
    const billing = await billingFor(m.practiceId);
    if ((await seatsUsed(m.practiceId)) >= billing.limits.users) {
      return {
        ok: false as const,
        error: `Your plan allows ${billing.limits.users} team member${billing.limits.users > 1 ? "s" : ""}. Choose a bigger plan in Billing.`,
      };
    }
    const [already] = await db()
      .select({ active: memberships.active })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.practiceId, m.practiceId), eq(users.email, data.email)));
    if (already?.active) return { ok: false as const, error: "That person is already in your team." };

    // A new invitation for the same email replaces the old one.
    await db()
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.practiceId, m.practiceId), eq(invites.email, data.email), isNull(invites.acceptedAt)));
    const token = randomToken();
    await db()
      .insert(invites)
      .values({
        id: await inviteId(token),
        practiceId: m.practiceId,
        email: data.email,
        role: data.role,
        invitedBy: m.userId,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86400000),
      });
    const [p] = await db().select({ name: practices.name }).from(practices).where(eq(practices.id, m.practiceId));
    await sendMail({
      to: data.email,
      subject: `${m.name} invited you to ${p!.name} on Anqulas Folio`,
      text: `Hello,\n\n${m.name} invited you to join ${p!.name} on Anqulas Folio as ${data.role === "subbroker" ? "a sub-broker (you'll see only the clients assigned to you)" : "staff"}.\n\nAccept the invitation:\n${appEnv().APP_URL}/invite?token=${encodeURIComponent(token)}\n\nThe link works for ${INVITE_DAYS} days.\n\nAnqulas Folio`,
    });
    await audit(m.practiceId, m.userId, "team.invited", { target: data.email, meta: { role: data.role } });
    return { ok: true as const };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().max(100) }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner"]);
    await db()
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.id, data.id), eq(invites.practiceId, m.practiceId)));
    await audit(m.practiceId, m.userId, "team.invite_revoked");
    return { ok: true as const };
  });

export const updateMember = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ userId: z.uuid(), role: inviteRole.optional(), active: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const m = await requireMember(["owner"]);
    if (data.userId === m.userId) return { ok: false as const, error: "You can't change your own access." };
    const [target] = await db()
      .select()
      .from(memberships)
      .where(and(eq(memberships.practiceId, m.practiceId), eq(memberships.userId, data.userId)));
    if (!target) return { ok: false as const, error: "Not found." };
    if (target.role === "owner") return { ok: false as const, error: "The owner's access can't be changed." };
    if (data.active === true && !target.active) {
      const billing = await billingFor(m.practiceId);
      if ((await seatsUsed(m.practiceId)) >= billing.limits.users) {
        return { ok: false as const, error: `Your plan allows ${billing.limits.users} team members.` };
      }
    }
    await db()
      .update(memberships)
      .set({ ...(data.role ? { role: data.role } : {}), ...(data.active !== undefined ? { active: data.active } : {}) })
      .where(eq(memberships.id, target.id));
    // Switched off: signed out of this practice at once.
    if (data.active === false) {
      await db()
        .delete(sessions)
        .where(and(eq(sessions.userId, data.userId), eq(sessions.practiceId, m.practiceId)));
    }
    await audit(m.practiceId, m.userId, "team.member_updated", { target: data.userId, meta: { role: data.role, active: data.active } });
    return { ok: true as const };
  });

/** Who looks after a client. A sub-broker sees only clients assigned to them. */
export const assignClient = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ investorId: z.uuid(), userId: z.uuid().nullable() }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner", "staff"]);
    if (data.userId) {
      const [member] = await db()
        .select()
        .from(memberships)
        .where(
          and(eq(memberships.practiceId, m.practiceId), eq(memberships.userId, data.userId), eq(memberships.active, true)),
        );
      if (!member) return { ok: false as const, error: "That person isn't an active team member." };
    }
    const changed = await withPractice(scopeOf(m), (tx) =>
      tx.update(investors).set({ assignedUserId: data.userId, updatedAt: new Date() }).where(eq(investors.id, data.investorId)).returning({ id: investors.id }),
    );
    if (!changed.length) return { ok: false as const, error: "Client not found." };
    await audit(m.practiceId, m.userId, "client.assigned", { target: data.investorId, meta: { to: data.userId } });
    return { ok: true as const };
  });

// ── Accepting an invitation (signed out) ─────────────────────────────────────

async function openInvite(token: string) {
  const [row] = await db()
    .select({
      id: invites.id,
      practiceId: invites.practiceId,
      email: invites.email,
      role: invites.role,
      practiceName: practices.name,
    })
    .from(invites)
    .innerJoin(practices, eq(practices.id, invites.practiceId))
    .where(
      and(
        eq(invites.id, await inviteId(token)),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

const tokenInput = z.object({ token: z.string().min(20).max(100) });

export const getInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) => tokenInput.parse(input))
  .handler(async ({ data }) => {
    if (!(await underLimit(`invite-open:${clientIp()}`, 30, 3600))) return null;
    const inv = await openInvite(data.token);
    if (!inv) return null;
    const [user] = await db().select({ id: users.id }).from(users).where(eq(users.email, inv.email));
    return { practiceName: inv.practiceName, email: inv.email, role: inv.role, hasAccount: Boolean(user) };
  });

export const acceptInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    tokenInput.extend({ name: z.string().trim().max(100).optional(), password: z.string().max(200) }).parse(input),
  )
  .handler(async ({ data }) => {
    if (!(await underLimit(`invite-accept:${clientIp()}`, 10, 900))) {
      return { ok: false as const, error: "Too many attempts. Wait 15 minutes." };
    }
    const inv = await openInvite(data.token);
    if (!inv) return { ok: false as const, error: "This invitation has expired or was withdrawn. Ask for a new one." };
    let [user] = await db().select().from(users).where(eq(users.email, inv.email));
    if (user) {
      if (!(await verifyPassword(data.password, user.passwordHash))) {
        return { ok: false as const, error: "Wrong password for this account." };
      }
      // Receiving the invitation at this address proves the person owns it.
      if (!user.emailVerifiedAt) await db().update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
    } else {
      if (!data.name || data.name.length < 2) return { ok: false as const, error: "Enter your name." };
      const problem = passwordProblem(data.password, inv.email);
      if (problem) return { ok: false as const, error: problem };
      [user] = await db()
        .insert(users)
        .values({ email: inv.email, name: data.name, passwordHash: await hashPassword(data.password), emailVerifiedAt: new Date() })
        .returning();
    }
    const claimed = await db()
      .update(invites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invites.id, inv.id), isNull(invites.acceptedAt)))
      .returning({ id: invites.id });
    if (!claimed.length) return { ok: false as const, error: "This invitation was already used." };
    await db()
      .insert(memberships)
      .values({ practiceId: inv.practiceId, userId: user!.id, role: inv.role })
      .onConflictDoUpdate({ target: [memberships.practiceId, memberships.userId], set: { role: inv.role, active: true } });
    await audit(inv.practiceId, user!.id, "team.joined", { meta: { role: inv.role } });
    return { ok: true as const };
  });
