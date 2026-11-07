/**
 * Valuation: units held, cost, current value, gains and XIRR, from a holding's transactions.
 *
 * Units: purchases, SIP instalments, switches in and reinvested IDCW add; redemptions and switches out
 * remove. Cost uses the average-cost method: a redemption takes out its share of the cost, and the
 * difference is the realised gain.
 */

export type Flow = { date: string; amount: number };

const DAY = 86400000;
const t = (date: string) => Date.parse(`${date}T00:00:00Z`);

/**
 * Annualised return of dated cash flows (money in negative, money out positive), as a fraction (0.12 = 12%).
 * Null when there is no answer (all one sign, or less than a day).
 */
export function xirr(flows: Flow[]): number | null {
  const f = flows.filter((x) => x.amount !== 0 && Number.isFinite(x.amount));
  if (f.length < 2 || !f.some((x) => x.amount > 0) || !f.some((x) => x.amount < 0)) return null;
  const t0 = Math.min(...f.map((x) => t(x.date)));
  const years = f.map((x) => (t(x.date) - t0) / (365 * DAY));
  if (Math.max(...years) < 1 / 365) return null;
  const npv = (r: number) => f.reduce((s, x, i) => s + x.amount / Math.pow(1 + r, years[i]!), 0);
  const dnpv = (r: number) => f.reduce((s, x, i) => s - (years[i]! * x.amount) / Math.pow(1 + r, years[i]! + 1), 0);

  // Newton's method from 10%; falls back to bisection when it wanders off.
  let r = 0.1;
  for (let i = 0; i < 50; i++) {
    const v = npv(r);
    const d = dnpv(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (!Number.isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - r) < 1e-9) return next;
    r = next;
  }
  let lo = -0.999999;
  let hi = 100;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7 || hi - lo < 1e-10) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

export const UNITS_IN = ["purchase", "sip", "switch_in", "idcw_reinvest"] as const;
export const UNITS_OUT = ["redemption", "switch_out"] as const;
/** Types that change units, so need units (or a NAV to work them out). */
export const UNIT_TYPES: readonly string[] = [...UNITS_IN, ...UNITS_OUT];

export type HoldingTxn = { date: string; type: string; amount: number; units: number | null };

export type Holding = {
  units: number;
  /** Cost of the units still held. */
  cost: number;
  value: number | null;
  /** Unrealised: value − cost. */
  gain: number | null;
  /** Gain from units already redeemed. */
  realised: number;
  /** Money put in minus money taken out. */
  netInvested: number;
  xirr: number | null;
  /** (value + money out − money in) / money in. */
  absoluteReturn: number | null;
  firstDate: string | null;
  /** Some entries don't have units yet (their NAV isn't in), so the figures leave them out. */
  pendingUnits: number;
  /** Money in (negative) and out (positive), without the current value: for combining holdings. */
  flows: Flow[];
};

export function valueHolding(txns: HoldingTxn[], nav: number | null, navDate: string | null): Holding {
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
  let units = 0;
  let cost = 0;
  let realised = 0;
  let moneyIn = 0;
  let moneyOut = 0;
  let pending = 0;
  const flows: Flow[] = [];
  for (const x of sorted) {
    const isIn = (UNITS_IN as readonly string[]).includes(x.type);
    const isOut = (UNITS_OUT as readonly string[]).includes(x.type);
    if (x.type === "idcw_payout") {
      // Paid out to the client: a return, no change in units.
      moneyOut += x.amount;
      flows.push({ date: x.date, amount: x.amount });
      continue;
    }
    if (!isIn && !isOut) continue;
    if (x.units === null) {
      pending++;
      continue;
    }
    if (isIn) {
      units += x.units;
      cost += x.amount;
      // Reinvested IDCW stays inside the fund: no money moves.
      if (x.type !== "idcw_reinvest") {
        moneyIn += x.amount;
        flows.push({ date: x.date, amount: -x.amount });
      }
    } else {
      const sold = Math.min(x.units, units);
      const costOut = units > 0 ? cost * (sold / units) : 0;
      realised += x.amount - costOut;
      cost -= costOut;
      units -= sold;
      moneyOut += x.amount;
      flows.push({ date: x.date, amount: x.amount });
    }
  }
  if (units < 0.0005) {
    units = 0;
    cost = 0;
  }
  const value = nav !== null ? round2(units * nav) : null;
  const finalFlows = value !== null && value > 0 && navDate ? [...flows, { date: navDate, amount: value }] : flows;
  return {
    units: Math.round(units * 10000) / 10000,
    cost: round2(cost),
    value,
    gain: value !== null ? round2(value - cost) : null,
    realised: round2(realised),
    netInvested: round2(moneyIn - moneyOut),
    xirr: value !== null ? xirr(finalFlows) : null,
    absoluteReturn: value !== null && moneyIn > 0 ? (value + moneyOut - moneyIn) / moneyIn : null,
    firstDate: sorted[0]?.date ?? null,
    pendingUnits: pending,
    flows,
  };
}

/** Totals over several holdings (a client, a family, the whole practice), with one XIRR over all their money. */
export function combine(holdings: (Holding & { navDate: string | null })[]) {
  let value = 0;
  let cost = 0;
  let netInvested = 0;
  let realised = 0;
  let pendingUnits = 0;
  let moneyIn = 0;
  let moneyOut = 0;
  let navDate: string | null = null;
  const flows: Flow[] = [];
  for (const h of holdings) {
    value += h.value ?? 0;
    cost += h.cost;
    netInvested += h.netInvested;
    realised += h.realised;
    pendingUnits += h.pendingUnits;
    for (const f of h.flows) {
      flows.push(f);
      if (f.amount < 0) moneyIn -= f.amount;
      else moneyOut += f.amount;
    }
    if (h.navDate && (!navDate || h.navDate > navDate)) navDate = h.navDate;
  }
  if (navDate && value > 0) flows.push({ date: navDate, amount: value });
  const firstDate = flows.reduce<string | null>((m, f) => (!m || f.date < m ? f.date : m), null);
  return {
    firstDate,
    value: round2(value),
    cost: round2(cost),
    gain: round2(value - cost),
    realised: round2(realised),
    netInvested: round2(netInvested),
    xirr: xirr(flows),
    absoluteReturn: moneyIn > 0 ? (value + moneyOut - moneyIn) / moneyIn : null,
    navDate,
    pendingUnits,
  };
}

/**
 * Units bought or sold for an amount at a NAV. Purchases since 1 July 2020 pay 0.005% stamp duty, so slightly
 * fewer units are allotted. Registrar files give the exact figure; this is the estimate until then.
 */
export function unitsFor(type: string, amount: number, nav: number, date: string): number {
  const stamp = (type === "purchase" || type === "sip" || type === "switch_in") && date >= "2020-07-01" ? 0.99995 : 1;
  return Math.round(((amount * stamp) / nav) * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The return to show: XIRR once money has been in for a year, else the plain (absolute) return, because an
 * annualised figure over a few weeks swings wildly.
 */
export function shownReturn(h: { xirr: number | null; absoluteReturn: number | null; firstDate?: string | null; navDate: string | null }): {
  label: "XIRR" | "Return";
  value: number | null;
} {
  const held = h.firstDate && h.navDate ? (t(h.navDate) - t(h.firstDate)) / DAY : 0;
  return held >= 365 && h.xirr !== null ? { label: "XIRR", value: h.xirr } : { label: "Return", value: h.absoluteReturn };
}
