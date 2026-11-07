/**
 * Capital gains on mutual fund sales, first in, first out (FIFO): each sale uses up the oldest units of the same
 * folio and scheme first. The rules for each piece (short or long term, rate, grandfathering, indexation) come from
 * ./tax-rules.ts.
 *
 * Purchases, SIP instalments, switches in and reinvested IDCW add units at their amount. Redemptions and switches
 * out are sales: their amount is the sale value, shared over the units taken in proportion.
 */
import {
  costInflationIndex,
  exemptionFor,
  fyOf,
  GRANDFATHER_DATE,
  heldMoreThan,
  rateText,
  ruleFor,
  type Rate,
  type TaxClass,
} from "./tax-rules";

export type CgTxn = {
  investorId: string;
  /** Folio id, or "" when the entry has no folio (typed by hand). */
  folio: string;
  instrumentId: string;
  date: string;
  type: string;
  amount: number;
  units: number | null;
};

export type CgScheme = {
  name: string;
  taxClass: TaxClass;
  guessed?: boolean;
  /** NAV on 31 Jan 2018 (or the last day before it with a NAV), for grandfathered equity units. */
  nav31Jan2018?: number | null;
};

export type GainLine = {
  investorId: string;
  folio: string;
  instrumentId: string;
  scheme: string;
  taxClass: TaxClass;
  guessed: boolean;
  sold: string;
  bought: string;
  units: number;
  saleValue: number;
  /** What was paid for these units. */
  cost: number;
  /** Cost after grandfathering (equity units bought by 31 Jan 2018), else the same as `cost`. */
  costUsed: number;
  /** Cost raised by the cost inflation index, when the rule allows indexation. */
  indexedCost: number | null;
  gain: number;
  term: "short" | "long";
  rate: Rate;
  ruleId: string;
  grandfathered: boolean;
  /** A grandfathered unit whose 31 Jan 2018 NAV wasn't found: its actual cost is used. */
  grandfatherNavMissing: boolean;
};

export type CgProblem = { kind: "no_units" | "sold_more_than_bought" | "before_rules"; scheme: string; date: string; units?: number };

const IN = new Set(["purchase", "sip", "switch_in", "idcw_reinvest"]);
const OUT = new Set(["redemption", "switch_out"]);
const EPS = 0.0005;

const r2 = (n: number) => Math.round(n * 100) / 100;

type Lot = { date: string; units: number; costPerUnit: number };

