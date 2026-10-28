import { describe, expect, it } from "vitest";
import { addMonths, detectSips, inflowByMonth, monthlyAmount, type SipEvent } from "../src/lib/sip-book";

/** Monthly instalments of `amount` on the 5th, from `from` for `n` months. */
function monthly(key: string, from: string, n: number, amount = 5000): SipEvent[] {
  return Array.from({ length: n }, (_, i) => ({ key, date: addMonths(from, i), amount }));
}

describe("SIP book", () => {
  it("rolls dates the way SIPs do", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-05", 2)).toBe("2027-01-05");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
  });

  it("finds a running monthly SIP and its next date", () => {
    const [s] = detectSips(monthly("a", "2026-01-05", 10), "2026-10-20");
    expect(s).toMatchObject({ status: "active", frequency: "monthly", amount: 5000, paid: 10, firstDate: "2026-01-05", lastPaid: "2026-10-05", nextDue: "2026-11-05" });
  });

  it("marks a reversed instalment as bounced", () => {
    const ev = [...monthly("a", "2026-01-05", 10), { key: "a", date: "2026-10-09", amount: -5000 }];
    const [s] = detectSips(ev, "2026-10-20");
    expect(s).toMatchObject({ status: "bounced", lastPaid: "2026-09-05", lastBounce: "2026-10-05", bouncesYear: 1, paid: 9 });
  });

  it("goes back to active when the next instalment goes through", () => {
    const ev = [...monthly("a", "2026-01-05", 11), { key: "a", date: "2026-10-09", amount: -5000 }];
    const [s] = detectSips(ev, "2026-11-10");
    expect(s).toMatchObject({ status: "active", lastPaid: "2026-11-05", bouncesYear: 1 });
  });

  it("calls a SIP missed after one silent cycle and stopped after three", () => {
    const ev = monthly("a", "2026-01-05", 6); // last 2026-06-05
    expect(detectSips(ev, "2026-07-10")[0]!.status).toBe("active");
    expect(detectSips(ev, "2026-08-01")[0]!.status).toBe("missed");
    expect(detectSips(ev, "2026-10-20")[0]!.status).toBe("stopped");
  });

  it("tells weekly and quarterly SIPs apart", () => {
    const weekly = Array.from({ length: 8 }, (_, i) => ({ key: "w", date: new Date(Date.UTC(2026, 8, 1 + 7 * i)).toISOString().slice(0, 10), amount: 1000 }));
    const quarterly = [0, 3, 6, 9].map((m) => ({ key: "q", date: addMonths("2025-12-10", m), amount: 15000 }));
    const out = detectSips([...weekly, ...quarterly], "2026-10-22");
    expect(out.find((s) => s.key === "w")).toMatchObject({ frequency: "weekly", status: "active" });
    expect(out.find((s) => s.key === "q")).toMatchObject({ frequency: "quarterly", status: "active", nextDue: "2026-12-10" });
  });

  it("uses the latest amount of a step-up SIP and ignores stray reversals", () => {
    const ev = [...monthly("a", "2026-01-05", 6, 5000), ...monthly("a", "2026-07-05", 4, 5500), { key: "b", date: "2026-10-01", amount: -2000 }];
    const out = detectSips(ev, "2026-10-20");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ amount: 5500, status: "active" });
  });

  it("adds up SIP money per month", () => {
    const flow = inflowByMonth([{ date: "2026-10-05", amount: 5000 }, { date: "2026-10-09", amount: -5000 }, { date: "2026-09-05", amount: 5000 }, { date: "2025-01-05", amount: 9 }], "2026-10-20", 3);
    expect(flow).toEqual([{ month: "2026-08", amount: 0 }, { month: "2026-09", amount: 5000 }, { month: "2026-10", amount: 0 }]);
  });

  it("converts to a monthly figure", () => {
    expect(monthlyAmount(3000, "quarterly")).toBe(1000);
    expect(monthlyAmount(1200, "weekly")).toBe(5200);
  });
});
