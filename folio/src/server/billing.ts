/**
 * Where a practice stands: trial, paid, in grace, or locked. Nothing is ever deleted when locked; the app
 * just shows the billing page until a payment is confirmed.
 */
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { db } from "./db/client";
import { invites, memberships, practices } from "./db/schema";
import { GRACE_DAYS, PLANS, TRIAL, isPlanId, type Plan } from "@/lib/plans";

export type BillingState = "exempt" | "trial" | "active" | "grace" | "locked";

export type PracticeBilling = {
  state: BillingState;
  /** The plan whose limits apply now. */
  limits: Plan;
  /** The paid plan, if any. */
  plan: Plan | null;
  /** When the trial or paid period ends (null when exempt). */
  endsAt: Date | null;
  /** When the grace period ends and the app locks. */
  locksAt: Date | null;
};

const DAY = 24 * 3600 * 1000;

export function billingState(
  p: { billingExempt: boolean; plan: string; trialEndsAt: Date | null; paidUntil: Date | null },
  now = new Date(),
): PracticeBilling {
  const paidPlan = isPlanId(p.plan) ? PLANS[p.plan] : null;
  if (p.billingExempt) return { state: "exempt", limits: PLANS.pro, plan: paidPlan, endsAt: null, locksAt: null };
  const paid = paidPlan && p.paidUntil ? p.paidUntil : null;
  const endsAt = paid ?? p.trialEndsAt;
  const limits = paidPlan && paid ? paidPlan : PLANS[TRIAL.limitsOf];
  if (!endsAt) return { state: "locked", limits, plan: paidPlan, endsAt: null, locksAt: null };
  const locksAt = new Date(endsAt.getTime() + GRACE_DAYS * DAY);
  const state: BillingState =
    now < endsAt ? (paid ? "active" : "trial") : now < locksAt ? "grace" : "locked";
  return { state, limits, plan: paidPlan, endsAt, locksAt };
}

export async function billingFor(practiceId: string): Promise<PracticeBilling> {
  const [p] = await db().select().from(practices).where(eq(practices.id, practiceId));
  if (!p) throw new Error("Practice not found");
  return billingState(p);
}

/** Active members plus invitations still open, against the plan's user limit. */
export async function seatsUsed(practiceId: string): Promise<number> {
  const [m] = await db()
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.practiceId, practiceId), eq(memberships.active, true)));
  const [i] = await db()
    .select({ n: count() })
    .from(invites)
    .where(
      and(
        eq(invites.practiceId, practiceId),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, new Date()),
      ),
    );
  return (m?.n ?? 0) + (i?.n ?? 0);
}

/**
 * Payment applied → the new paid-until date.
 * - Same plan still running: added on after the current end.
 * - During the trial: the remaining trial days are kept (the paid period starts when the trial ends).
 * - Changing plan while paid: unused days convert at the price ratio, then the new months are added.
 */
export function applyPeriod(
  p: { plan: string; trialEndsAt: Date | null; paidUntil: Date | null },
  plan: Plan,
  months: number,
  now = new Date(),
): Date {
  const addMonths = (d: Date, n: number) => {
    const r = new Date(d);
    r.setUTCMonth(r.getUTCMonth() + n);
    return r;
  };
  const current = isPlanId(p.plan) && p.paidUntil && p.paidUntil > now ? { plan: PLANS[p.plan], until: p.paidUntil } : null;
  if (current && current.plan.id === plan.id) return addMonths(current.until, months);
  if (current) {
    const leftDays = (current.until.getTime() - now.getTime()) / DAY;
    const credit = (leftDays * current.plan.inr[1]) / plan.inr[1];
    return addMonths(new Date(now.getTime() + credit * DAY), months);
  }
  const start = p.trialEndsAt && p.trialEndsAt > now ? p.trialEndsAt : now;
  return addMonths(start, months);
}
