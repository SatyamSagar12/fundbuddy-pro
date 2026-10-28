/** NAV engine: AMFI file parsing, scheme matching, XIRR, holdings maths, and the import + units jobs on a database. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { amfiDate, amfiNav, optionOf, parseMfapiHistory, parseNavAll, planOf } from "@/lib/amfi";
import { baseName, confidentMatch, rankCandidates } from "@/lib/scheme-match";
import { combine, shownReturn, unitsFor, valueHolding, xirr } from "@/lib/holdings";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { instruments, marketState, navPrices, practices, transactions, investors } from "@/server/db/schema";
import { fillUnits, importNavAll, navStatus, refreshIfDue, saveSchemes, type Fetcher } from "@/server/nav";
import { confidentScheme, linkScheme, searchSchemes, suggestMany } from "@/server/schemes";
import { loadHoldings, loadUnmatched } from "@/server/valuation";
import { withTestDb } from "./helpers";

const NAVALL = readFileSync(new URL("./fixtures/NAVAll-sample.txt", import.meta.url), "utf8");

describe("AMFI file", () => {
  const rows = parseNavAll(NAVALL);
  it("reads every scheme with its fund house, type and category", () => {
    expect(rows).toHaveLength(9);
    expect(rows[0]).toEqual({
      amfiCode: "9900101",
      isin: "INF179K01608",
      isinReinvest: null,
      name: "HDFC Flexi Cap Fund - Growth Plan",
      amc: "HDFC Mutual Fund",
      schemeType: "Open Ended",
      category: "Equity Scheme - Flexi Cap Fund",
      plan: "regular",
      option: "growth",
      nav: "1876.543",
      navDate: "2026-10-24",
    });
    expect(rows.find((r) => r.amfiCode === "9900401")).toMatchObject({ schemeType: "Close Ended", category: "Income", amc: "Old Mutual Fund" });
  });
  it("keeps schemes listed with N.A. but without a NAV", () => {
    expect(rows.find((r) => r.amfiCode === "9900303")).toMatchObject({ nav: null, navDate: null, isin: null });
  });
  it("tells plans and options apart", () => {
    expect(planOf("X Fund - Direct Plan - Growth")).toBe("direct");
    expect(planOf("X Fund - Growth Plan")).toBe("regular");
    expect(optionOf("X - Regular Plan - Daily IDCW")).toBe("idcw_payout");
    expect(optionOf("X - Reinvestment of Income Distribution cum capital withdrawal option")).toBe("idcw_reinvest");
    expect(optionOf("X - Dividend Payout")).toBe("idcw_payout");
    expect(optionOf("X - Growth Option")).toBe("growth");
    expect(optionOf("X - Bonus")).toBe("bonus");
  });
  it("reads dates and NAVs strictly", () => {
    expect(amfiDate("24-Oct-2026")).toBe("2026-10-24");
    expect(amfiDate("01-02-2024")).toBe("2024-02-01");
    expect(amfiDate("32-Oct-2026")).toBeNull();
    expect(amfiDate("24-Foo-2026")).toBeNull();
    expect(amfiNav("N.A.")).toBeNull();
    expect(amfiNav("0")).toBeNull();
    expect(amfiNav("12.30000")).toBe("12.3");
    expect(amfiNav("1,234.5")).toBe("1234.5");
  });
  it("reads mfapi history oldest first", () => {
    expect(parseMfapiHistory({ data: [{ date: "02-01-2024", nav: "11.0" }, { date: "01-01-2024", nav: "10.0" }, { date: "x", nav: "1" }] })).toEqual([
      { date: "2024-01-01", nav: "10" },
      { date: "2024-01-02", nav: "11" },
    ]);
    expect(parseMfapiHistory({ status: "FAIL" })).toEqual([]);
  });
});

describe("scheme matching", () => {
  const today = "2026-10-26";
  const all = parseNavAll(NAVALL).map((r, i) => ({ id: String(i), name: r.name, plan: r.plan, option: r.option, latestNavDate: r.navDate }));
  it("finds a renamed Bluechip fund under its Large Cap name, without linking it on its own", () => {
    const c = (id: string, name: string) => ({ id, name, plan: "regular", option: "growth", latestNavDate: today });
    const list = [c("us", "ICICI Prudential US Bluechip Equity Fund - Growth"), c("lc", "ICICI Prudential Large Cap Fund - Growth"), c("v", "ICICI Prudential Value Fund - Growth")];
    const ranked = rankCandidates("ICICI Prudential Bluechip Fund", list, today);
    expect(ranked[0]!.id).toBe("lc");
    expect(confidentMatch("ICICI Prudential Bluechip Fund", ranked)).toBeNull();
    // Typed exactly, the US fund is still found and linked.
    const us = rankCandidates("ICICI Prudential US Bluechip Equity Fund", list, today);
    expect(confidentMatch("ICICI Prudential US Bluechip Equity Fund", us)?.id).toBe("us");
  });

  it("ignores plan, option and punctuation words", () => {
    expect(baseName("HDFC Flexi Cap Fund - Growth Option - Direct Plan")).toBe("hdfc flexi cap");
    expect(baseName("ICICI Prudential Equity & Debt Fund (formerly Balanced)")).toBe("icici prudential equity and debt");
  });
  it("ranks the regular growth plan first and treats an exact name as certain", () => {
    const ranked = rankCandidates("HDFC Flexi Cap Fund", all, today);
    expect(ranked[0]!.name).toBe("HDFC Flexi Cap Fund - Growth Plan");
    expect(confidentMatch("HDFC Flexi Cap Fund", ranked)?.name).toBe("HDFC Flexi Cap Fund - Growth Plan");
  });
  it("follows the plan and option the query asks for", () => {
    expect(rankCandidates("Parag Parikh Flexi Cap direct", all, today)[0]!.name).toBe("Parag Parikh Flexi Cap Fund - Direct Plan - Growth");
    expect(rankCandidates("HDFC Flexi Cap IDCW", all, today)[0]!.name).toBe("HDFC Flexi Cap Fund - IDCW Plan");
  });
  it("is not certain about partial names", () => {
    const ranked = rankCandidates("HDFC Flexi", all, today);
    expect(ranked[0]!.name).toContain("HDFC Flexi Cap");
    expect(confidentMatch("HDFC Flexi", ranked)).toBeNull();
    expect(confidentMatch("Flexi Cap Fund", rankCandidates("Flexi Cap Fund", all, today))).toBeNull();
    // Closed plans (no recent NAV) don't compete with the live one.
    expect(confidentMatch("Aditya Birla Sun Life Liquid Fund", rankCandidates("Aditya Birla Sun Life Liquid Fund", all, today))?.name).toBe(
      "Aditya Birla Sun Life Liquid Fund - Regular Plan - Growth",
    );
  });
});

describe("XIRR and holdings", () => {
  it("matches a known XIRR", () => {
    // 10,000 in, 11,000 out exactly a year later: 10%.
    expect(xirr([{ date: "2025-01-01", amount: -10000 }, { date: "2026-01-01", amount: 11000 }])).toBeCloseTo(0.1, 6);
    // Excel's example: XIRR = 37.34%.
    expect(
      xirr([
        { date: "2008-01-01", amount: -10000 },
        { date: "2008-03-01", amount: 2750 },
        { date: "2008-10-30", amount: 4250 },
        { date: "2009-02-15", amount: 3250 },
        { date: "2009-04-01", amount: 2750 },
      ]),
    ).toBeCloseTo(0.373362535, 5);
    expect(xirr([{ date: "2025-01-01", amount: -100 }, { date: "2026-01-01", amount: 50 }])).toBeCloseTo(-0.5, 6);
    expect(xirr([{ date: "2025-01-01", amount: -100 }])).toBeNull();
    expect(xirr([{ date: "2025-01-01", amount: -100 }, { date: "2025-01-01", amount: 120 }])).toBeNull();
  });
  it("uses average cost for redemptions", () => {
    const h = valueHolding(
      [
        { date: "2025-01-01", type: "purchase", amount: 1000, units: 100 },
        { date: "2025-06-01", type: "sip", amount: 1000, units: 50 },
        { date: "2025-09-01", type: "redemption", amount: 900, units: 30 },
      ],
      25,
      "2026-01-01",
    );
    // 150 units cost 2,000; 30 sold take 400 of cost, realising 500.
    expect(h.units).toBe(120);
    expect(h.cost).toBe(1600);
    expect(h.realised).toBe(500);
    expect(h.value).toBe(3000);
    expect(h.gain).toBe(1400);
    expect(h.netInvested).toBe(1100);
    expect(h.absoluteReturn).toBeCloseTo((3000 + 900 - 2000) / 2000, 9);
    expect(h.xirr).toBeGreaterThan(0.5);
  });
  it("leaves out entries without units and counts them", () => {
    const h = valueHolding(
      [
        { date: "2025-01-01", type: "purchase", amount: 1000, units: 100 },
        { date: "2026-01-01", type: "sip", amount: 500, units: null },
      ],
      10,
      "2026-01-02",
    );
    expect(h).toMatchObject({ units: 100, cost: 1000, value: 1000, gain: 0, pendingUnits: 1 });
  });
  it("combines holdings and picks XIRR only after a year", () => {
    const a = { ...valueHolding([{ date: "2025-01-01", type: "purchase", amount: 1000, units: 100 }], 11, "2026-01-01"), navDate: "2026-01-01" };
    const b = { ...valueHolding([{ date: "2025-12-01", type: "purchase", amount: 1000, units: 10 }], 100, "2026-01-01"), navDate: "2026-01-01" };
    const t = combine([a, b]);
    expect(t).toMatchObject({ value: 2100, cost: 2000, gain: 100, firstDate: "2025-01-01" });
    expect(shownReturn(t).label).toBe("XIRR");
    expect(shownReturn(b)).toEqual({ label: "Return", value: 0 });
  });
  it("allots slightly fewer units after stamp duty", () => {
    expect(unitsFor("purchase", 10000, 100, "2026-01-01")).toBe(99.995);
    expect(unitsFor("purchase", 10000, 100, "2020-06-30")).toBe(100);
    expect(unitsFor("redemption", 10000, 100, "2026-01-01")).toBe(100);
  });
});

describe("NAV jobs on the database", () => {
  let P = "";
  let client = "";
  const history: Record<string, unknown> = {
    "9900101": { data: [{ date: "05-01-2026", nav: "1500.0" }, { date: "02-01-2026", nav: "1490.0" }, { date: "31-12-2025", nav: "1480.0" }] },
  };
  const fetched: string[] = [];
  const fetcher: Fetcher = async (url) => {
    fetched.push(url);
    if (url.endsWith("NAVAll.txt")) return NAVALL;
    const code = url.split("/").pop()!;
    if (history[code]) return JSON.stringify(history[code]);
    throw new Error("404");
  };

  beforeAll(() =>
    withTestDb(async () => {
      await db().delete(instruments).where(like(instruments.amfiCode, "99004%"));
      await db().delete(instruments).where(inArray(instruments.amfiCode, parseNavAll(NAVALL).map((r) => r.amfiCode)));
      await db().delete(marketState);
      const [p] = await db().insert(practices).values({ name: "NAV test", dataKeyWrapped: "x" }).returning();
      P = p!.id;
      await withPractice(P, async (tx) => {
        const [c] = await tx.insert(investors).values({ practiceId: P, name: "Holder" }).returning();
        client = c!.id;
        await tx.insert(transactions).values([
          // 1 Jan 2026 is a holiday in this history: the next NAV (2 Jan) applies.
          { practiceId: P, investorId: client, type: "purchase", tradeDate: "2026-01-01", amount: "14900", schemeText: "HDFC Flexi Cap Fund", source: "manual" },
          { practiceId: P, investorId: client, type: "sip", tradeDate: "2026-01-05", amount: "3000", schemeText: "HDFC Flexi Cap Fund", source: "manual" },
          { practiceId: P, investorId: client, type: "purchase", tradeDate: "2026-01-05", amount: "5000", schemeText: "Some Unknown Fund", source: "manual" },
        ]);
      });
    }),
  );

  afterAll(() =>
    withTestDb(async () => {
      await db().delete(practices).where(eq(practices.id, P));
      await db().delete(instruments).where(inArray(instruments.amfiCode, parseNavAll(NAVALL).map((r) => r.amfiCode)));
      await db().delete(marketState);
    }),
  );

  it("refuses a file that looks cut off", async () => {
    await expect(withTestDb(() => importNavAll(fetcher))).rejects.toThrow(/incomplete/);
  });

  it("imports schemes, then rewrites only what changed", async () => {
    const first = await withTestDb(() => importNavAll(fetcher, 1));
    expect(first).toMatchObject({ schemes: 9, changed: 9, navDate: "2026-10-24" });
    const again = await withTestDb(() => saveSchemes(parseNavAll(NAVALL)));
    expect(again.changed).toBe(0);
    const next = await withTestDb(() => saveSchemes(parseNavAll(NAVALL.replace("1876.5430;24-Oct-2026", "1880.0000;25-Oct-2026"))));
    expect(next.changed).toBe(1);
    const status = await withTestDb(() => navStatus());
    expect(status.lastImport?.schemes).toBe(9);
  });

  it("finds schemes by any words", async () => {
    const hits = await withTestDb(() => searchSchemes("parag flexi"));
    expect(hits.map((h) => h.name)[0]).toBe("Parag Parikh Flexi Cap Fund - Regular Plan - Growth");
    expect(await withTestDb(() => confidentScheme("HDFC Flexi Cap Fund"))).toBeTruthy();
    const many = await withTestDb(() => suggestMany(["HDFC Flexi Cap Fund", "Some Unknown Fund"]));
    expect(many.get("HDFC Flexi Cap Fund")?.confident).toBeTruthy();
    expect(many.get("Some Unknown Fund")?.confident).toBeNull();
  });

  it("links a typed name, loads its history once, and works out units from the right day's NAV", async () => {
    const id = (await withTestDb(() => confidentScheme("HDFC Flexi Cap Fund")))!;
    const linked = await withTestDb(() => linkScheme(P, "HDFC Flexi Cap Fund", id));
    expect(linked).toEqual({ entries: 2, sips: 0 });
    const r = await withTestDb(() => fillUnits({ practiceId: P, fetcher }));
    expect(r).toEqual({ filled: 2, fetched: 1, failed: 0 });
    const rows = await withTestDb(() =>
      withPractice(P, (tx) => tx.select().from(transactions).where(eq(transactions.instrumentId, id)).orderBy(transactions.tradeDate)),
    );
    // 14,900 × 0.99995 ÷ 1490 and 3,000 × 0.99995 ÷ 1500
    expect(rows.map((x) => [x.nav, x.units, x.unitsEstimated])).toEqual([
      ["1490.000000", "9.9995", true],
      ["1500.000000", "1.9999", true],
    ]);
    // Already loaded: no second download.
    fetched.length = 0;
    await withTestDb(() => fillUnits({ practiceId: P, fetcher }));
    expect(fetched).toEqual([]);
    // Tracked now: the next daily file adds its NAV to the history.
    await withTestDb(() => saveSchemes(parseNavAll(NAVALL)));
    const h = await withTestDb(() => db().select().from(navPrices).where(eq(navPrices.instrumentId, id)));
    expect(h.map((x) => x.date)).toContain("2026-10-24");
  });

  it("values holdings at the latest NAV, listing unmatched schemes apart", async () => {
    const { holdings, unmatched } = await withTestDb(() =>
      withPractice(P, async (tx) => ({ holdings: await loadHoldings(tx, client), unmatched: await loadUnmatched(tx, client) })),
    );
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({ name: "HDFC Flexi Cap Fund - Growth Plan", units: 11.9994, cost: 17900, nav: 1876.543, estimated: true });
    expect(holdings[0]!.value).toBeCloseTo(11.9994 * 1876.543, 2);
    expect(unmatched).toEqual([{ scheme: "Some Unknown Fund", entries: 1, netInvested: 5000 }]);
  });

  it("runs the import at most once while it is fresh", async () => {
    await withTestDb(() => db().delete(marketState));
    const first = await withTestDb(() => refreshIfDue(fetcher).catch((e) => e));
    // The fixture is small, so the real import refuses it; the attempt is still claimed.
    expect(first).toBeInstanceOf(Error);
    const [claim] = await withTestDb(() => db().select().from(marketState).where(eq(marketState.key, "nav_attempt")));
    expect(claim).toBeTruthy();
  });
});
