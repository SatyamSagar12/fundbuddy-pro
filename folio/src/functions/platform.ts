/** Platform admin console: payments to confirm, trials, suspensions, authenticator resets. */
import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq, sql } from "drizzle-orm";

/** Drizzle prints a bare "id" inside sql``; subqueries below need the table name to be unambiguous. */
const PRACTICE_ID = sql.raw(`"practices"."id"`);
import { z } from "zod";
import { db } from "@/server/db/client";
import { investors, memberships, payments, practices, recoveryCodes, sessions, users } from "@/server/db/schema";
import { requirePlatformAdmin } from "@/server/platform";
import { applyPeriod, billingState } from "@/server/billing";
import { audit } from "@/server/security";
import { sendMail } from "@/server/mailer";
import { appEnv } from "@/server/env";
import { PLANS, PLAN_IDS, isPlanId, type PlanId } from "@/lib/plans";

async function ownerOf(practiceId: string) {
  const [o] = await db()
    .select({ email: users.email, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.practiceId, practiceId), eq(memberships.role, "owner")));
  return o ?? null;
}

export const getPlatform = createServerFn({ method: "GET" }).handler(async () => {
  await requirePlatformAdmin();
  const rows = await db()
    .select({
      id: practices.id,
      name: practices.name,
      arn: practices.arn,
      plan: practices.plan,
      status: practices.status,
      billingExempt: practices.billingExempt,
      trialEndsAt: practices.trialEndsAt,
      paidUntil: practices.paidUntil,
      createdAt: practices.createdAt,
      ownerEmail: sql<string | null>`(select u.email from memberships m join users u on u.id = m.user_id where m.practice_id = ${PRACTICE_ID} and m.role = 'owner' limit 1)`,
      members: sql<number>`(select count(*)::int from memberships m where m.practice_id = ${PRACTICE_ID} and m.active)`,
      clients: sql<number>`(select count(*)::int from investors i where i.practice_id = ${PRACTICE_ID})`,
      lastMonths: sql<number | null>`(select p.months from payments p where p.practice_id = ${PRACTICE_ID} and p.status = 'confirmed' order by p.decided_at desc limit 1)`,
    })
    .from(practices)
    .orderBy(desc(practices.createdAt))
    .limit(500);
  const list = rows.map((r) => ({ ...r, billing: billingState(r) }));
  const paying = list.filter((r) => r.billing.state === "active" && isPlanId(r.plan));
  const mrr = paying.reduce((sum, r) => {
    const plan = PLANS[r.plan as PlanId];
    return sum + (r.lastMonths === 12 ? plan.inr[12] / 12 : plan.inr[1]);
  }, 0);
  const pending = await db()
    .select({
      id: payments.id,
      practiceId: payments.practiceId,
      practiceName: practices.name,
      plan: payments.plan,
      months: payments.months,
      amountMinor: payments.amountMinor,
      reference: payments.reference,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .innerJoin(practices, eq(practices.id, payments.practiceId))
    .where(eq(payments.status, "pending"))
    .orderBy(payments.createdAt);
  const [userCount] = await db().select({ n: count() }).from(users);
  const [clientCount] = await db().select({ n: count() }).from(investors);
  const byState = list.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.billing.state]: (acc[r.billing.state] ?? 0) + 1 }), {});
  return {
    totals: { practices: list.length, users: userCount?.n ?? 0, clients: clientCount?.n ?? 0, mrr: Math.round(mrr), byState },
    pending,
    practices: list.map(({ billing, ...r }) => ({ ...r, state: billing.state, endsAt: billing.endsAt })),
  };
});

/** Confirm or reject a UPI payment after checking it arrived. Applied once, even if clicked twice. */
export const decidePayment = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.uuid(), decision: z.enum(["confirm", "reject"]) }).parse(input))
  .handler(async ({ data }) => {
    const admin = await requirePlatformAdmin();
    const result = await db().transaction(async (tx) => {
      const [pay] = await tx.select().from(payments).where(and(eq(payments.id, data.id), eq(payments.status, "pending"))).for("update");
      if (!pay) return null;
      await tx
        .update(payments)
        .set({ status: data.decision === "confirm" ? "confirmed" : "rejected", decidedBy: admin.email, decidedAt: new Date() })
        .where(eq(payments.id, pay.id));
      if (data.decision === "confirm") {
        const [p] = await tx.select().from(practices).where(eq(practices.id, pay.practiceId)).for("update");
        const plan = PLANS[pay.plan as PlanId];
        await tx.update(practices).set({ plan: plan.id, paidUntil: applyPeriod(p!, plan, pay.months) }).where(eq(practices.id, p!.id));
      }
      return pay;
    });
    if (!result) return { ok: false as const, error: "Already decided." };
    await audit(result.practiceId, null, `platform.payment_${data.decision}ed`, { target: result.id, meta: { admin: admin.email } });
    const owner = await ownerOf(result.practiceId);
    if (owner) {
      await sendMail({
        to: owner.email,
        subject: data.decision === "confirm" ? "Payment received: thank you" : "We couldn't find your payment",
        text:
          data.decision === "confirm"
            ? `Hello ${owner.name},\n\nWe received ₹${result.amountMinor / 100} (UTR ${result.reference}). Your plan is updated: see ${appEnv().APP_URL}/app/settings/billing.\n\nAnqulas Folio`
            : `Hello ${owner.name},\n\nWe couldn't find a payment with UTR ${result.reference}. Please check the number and enter it again at ${appEnv().APP_URL}/app/settings/billing, or reply with a screenshot of the payment.\n\nAnqulas Folio`,
      });
    }
    return { ok: true as const };
  });

