/**
 * Indian capital gains rules for mutual fund units, resident individuals. The one place to change when a Budget
 * changes them: add a row with the new dates (and bump TAX_RULES_VERSION). Rules are matched top to bottom; the
 * first row whose dates fit a sale is used.
 *
 * Checked 28 Oct 2026 against the AMC tax reckoners for FY 2026-27 (Budget 2026 changed no capital gains rate):
 *  - Equity-oriented funds (over 65% in Indian equity): long-term when held more than 12 months.
 *      Sold before 1 Apr 2018: long-term exempt, short-term 15%.
 *      1 Apr 2018 – 22 Jul 2024: long-term 10% above ₹1 L a year, short-term 15%.
 *      From 23 Jul 2024: long-term 12.5% above ₹1.25 L a year (₹1.25 L for all of FY 2024-25), short-term 20%.
 *      Units bought on or before 31 Jan 2018 ("grandfathered"): cost is the higher of the actual cost and the lower
 *      of the 31 Jan 2018 value and the sale value.
 *  - Debt funds (over 65% in debt and money market; "specified mutual fund", section 50AA):
 *      Bought on or after 1 Apr 2023: always short-term, taxed at the investor's slab rate.
 *      Bought earlier: long-term after 36 months at 20% with indexation (sold before 23 Jul 2024), after 24 months
 *      at 12.5% without indexation (sold from 23 Jul 2024). Short-term at slab.
 *  - Other funds (gold, silver, international, most funds of funds): until 31 Mar 2025 the old definition
 *      (at most 35% in Indian equity) made them "specified" too, so units bought from 1 Apr 2023 and sold before
 *      1 Apr 2025 are at slab. Otherwise as older debt: 24 months, 12.5% (36 months, 20% indexed before 23 Jul 2024).
 *  - Hybrid funds with 35–65% in Indian equity were never "specified": as older debt, whenever bought.
 *
 * Sales before 1 Apr 2017 are not covered. ETFs bought on an exchange follow the 12-month listed rule for some
 * kinds; they are rare in a distributor's book and are treated as their underlying kind here.
 */

export const TAX_RULES_VERSION = "FY 2026-27 rules (Budget 2026 made no change), checked 28 Oct 2026";

export type TaxClass = "equity" | "debt" | "hybrid" | "other";
export type Rate = number | "slab";

export type TaxRule = {
  id: string;
  taxClass: TaxClass;
  /** Sale dates covered: from (inclusive) and before (exclusive, null = still in force). */
  soldFrom: string;
  soldBefore: string | null;
  /** Only units bought in this window (optional). */
  boughtFrom?: string;
  /** Long-term when held more than this many months; null = always short-term, at slab (section 50AA). */
  longAfterMonths: number | null;
  shortRate: Rate;
  /** 0 = exempt. */
  longRate: Rate;
  /** Long-term cost raised by the cost inflation index. */
  indexation: boolean;
  /** Units bought on or before 31 Jan 2018 use the 31 Jan 2018 value as cost (section 112A). */
  grandfathered: boolean;
  /** Long-term gains share the yearly exemption (₹1 L, then ₹1.25 L) (section 112A). */
  yearlyExemption: boolean;
};

const A = { indexation: false, grandfathered: false, yearlyExemption: false };

export const TAX_RULES: readonly TaxRule[] = [
  // Equity-oriented funds
  { id: "equity-2024-07", taxClass: "equity", soldFrom: "2024-07-23", soldBefore: null, longAfterMonths: 12, shortRate: 0.2, longRate: 0.125, ...A, grandfathered: true, yearlyExemption: true },
  { id: "equity-2018-04", taxClass: "equity", soldFrom: "2018-04-01", soldBefore: "2024-07-23", longAfterMonths: 12, shortRate: 0.15, longRate: 0.1, ...A, grandfathered: true, yearlyExemption: true },
  { id: "equity-2017-04", taxClass: "equity", soldFrom: "2017-04-01", soldBefore: "2018-04-01", longAfterMonths: 12, shortRate: 0.15, longRate: 0, ...A },
  // Debt funds
  { id: "debt-50aa", taxClass: "debt", soldFrom: "2023-04-01", soldBefore: null, boughtFrom: "2023-04-01", longAfterMonths: null, shortRate: "slab", longRate: "slab", ...A },
  { id: "debt-2024-07", taxClass: "debt", soldFrom: "2024-07-23", soldBefore: null, longAfterMonths: 24, shortRate: "slab", longRate: 0.125, ...A },
  { id: "debt-2017-04", taxClass: "debt", soldFrom: "2017-04-01", soldBefore: "2024-07-23", longAfterMonths: 36, shortRate: "slab", longRate: 0.2, ...A, indexation: true },
  // Gold, international, funds of funds
  { id: "other-50aa", taxClass: "other", soldFrom: "2023-04-01", soldBefore: "2025-04-01", boughtFrom: "2023-04-01", longAfterMonths: null, shortRate: "slab", longRate: "slab", ...A },
  { id: "other-2024-07", taxClass: "other", soldFrom: "2024-07-23", soldBefore: null, longAfterMonths: 24, shortRate: "slab", longRate: 0.125, ...A },
  { id: "other-2017-04", taxClass: "other", soldFrom: "2017-04-01", soldBefore: "2024-07-23", longAfterMonths: 36, shortRate: "slab", longRate: 0.2, ...A, indexation: true },
  // Hybrid funds with 35–65% in Indian equity
  { id: "hybrid-2024-07", taxClass: "hybrid", soldFrom: "2024-07-23", soldBefore: null, longAfterMonths: 24, shortRate: "slab", longRate: 0.125, ...A },
  { id: "hybrid-2017-04", taxClass: "hybrid", soldFrom: "2017-04-01", soldBefore: "2024-07-23", longAfterMonths: 36, shortRate: "slab", longRate: 0.2, ...A, indexation: true },
];

