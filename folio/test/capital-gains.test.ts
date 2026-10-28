/** Capital gains: FIFO matching, every rule in the tax table, grandfathering and the yearly summary. */
import { describe, expect, it } from "vitest";
import { matchSales, summarise, yearsWithSales, type CgScheme, type CgTxn } from "@/lib/capital-gains";
import { addMonths, fyOf, heldMoreThan, ruleFor, TAX_RULES, taxClassOf, type TaxClass } from "@/lib/tax-rules";

const buy = (date: string, units: number, nav: number, instrumentId = "s"): CgTxn => ({ investorId: "i", folio: "f", instrumentId, date, type: "purchase", amount: units * nav, units });
const sell = (date: string, units: number, nav: number, instrumentId = "s"): CgTxn => ({ investorId: "i", folio: "f", instrumentId, date, type: "redemption", amount: units * nav, units });
const schemes = (taxClass: TaxClass, nav31Jan2018: number | null = null) => new Map<string, CgScheme>([["s", { name: "Scheme", taxClass, nav31Jan2018 }]]);

/** One buy and one sale of 100 units: the single gain line. */
function one(taxClass: TaxClass, bought: string, sold: string, buyNav = 10, sellNav = 15, nav31Jan2018: number | null = null) {
  const { lines } = matchSales([buy(bought, 100, buyNav), sell(sold, 100, sellNav)], schemes(taxClass, nav31Jan2018));
  expect(lines).toHaveLength(1);
  return lines[0]!;
}

describe("dates", () => {
  it("adds months, keeping month ends sensible", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2023-01-31", 1)).toBe("2023-02-28");
    expect(addMonths("2023-11-15", 14)).toBe("2025-01-15");
  });
  it("long-term means held for more than the months: the same date a year later is still short-term", () => {
    expect(heldMoreThan("2024-01-15", "2025-01-15", 12)).toBe(false);
    expect(heldMoreThan("2024-01-15", "2025-01-16", 12)).toBe(true);
  });
  it("financial years start on 1 April", () => {
    expect(fyOf("2025-03-31")).toBe(2024);
    expect(fyOf("2025-04-01")).toBe(2025);
  });
  it("every rule row has a known kind and sane dates", () => {
    for (const r of TAX_RULES) {
      expect(["equity", "debt", "hybrid", "other"]).toContain(r.taxClass);
      expect(r.soldBefore === null || r.soldBefore > r.soldFrom).toBe(true);
    }
  });
});

describe("first in, first out", () => {
  it("a sale uses up the oldest units first, and shares the sale value by units", () => {
    const { lines, problems } = matchSales([buy("2020-01-01", 100, 10), buy("2021-01-01", 100, 20), sell("2025-06-01", 150, 30)], schemes("equity"));
    expect(problems).toEqual([]);
    expect(lines.map((l) => [l.bought, l.units, l.cost, l.saleValue, l.gain])).toEqual([
      ["2020-01-01", 100, 1000, 3000, 2000],
      ["2021-01-01", 50, 1000, 1500, 500],
    ]);
  });

  it("keeps folios and schemes apart", () => {
    const txns: CgTxn[] = [buy("2020-01-01", 100, 10), { ...buy("2019-01-01", 100, 5), folio: "other" }, sell("2025-06-01", 100, 30)];
    const { lines } = matchSales(txns, schemes("equity"));
    expect(lines.map((l) => l.bought)).toEqual(["2020-01-01"]);
  });

  it("switches out are sales; switches in and reinvested IDCW are new units at their amount", () => {
    const txns: CgTxn[] = [
      { ...buy("2024-01-01", 10, 100), type: "switch_in" },
      { ...buy("2024-02-01", 1, 100), type: "idcw_reinvest" },
      { ...sell("2024-03-01", 11, 110), type: "switch_out" },
    ];
    const { lines } = matchSales(txns, schemes("equity"));
    expect(lines.map((l) => [l.bought, l.units, l.gain])).toEqual([
      ["2024-01-01", 10, 100],
      ["2024-02-01", 1, 10],
    ]);
  });

  it("names a sale of more units than were bought, and entries still waiting for units", () => {
    const { lines, problems } = matchSales([buy("2024-01-01", 10, 10), { ...buy("2024-02-01", 10, 10), units: null }, sell("2025-06-01", 15, 20)], schemes("equity"));
    expect(lines.map((l) => l.units)).toEqual([10]);
    expect(problems.map((p) => p.kind).sort()).toEqual(["no_units", "sold_more_than_bought"]);
  });
});