/** Every sale matched to the units it used up, oldest first, across all folios and schemes given. */
export function matchSales(txns: readonly CgTxn[], schemes: ReadonlyMap<string, CgScheme>): { lines: GainLine[]; problems: CgProblem[] } {
  const groups = new Map<string, CgTxn[]>();
  for (const t of txns) {
    if (!IN.has(t.type) && !OUT.has(t.type)) continue;
    const key = `${t.investorId}|${t.folio}|${t.instrumentId}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(t);
  }
  const lines: GainLine[] = [];
  const problems: CgProblem[] = [];
  for (const g of groups.values()) {
    // Same day: units bought that day can be sold that day.
    g.sort((a, b) => a.date.localeCompare(b.date) || Number(OUT.has(a.type)) - Number(OUT.has(b.type)));
    const first = g[0]!;
    const scheme = schemes.get(first.instrumentId) ?? { name: "Unknown scheme", taxClass: "equity" as const, guessed: true };
    const lots: Lot[] = [];
    for (const t of g) {
      if (t.units === null || !(t.units > 0)) {
        if (t.units === null) problems.push({ kind: "no_units", scheme: scheme.name, date: t.date });
        continue;
      }
      if (IN.has(t.type)) {
        lots.push({ date: t.date, units: t.units, costPerUnit: t.amount / t.units });
        continue;
      }
      let left = t.units;
      while (left > EPS && lots.length) {
        const lot = lots[0]!;
        const take = Math.min(lot.units, left);
        lines.push(piece(t, scheme, lot, take, problems));
        lot.units -= take;
        left -= take;
        if (lot.units <= EPS) lots.shift();
      }
      if (left > EPS) problems.push({ kind: "sold_more_than_bought", scheme: scheme.name, date: t.date, units: Math.round(left * 1000) / 1000 });
    }
  }
  lines.sort((a, b) => a.sold.localeCompare(b.sold) || a.scheme.localeCompare(b.scheme) || a.bought.localeCompare(b.bought));
  return { lines, problems };
}

function piece(sale: CgTxn, scheme: CgScheme, lot: Lot, units: number, problems: CgProblem[]): GainLine {
  const saleValue = (sale.amount * units) / sale.units!;
  const cost = lot.costPerUnit * units;
  const rule = ruleFor(scheme.taxClass, lot.date, sale.date);
  const base = {
    investorId: sale.investorId,
    folio: sale.folio,
    instrumentId: sale.instrumentId,
    scheme: scheme.name,
    taxClass: scheme.taxClass,
    guessed: scheme.guessed ?? false,
    sold: sale.date,
    bought: lot.date,
    units: Math.round(units * 10000) / 10000,
    saleValue: r2(saleValue),
    cost: r2(cost),
  };
  if (!rule) {
    problems.push({ kind: "before_rules", scheme: scheme.name, date: sale.date });
    return { ...base, costUsed: r2(cost), indexedCost: null, gain: r2(saleValue - cost), term: "short", rate: "slab", ruleId: "none", grandfathered: false, grandfatherNavMissing: false };
  }
  const long = rule.longAfterMonths !== null && heldMoreThan(lot.date, sale.date, rule.longAfterMonths);
  let costUsed = cost;
  let grandfathered = false;
  let navMissing = false;
  if (long && rule.grandfathered && lot.date <= GRANDFATHER_DATE) {
    const nav = scheme.nav31Jan2018 ?? null;
    if (nav === null) {
      navMissing = true;
    } else {
      // Section 112A: the higher of the actual cost and the lower of the 31 Jan 2018 value and the sale value.
      const fmv = nav * units;
      const stepUp = Math.max(cost, Math.min(fmv, saleValue));
      grandfathered = stepUp > cost;
      costUsed = stepUp;
    }
  }
  const indexedCost = long && rule.indexation ? (costUsed * costInflationIndex(fyOf(sale.date))) / costInflationIndex(fyOf(lot.date)) : null;
  return {
    ...base,
    costUsed: r2(costUsed),
    indexedCost: indexedCost === null ? null : r2(indexedCost),
    gain: r2(saleValue - (indexedCost ?? costUsed)),
    term: long ? "long" : "short",
    rate: long ? rule.longRate : rule.shortRate,
    ruleId: rule.id,
    grandfathered,
    grandfatherNavMissing: navMissing,
  };
}

export type Bucket = {
  key: string;
  label: string;
  term: "short" | "long";
  rate: Rate;
  /** Counts toward the yearly equity long-term exemption. */
  exemptionShared: boolean;
  gains: number;
  losses: number;
  net: number;
  /** Part of the yearly exemption used here. */
  exempted: number;
  /** null for slab-rate gains: they are added to the investor's income. */
  tax: number | null;
};

const KIND: Record<TaxClass, string> = { equity: "Equity", debt: "Debt", hybrid: "Hybrid", other: "Gold, international, FoF" };

function bucketKey(l: GainLine): { key: string; label: string; exemptionShared: boolean } {
  const kind = l.taxClass === "equity" ? "Equity" : l.rate === "slab" ? "Non-equity" : KIND[l.taxClass];
  const term = l.term === "long" ? "long-term" : "short-term";
  const how = l.rate === "slab" ? "added to income (slab rate)" : `${rateText(l.rate)}${l.indexedCost !== null ? " with indexation" : ""}`;
  const exemptionShared = l.taxClass === "equity" && l.term === "long" && l.rate !== 0 && l.rate !== "slab";
  if (l.rate === "slab") return { key: "slab", label: `${kind}: ${how}`, exemptionShared };
  return { key: `${l.taxClass}:${l.term}:${String(l.rate)}:${l.indexedCost !== null}`, label: `${kind}, ${term}: ${how}`, exemptionShared };
}

/**
 * One person's gains for one financial year, by how they're taxed, with an estimated tax before surcharge and cess.
 * Losses are set off only within the same kind here (the ITR allows more, e.g. short-term losses against long-term
 * gains). The yearly exemption on equity long-term gains goes to the higher rate first.
 */
export function summarise(lines: readonly GainLine[], fy: number) {
  const buckets = new Map<string, Bucket>();
  for (const l of lines) {
    if (fyOf(l.sold) !== fy) continue;
    const k = bucketKey(l);
    let b = buckets.get(k.key);
    if (!b) buckets.set(k.key, (b = { key: k.key, label: k.label, term: l.term, rate: l.rate, exemptionShared: k.exemptionShared, gains: 0, losses: 0, net: 0, exempted: 0, tax: null }));
    if (l.gain >= 0) b.gains += l.gain;
    else b.losses -= l.gain;
  }
  const list = [...buckets.values()];
  for (const b of list) {
    b.gains = r2(b.gains);
    b.losses = r2(b.losses);
    b.net = r2(b.gains - b.losses);
  }
  let exemption = exemptionFor(fy);
  const shared = list.filter((b) => b.exemptionShared).sort((a, b) => Number(b.rate) - Number(a.rate));
  for (const b of shared) {
    const use = Math.min(exemption, Math.max(0, b.net));
    b.exempted = r2(use);
    exemption -= use;
  }
  for (const b of list) b.tax = b.rate === "slab" ? null : r2(Math.max(0, b.net - b.exempted) * b.rate);
  sortBuckets(list);
  const sum = (f: (l: GainLine) => number) => r2(lines.filter((l) => fyOf(l.sold) === fy).reduce((s, l) => s + f(l), 0));
  return {
    buckets: list,
    saleValue: sum((l) => l.saleValue),
    cost: sum((l) => l.indexedCost ?? l.costUsed),
    gain: sum((l) => l.gain),
    shortTerm: sum((l) => (l.term === "short" ? l.gain : 0)),
    longTerm: sum((l) => (l.term === "long" ? l.gain : 0)),
    estimatedTax: r2(list.reduce((s, b) => s + (b.tax ?? 0), 0)),
    slabIncome: r2(list.filter((b) => b.rate === "slab").reduce((s, b) => s + Math.max(0, b.net), 0)),
    exemption: exemptionFor(fy),
  };
}

export type YearSummary = ReturnType<typeof summarise>;

/** Equity first, short-term before long-term, higher rates first, slab last. */
export function sortBuckets(list: Bucket[]): Bucket[] {
  const order = (b: Bucket) => (b.key.startsWith("equity") ? 0 : 10) + (b.term === "short" ? 0 : 1) + (b.rate === "slab" ? 5 : 0);
  return list.sort((a, b) => order(a) - order(b) || Number(b.rate) - Number(a.rate));
}

/** Financial years with at least one sale, newest first. */
export function yearsWithSales(lines: readonly GainLine[]): number[] {
  return [...new Set(lines.map((l) => fyOf(l.sold)))].sort((a, b) => b - a);
}
