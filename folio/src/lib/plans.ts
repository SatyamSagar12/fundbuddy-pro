/**
 * Plans: the only place prices and limits are defined. The billing page, the server's checks and the
 * payment amounts all read this, so a price can never come from the browser.
 */
export type PlanId = "starter" | "growth" | "pro";
export type Months = 1 | 12;

export type Plan = {
  id: PlanId;
  name: string;
  /** Clients (PANs). null = unlimited. */
  clients: number | null;
  /** Team members including the owner. */
  users: number;
  /** Price in rupees for 1 month and for 12 months (12 months = 10 months' price). */
  inr: Record<Months, number>;
};

export const PLANS: Record<PlanId, Plan> = {
  starter: { id: "starter", name: "Starter", clients: 200, users: 1, inr: { 1: 499, 12: 4990 } },
  growth: { id: "growth", name: "Growth", clients: 750, users: 3, inr: { 1: 999, 12: 9990 } },
  pro: { id: "pro", name: "Pro", clients: null, users: 10, inr: { 1: 1999, 12: 19990 } },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** A new practice gets this long, with this plan's limits. */
export const TRIAL = { days: 30, limitsOf: "growth" as PlanId };

/** After the trial or a paid period ends, the app keeps working this many days with a warning. */
export const GRACE_DAYS = 3;

export function isPlanId(value: string): value is PlanId {
  return value in PLANS;
}
