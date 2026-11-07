import { describe, expect, it } from "vitest";
import { financialYear, inrCompact, monthlyBreakdown, monthlySipCommitment, topSchemes, yearlyBreakdown, type Entry } from "@/lib/report-math";

const e = (type: string, amount: number, date: string, scheme = "A"): Entry => ({ type, amount, date, scheme });

describe("report math", () => {
  it("financial years run April to March", () => {
    expect(financialYear(new Date("2026-03-31T00:00:00"))).toBe("FY 2025-26");
    expect(financialYear(new Date("2026-04-01T00:00:00"))).toBe("FY 2026-27");
  });
  it("monthly buckets keep empty months and split SIP from one-time, ignoring redemptions", () => {
    const m = monthlyBreakdown([e("sip", 100, "2026-10-05"), e("purchase", 50, "2026-10-20"), e("redemption", 999, "2026-10-21"), e("sip", 7, "2026-08-01")], 3, new Date("2026-10-26T00:00:00"));
    expect(m.map((x) => [x.label, x.sip, x.oneTime])).toEqual([["Aug 26", 7, 0], ["Sep 26", 0, 0], ["Oct 26", 100, 50]]);
  });
  it("yearly totals and top schemes", () => {
    const y = yearlyBreakdown([e("sip", 1, "2026-03-31"), e("sip", 2, "2026-04-01"), e("purchase", 3, "2026-05-01")]);
    expect(y).toEqual([
      { year: "FY 2025-26", sip: 1, oneTime: 0, total: 1, count: 1 },
      { year: "FY 2026-27", sip: 2, oneTime: 3, total: 5, count: 2 },
    ]);
    const t = topSchemes([e("sip", 5, "2026-01-01", "X"), e("sip", 9, "2026-01-01", "Y"), e("sip", 1, "2026-01-01", "Z")], 2);
    expect(t).toEqual([{ scheme: "Y", amount: 9 }, { scheme: "X", amount: 5 }, { scheme: "Other", amount: 1 }]);
  });
  it("SIP commitment and compact rupees", () => {
    expect(monthlySipCommitment([{ amount: 3000, frequency: "quarterly", status: "active" }, { amount: 500, frequency: "monthly", status: "paused" }])).toBe(1000);
    expect(inrCompact(450000)).toBe("₹4.5L");
    expect(inrCompact(1250000)).toBe("₹13L");
    expect(inrCompact(32000000)).toBe("₹3.2Cr");
  });
});