/** Yearly exemption for equity long-term gains, by financial year (the year it starts). */
export const LTCG_EXEMPTION: readonly { fromFy: number; amount: number }[] = [
  { fromFy: 2018, amount: 100000 },
  { fromFy: 2024, amount: 125000 },
];

/** Cost inflation index (base FY 2001-02 = 100), by the year the financial year starts. Needed for sales before 23 Jul 2024. */
export const COST_INFLATION_INDEX: Readonly<Record<number, number>> = {
  2001: 100, 2002: 105, 2003: 109, 2004: 113, 2005: 117, 2006: 122, 2007: 129, 2008: 137, 2009: 148, 2010: 167,
  2011: 184, 2012: 200, 2013: 220, 2014: 240, 2015: 254, 2016: 264, 2017: 272, 2018: 280, 2019: 289, 2020: 301,
  2021: 317, 2022: 331, 2023: 348, 2024: 363,
};

/** Units bought on or before this day are grandfathered (equity, section 112A). */
export const GRANDFATHER_DATE = "2018-01-31";

export const TAX_CLASS_LABEL: Record<TaxClass, string> = {
  equity: "Equity fund",
  debt: "Debt fund",
  hybrid: "Hybrid fund",
  other: "Gold, international or fund of funds",
};

/** The financial year a date falls in, by the year it starts: 2025-06-01 → 2025 (FY 2025-26). */
export function fyOf(date: string): number {
  const y = Number(date.slice(0, 4));
  return date.slice(5) >= "04-01" ? y : y - 1;
}

export const fyLabel = (fy: number) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
export const fyRange = (fy: number) => ({ from: `${fy}-04-01`, to: `${fy + 1}-03-31` });

export function addMonths(date: string, months: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + months;
  const d = Number(date.slice(8, 10));
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  // 31 Jan + 1 month = 28/29 Feb (the last day of the shorter month).
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** "Held for more than N months": sold after the same date N months later. */
export function heldMoreThan(bought: string, sold: string, months: number): boolean {
  return sold > addMonths(bought, months);
}

export function ruleFor(taxClass: TaxClass, bought: string, sold: string): TaxRule | null {
  return (
    TAX_RULES.find(
      (r) => r.taxClass === taxClass && sold >= r.soldFrom && (r.soldBefore === null || sold < r.soldBefore) && (!r.boughtFrom || bought >= r.boughtFrom),
    ) ?? null
  );
}

export function exemptionFor(fy: number): number {
  let amount = 0;
  for (const e of LTCG_EXEMPTION) if (fy >= e.fromFy) amount = e.amount;
  return amount;
}

export function costInflationIndex(fy: number): number {
  return COST_INFLATION_INDEX[Math.max(2001, fy)] ?? COST_INFLATION_INDEX[2024]!;
}

const DEBT_WORDS = /\b(gilt|g-?sec|sdl|bond|debt|psu|crisil|target maturity|liquid|t-?bill|money market|corporate|overnight|treasury|income)\b/i;
const OTHER_WORDS = /\b(nasdaq|s&p|us|usa|u\.s\.|nyse|fang\+?|hang seng|global|international|world|overseas|msci|gold|silver|china|japan|europe|emerging markets?)\b/i;

/**
 * How a scheme is taxed, from its AMFI category (and its name, for index funds, ETFs and funds of funds).
 * `guessed` is true when the category doesn't settle it, so the report can say "check this".
 */
export function taxClassOf(category: string | null, name: string): { taxClass: TaxClass; guessed: boolean } {
  const c = (category ?? "").toLowerCase();
  const n = name.toLowerCase();
  const by = (taxClass: TaxClass, guessed = false) => ({ taxClass, guessed });
  if (c.startsWith("equity scheme") || /\belss\b/.test(c)) return by("equity");
  if (c.startsWith("debt scheme")) return by("debt");
  if (c.startsWith("hybrid scheme")) {
    if (/conservative/.test(c)) return by("debt");
    if (/aggressive|arbitrage|equity savings|balanced advantage|dynamic asset/.test(c)) return by("equity");
    if (/balanced hybrid/.test(c)) return by("hybrid");
    return by("hybrid", true); // multi asset allocation: depends on the fund's mix
  }
  if (c.startsWith("solution oriented")) {
    if (/debt|conservative|income/.test(n)) return by("debt", true);
    if (/hybrid|balanced/.test(n)) return by("hybrid", true);
    return by("equity", true);
  }
  if (/gold|silver/.test(c)) return by("other");
  if (/fof overseas|overseas/.test(c)) return by("other");
  if (/index fund|etf|fund of funds|fof/.test(c)) {
    if (OTHER_WORDS.test(n)) return by("other");
    if (DEBT_WORDS.test(n)) return by("debt");
    if (/fof|fund of funds/.test(c)) return by("other", true);
    return by("equity");
  }
  // Old category names (before SEBI's 2017 categories) and missing categories.
  if (/^(income|gilt|liquid|money market|floating rate)/.test(c)) return by("debt");
  if (/^(growth|elss|equity)/.test(c)) return by("equity");
  if (/^balanced/.test(c)) return by("hybrid", true);
  if (OTHER_WORDS.test(n)) return by("other", true);
  if (DEBT_WORDS.test(n)) return by("debt", true);
  return by("equity", true);
}

/** "20%", "12.5%", "Slab", "Exempt". */
export function rateText(rate: Rate): string {
  if (rate === "slab") return "Slab";
  if (rate === 0) return "Exempt";
  return `${Math.round(rate * 1000) / 10}%`;
}
