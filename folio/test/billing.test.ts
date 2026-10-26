import { describe, expect, it } from "vitest";
import { applyPeriod, billingState } from "@/server/billing";
import { PLANS } from "@/lib/plans";

const now = new Date("2026-11-01T00:00:00Z");
const d = (s: string) => new Date(s);

describe("billing state", () => {
  it("trial, then 3 days' grace, then locked", () => {
    const p = { billingExempt: false, plan: "trial", trialEndsAt: d("2026-11-10T00:00:00Z"), paidUntil: null };
    expect(billingState(p, now).state).toBe("trial");
    expect(billingState(p, now).limits.id).toBe("growth");
    expect(billingState(p, d("2026-11-11T00:00:00Z")).state).toBe("grace");
    expect(billingState(p, d("2026-11-13T00:00:01Z")).state).toBe("locked");
  });
  it("paid plan gives that plan's limits", () => {
    const s = billingState({ billingExempt: false, plan: "starter", trialEndsAt: null, paidUntil: d("2026-12-01T00:00:00Z") }, now);
    expect(s.state).toBe("active");
    expect(s.limits.clients).toBe(200);
  });
  it("exempt practices are never locked and get unlimited clients", () => {
    const s = billingState({ billingExempt: true, plan: "trial", trialEndsAt: d("2020-01-01"), paidUntil: null }, now);
    expect(s.state).toBe("exempt");
    expect(s.limits.clients).toBeNull();
  });
});

describe("applying a payment", () => {
  it("keeps remaining trial days", () => {
    expect(applyPeriod({ plan: "trial", trialEndsAt: d("2026-11-10T00:00:00Z"), paidUntil: null }, PLANS.starter, 1, now).toISOString()).toBe(
      "2026-12-10T00:00:00.000Z",
    );
  });
  it("adds onto the same plan's current period", () => {
    expect(applyPeriod({ plan: "growth", trialEndsAt: null, paidUntil: d("2026-11-20T00:00:00Z") }, PLANS.growth, 12, now).toISOString()).toBe(
      "2027-11-20T00:00:00.000Z",
    );
  });
  it("converts unused days at the price ratio when changing plan", () => {
    // 30 days of Pro (₹1,999) left are worth about 60 days of Growth (₹999); plus 1 month ≈ 90 days.
    const until = applyPeriod({ plan: "pro", trialEndsAt: null, paidUntil: d("2026-12-01T00:00:00Z") }, PLANS.growth, 1, now);
    const days = (until.getTime() - now.getTime()) / 86400000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(92);
  });
  it("starts from today after a lapse", () => {
    expect(applyPeriod({ plan: "starter", trialEndsAt: null, paidUntil: d("2026-10-01T00:00:00Z") }, PLANS.starter, 1, now).toISOString()).toBe(
      "2026-12-01T00:00:00.000Z",
    );
  });
});