const practiceInput = z.object({ practiceId: z.uuid() });

export const extendTrial = createServerFn({ method: "POST" })
  .validator((input: unknown) => practiceInput.extend({ days: z.number().int().min(1).max(90) }).parse(input))
  .handler(async ({ data }) => {
    const admin = await requirePlatformAdmin();
    const [p] = await db().select().from(practices).where(eq(practices.id, data.practiceId));
    if (!p) return { ok: false as const, error: "Not found." };
    const from = p.trialEndsAt && p.trialEndsAt > new Date() ? p.trialEndsAt : new Date();
    await db().update(practices).set({ trialEndsAt: new Date(from.getTime() + data.days * 86400000) }).where(eq(practices.id, p.id));
    await audit(p.id, null, "platform.trial_extended", { meta: { admin: admin.email, days: data.days } });
    return { ok: true as const };
  });

/** A plan paid outside the app (bank transfer, cash). */
export const recordPayment = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    practiceInput
      .extend({ plan: z.enum(PLAN_IDS as [string, ...string[]]), months: z.union([z.literal(1), z.literal(12)]), note: z.string().trim().max(200) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const admin = await requirePlatformAdmin();
    const plan = PLANS[data.plan as PlanId];
    await db().transaction(async (tx) => {
      const [p] = await tx.select().from(practices).where(eq(practices.id, data.practiceId)).for("update");
      if (!p) throw new Error("Not found");
      await tx.insert(payments).values({
        practiceId: p.id,
        plan: plan.id,
        months: data.months,
        amountMinor: plan.inr[data.months] * 100,
        currency: "INR",
        method: "recorded",
        status: "confirmed",
        decidedBy: admin.email,
        decidedAt: new Date(),
        note: data.note || null,
      });
      await tx.update(practices).set({ plan: plan.id, paidUntil: applyPeriod(p, plan, data.months) }).where(eq(practices.id, p.id));
    });
    await audit(data.practiceId, null, "platform.payment_recorded", { meta: { admin: admin.email, plan: plan.id, months: data.months } });
    return { ok: true as const };
  });

export const setPracticeStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => practiceInput.extend({ status: z.enum(["active", "suspended"]) }).parse(input))
  .handler(async ({ data }) => {
    const admin = await requirePlatformAdmin();
    await db().update(practices).set({ status: data.status }).where(eq(practices.id, data.practiceId));
    // Suspended: everyone in it is signed out of it at once.
    if (data.status === "suspended") await db().delete(sessions).where(eq(sessions.practiceId, data.practiceId));
    await audit(data.practiceId, null, `platform.practice_${data.status}`, { meta: { admin: admin.email } });
    return { ok: true as const };
  });

/**
 * For someone who lost their phone AND their recovery codes. Check who they are first (call the number
 * you know, not one in the email). They set up a new authenticator at their next sign-in.
 */
export const resetUserAuthenticator = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ email: z.string().trim().toLowerCase().max(254) }).parse(input))
  .handler(async ({ data }) => {
    const admin = await requirePlatformAdmin();
    const [u] = await db().select().from(users).where(eq(users.email, data.email));
    if (!u) return { ok: false as const, error: "No account with that email." };
    await db().update(users).set({ totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null }).where(eq(users.id, u.id));
    await db().delete(recoveryCodes).where(eq(recoveryCodes.userId, u.id));
    await db().delete(sessions).where(eq(sessions.userId, u.id));
    await audit(null, u.id, "platform.totp_reset", { meta: { admin: admin.email } });
    await sendMail({
      to: u.email,
      subject: "Security notice: your authenticator was reset",
      text: `Hello ${u.name},\n\nAt your request, Anqulas Folio support removed the authenticator app from your account. Sign in at ${appEnv().APP_URL}/login and set up a new one.\n\nIf you didn't ask for this, reply to this email straight away.\n\nAnqulas Folio`,
    });
    return { ok: true as const };
  });
