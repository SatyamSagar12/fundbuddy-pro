/**
 * Plan payments by UPI to the platform's UPI ID. The owner pays in any UPI app, then enters the UTR
 * (12-digit transaction reference). The platform admin checks it arrived and confirms; only then is the
 * period extended. Amounts always come from src/lib/plans.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import QRCode from "qrcode";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { investors, payments, practices } from "@/server/db/schema";
import { requireMember } from "@/server/member";
import { billingFor, seatsUsed } from "@/server/billing";
import { appEnv, appUrl } from "@/server/env";
import { audit } from "@/server/security";
import { sendMail } from "@/server/mailer";
import { underLimit } from "@/server/rate-limit";
import { PLANS, PLAN_IDS } from "@/lib/plans";

const choice = z.object({ plan: z.enum(PLAN_IDS as [string, ...string[]]), months: z.union([z.literal(1), z.literal(12)]) });

export const getBilling = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember(["owner"], { allowLocked: true });
  const b = await billingFor(m.practiceId);
  const [clients] = await withPractice(m.practiceId, (tx) => tx.select({ n: count() }).from(investors));
  const history = await db()
    .select({
      id: payments.id,
      plan: payments.plan,
      months: payments.months,
      amountMinor: payments.amountMinor,
      reference: payments.reference,
      status: payments.status,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(eq(payments.practiceId, m.practiceId))
    .orderBy(desc(payments.createdAt))
    .limit(12);
  return {
    state: b.state,
    plan: b.plan?.id ?? null,
    limitsName: b.limits.name,
    endsAt: b.endsAt,
    locksAt: b.locksAt,
    usage: { clients: clients?.n ?? 0, clientLimit: b.limits.clients, seats: await seatsUsed(m.practiceId), seatLimit: b.limits.users },
    upiReady: Boolean(appEnv().UPI_ID),
    pending: history.some((h) => h.status === "pending"),
    history,
  };
});

/** The UPI payment request (QR and link) for a plan; nothing is recorded until the UTR is entered. */
export const upiRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) => choice.parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner"], { allowLocked: true });
    const e = appEnv();
    if (!e.UPI_ID) return { ok: false as const, error: "Payments aren't switched on yet. Write to support@anqulas.com." };
    const plan = PLANS[data.plan as keyof typeof PLANS];
    const amount = plan.inr[data.months];
    const [p] = await db().select({ name: practices.name }).from(practices).where(eq(practices.id, m.practiceId));
    const note = `Anqulas Folio ${plan.name} ${data.months === 12 ? "1 year" : "1 month"}`;
    const url = `upi://pay?${new URLSearchParams({ pa: e.UPI_ID, pn: e.UPI_PAYEE_NAME ?? "Anqulas", am: amount.toFixed(2), cu: "INR", tn: `${note} ${p!.name}`.slice(0, 80) })}`;
    const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, width: 220 });
    return { ok: true as const, url, qrSvg, amount, upiId: e.UPI_ID, note };
  });

export const submitUtr = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    choice
      .extend({ utr: z.string().trim().regex(/^\d{12}$/, "The UTR is the 12-digit number in your UPI app's payment details.") })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const m = await requireMember(["owner"], { allowLocked: true });
    if (!(await underLimit(`utr:${m.practiceId}`, 5, 3600))) {
      return { ok: false as const, error: "Too many attempts. Try again in an hour." };
    }
    const [waiting] = await db()
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.practiceId, m.practiceId), eq(payments.status, "pending")));
    if (waiting) return { ok: false as const, error: "A payment is already waiting to be checked. We'll confirm it soon." };
    const plan = PLANS[data.plan as keyof typeof PLANS];
    const inserted = await db()
      .insert(payments)
      .values({
        practiceId: m.practiceId,
        plan: plan.id,
        months: data.months,
        amountMinor: plan.inr[data.months] * 100,
        currency: "INR",
        method: "upi_manual",
        reference: data.utr,
        createdBy: m.userId,
      })
      .onConflictDoNothing()
      .returning({ id: payments.id });
    // A UTR can be claimed once, by one practice.
    if (!inserted.length) return { ok: false as const, error: "That UTR was already entered. Check the number." };
    await audit(m.practiceId, m.userId, "billing.utr_submitted", { meta: { plan: plan.id, months: data.months } });
    const admins = (appEnv().PLATFORM_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    for (const to of admins) {
      await sendMail({
        to,
        subject: `UPI payment to check: ₹${plan.inr[data.months]} (UTR ${data.utr})`,
        text: `A practice says it paid ₹${plan.inr[data.months]} for ${plan.name}, ${data.months} month(s), UTR ${data.utr}.\nCheck your UPI app, then confirm or reject it at ${appUrl()}/platform.`,
      });
    }
    return { ok: true as const };
  });