describe("equity funds", () => {
  it("from 23 Jul 2024: short-term 20%, long-term after 12 months 12.5%", () => {
    expect(one("equity", "2024-08-01", "2025-08-01")).toMatchObject({ term: "short", rate: 0.2, ruleId: "equity-2024-07" });
    expect(one("equity", "2024-08-01", "2025-08-02")).toMatchObject({ term: "long", rate: 0.125 });
  });
  it("sold 1 Apr 2018 – 22 Jul 2024: short-term 15%, long-term 10%", () => {
    expect(one("equity", "2024-01-01", "2024-07-22")).toMatchObject({ term: "short", rate: 0.15, ruleId: "equity-2018-04" });
    expect(one("equity", "2022-01-01", "2024-07-22")).toMatchObject({ term: "long", rate: 0.1 });
    expect(one("equity", "2024-01-01", "2024-07-23")).toMatchObject({ term: "short", rate: 0.2 });
  });
  it("sold before 1 Apr 2018: long-term exempt", () => {
    expect(one("equity", "2015-01-01", "2018-03-31")).toMatchObject({ term: "long", rate: 0, ruleId: "equity-2017-04" });
  });
});

describe("grandfathering (equity units bought by 31 Jan 2018)", () => {
  it("cost becomes the 31 Jan 2018 value when that is higher and the sale is higher still", () => {
    const l = one("equity", "2017-06-01", "2025-06-01", 50, 80, 60);
    expect(l).toMatchObject({ cost: 5000, costUsed: 6000, gain: 2000, grandfathered: true, term: "long" });
  });
  it("cost is capped at the sale value: no loss is created by grandfathering", () => {
    expect(one("equity", "2017-06-01", "2025-06-01", 50, 55, 60)).toMatchObject({ costUsed: 5500, gain: 0, grandfathered: true });
  });
  it("an actual cost above the 31 Jan 2018 value is kept, and a real loss stays a loss", () => {
    expect(one("equity", "2017-06-01", "2025-06-01", 70, 80, 60)).toMatchObject({ costUsed: 7000, gain: 1000, grandfathered: false });
    expect(one("equity", "2017-06-01", "2025-06-01", 50, 45, 60)).toMatchObject({ costUsed: 5000, gain: -500, grandfathered: false });
  });
  it("units bought after 31 Jan 2018 aren't grandfathered", () => {
    expect(one("equity", "2018-02-01", "2025-06-01", 50, 80, 60)).toMatchObject({ costUsed: 5000, grandfathered: false });
  });
  it("without the 31 Jan 2018 NAV the actual cost is used, and flagged", () => {
    expect(one("equity", "2017-06-01", "2025-06-01", 50, 80, null)).toMatchObject({ costUsed: 5000, grandfatherNavMissing: true });
  });
  it("debt funds are never grandfathered", () => {
    expect(one("debt", "2017-06-01", "2025-06-01", 50, 80, 60)).toMatchObject({ costUsed: 5000, grandfathered: false });
  });
});

describe("debt funds", () => {
  it("bought on or after 1 Apr 2023: always at slab, however long held", () => {
    expect(one("debt", "2023-04-01", "2026-10-01")).toMatchObject({ term: "short", rate: "slab", ruleId: "debt-50aa" });
  });
  it("bought earlier, sold from 23 Jul 2024: long-term after 24 months at 12.5%, no indexation", () => {
    expect(one("debt", "2023-03-31", "2025-04-01")).toMatchObject({ term: "long", rate: 0.125, indexedCost: null, ruleId: "debt-2024-07" });
    expect(one("debt", "2023-03-31", "2025-03-31")).toMatchObject({ term: "short", rate: "slab" });
  });
  it("bought earlier, sold before 23 Jul 2024: long-term after 36 months at 20% with indexation", () => {
    const l = one("debt", "2019-06-01", "2023-05-01", 10, 15);
    expect(l).toMatchObject({ term: "long", rate: 0.2, ruleId: "debt-2017-04" });
    // Cost 1,000 × CII 348 (FY 2023-24) ÷ 289 (FY 2019-20).
    expect(l.indexedCost).toBe(1204.15);
    expect(l.gain).toBe(295.85);
    expect(one("debt", "2021-01-01", "2023-12-01")).toMatchObject({ term: "short", rate: "slab" });
  });
});

describe("gold, international and funds of funds", () => {
  it("bought from 1 Apr 2023 and sold before 1 Apr 2025: slab (old 'specified fund' definition)", () => {
    expect(one("other", "2023-06-01", "2025-03-31")).toMatchObject({ rate: "slab", ruleId: "other-50aa" });
  });
  it("sold from 1 Apr 2025: long-term after 24 months at 12.5%, whenever bought", () => {
    expect(one("other", "2023-06-01", "2025-07-01")).toMatchObject({ term: "long", rate: 0.125, ruleId: "other-2024-07" });
    expect(one("other", "2023-06-01", "2025-04-15")).toMatchObject({ term: "short", rate: "slab" });
  });
});

describe("hybrid funds (35–65% equity)", () => {
  it("were never 'specified': long-term after 24 months at 12.5% even when bought after 1 Apr 2023", () => {
    expect(one("hybrid", "2023-06-01", "2025-07-01")).toMatchObject({ term: "long", rate: 0.125, ruleId: "hybrid-2024-07" });
  });
  it("before 23 Jul 2024: 36 months, 20% with indexation", () => {
    expect(one("hybrid", "2019-06-01", "2023-05-01")).toMatchObject({ term: "long", rate: 0.2, ruleId: "hybrid-2017-04" });
  });
});

describe("rules not covered", () => {
  it("a sale before 1 Apr 2017 has no rule, and is named", () => {
    expect(ruleFor("equity", "2015-01-01", "2016-06-01")).toBeNull();
    const { problems } = matchSales([buy("2015-01-01", 1, 10), sell("2016-06-01", 1, 12)], schemes("equity"));
    expect(problems[0]!.kind).toBe("before_rules");
  });
});

describe("yearly summary", () => {
  it("applies the ₹1.25 L exemption to equity long-term gains and estimates the tax", () => {
    const two = new Map<string, CgScheme>([
      ["s", { name: "Long held", taxClass: "equity" }],
      ["t", { name: "Recent", taxClass: "equity" }],
    ]);
    const { lines } = matchSales([buy("2020-01-01", 1000, 100), sell("2025-06-01", 1000, 400), buy("2025-01-01", 100, 100, "t"), sell("2025-05-01", 100, 150, "t")], two);
    const s = summarise(lines, 2025);
    const long = s.buckets.find((b) => b.term === "long")!;
    const short = s.buckets.find((b) => b.term === "short")!;
    expect(long).toMatchObject({ net: 300000, exempted: 125000, tax: 21875 });
    expect(short).toMatchObject({ net: 5000, tax: 1000 });
    expect(s.estimatedTax).toBe(22875);
    expect(s.longTerm).toBe(300000);
  });

  it("FY 2024-25: the exemption goes to the 12.5% gains first, then the 10% ones", () => {
    const { lines } = matchSales([buy("2020-01-01", 1000, 100), sell("2024-06-01", 500, 300), sell("2024-09-01", 500, 300)], schemes("equity"));
    const s = summarise(lines, 2024);
    expect(s.buckets.map((b) => [b.rate, b.net, b.exempted, b.tax])).toEqual([
      [0.125, 100000, 100000, 0],
      [0.1, 100000, 25000, 7500],
    ]);
  });

  it("losses are set off within the same kind; slab-rate gains are listed as income, not taxed here", () => {
    const txns: CgTxn[] = [buy("2024-01-01", 100, 100), sell("2025-06-01", 100, 50), buy("2024-01-01", 100, 100, "d"), sell("2025-06-01", 100, 120, "d")];
    const map = new Map<string, CgScheme>([
      ["s", { name: "Equity", taxClass: "equity" }],
      ["d", { name: "Debt", taxClass: "debt" }],
    ]);
    const s = summarise(matchSales(txns, map).lines, 2025);
    expect(s.buckets.find((b) => b.key === "slab")).toMatchObject({ net: 2000, tax: null });
    expect(s.slabIncome).toBe(2000);
    expect(s.buckets.find((b) => b.key.startsWith("equity"))).toMatchObject({ losses: 5000, net: -5000, tax: 0 });
  });

  it("lists the years with sales, newest first", () => {
    const { lines } = matchSales([buy("2020-01-01", 10, 10), sell("2023-06-01", 5, 20), sell("2025-06-01", 5, 20)], schemes("equity"));
    expect(yearsWithSales(lines)).toEqual([2025, 2023]);
  });
});

describe("how a scheme is taxed, from its AMFI category", () => {
  const cls = (category: string | null, name = "Some Fund") => taxClassOf(category, name).taxClass;
  it("reads the SEBI categories", () => {
    expect(cls("Equity Scheme - Flexi Cap Fund")).toBe("equity");
    expect(cls("Equity Scheme - ELSS")).toBe("equity");
    expect(cls("Debt Scheme - Liquid Fund")).toBe("debt");
    expect(cls("Hybrid Scheme - Aggressive Hybrid Fund")).toBe("equity");
    expect(cls("Hybrid Scheme - Arbitrage Fund")).toBe("equity");
    expect(cls("Hybrid Scheme - Dynamic Asset Allocation or Balanced Advantage")).toBe("equity");
    expect(cls("Hybrid Scheme - Conservative Hybrid Fund")).toBe("debt");
    expect(cls("Hybrid Scheme - Balanced Hybrid Fund")).toBe("hybrid");
    expect(cls("Other Scheme - Gold ETF")).toBe("other");
    expect(cls("Other Scheme - FoF Overseas")).toBe("other");
  });
  it("tells index funds apart by name", () => {
    expect(cls("Other Scheme - Index Funds", "UTI Nifty 50 Index Fund - Regular Plan - Growth Option")).toBe("equity");
    expect(cls("Other Scheme - Index Funds", "Bharat Bond Index Fund - April 2030")).toBe("debt");
    expect(cls("Other Scheme - Index Funds", "Motilal Oswal Nasdaq 100 Index Fund")).toBe("other");
  });
  it("marks a guess when the category doesn't settle it", () => {
    expect(taxClassOf("Hybrid Scheme - Multi Asset Allocation", "X").guessed).toBe(true);
    expect(taxClassOf(null, "Mystery Fund").guessed).toBe(true);
    expect(taxClassOf("Equity Scheme - Large Cap Fund", "X").guessed).toBe(false);
  });
});
