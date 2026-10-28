/**
 * Holdings and their value, read inside a practice scope (row-level security applies).
 * One pass over the practice's matched entries; the same numbers feed Home, Clients and a client's page.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Tx } from "./db/scope";
import { instruments, sips, transactions } from "./db/schema";
import { combine, valueHolding, type Holding } from "@/lib/holdings";

export type HoldingRow = Holding & {
  investorId: string;
  instrumentId: string;
  name: string;
  category: string | null;
  nav: number | null;
  navDate: string | null;
  estimated: boolean;
};

/** One client, several (a family), or everyone the scope can see. */
export type Who = string | readonly string[] | undefined;

const whose = (who: Who) =>
  who === undefined ? undefined : typeof who === "string" ? eq(transactions.investorId, who) : inArray(transactions.investorId, [...who]);

export async function loadHoldings(tx: Tx, investorId?: Who): Promise<HoldingRow[]> {
  if (Array.isArray(investorId) && investorId.length === 0) return [];
  const rows = await tx
    .select({
      investorId: transactions.investorId,
      instrumentId: transactions.instrumentId,
      date: transactions.tradeDate,
      type: transactions.type,
      amount: transactions.amount,
      units: transactions.units,
      estimated: transactions.unitsEstimated,
      name: instruments.name,
      category: instruments.category,
      nav: instruments.latestNav,
      navDate: instruments.latestNavDate,
    })
    .from(transactions)
    .innerJoin(instruments, eq(instruments.id, transactions.instrumentId))
    .where(whose(investorId));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.investorId}:${r.instrumentId}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(r);
  }
  const out: HoldingRow[] = [];
  for (const g of groups.values()) {
    const first = g[0]!;
    const nav = first.nav === null ? null : Number(first.nav);
    const h = valueHolding(
      g.map((r) => ({ date: r.date, type: r.type, amount: Number(r.amount), units: r.units === null ? null : Number(r.units) })),
      nav,
      first.navDate,
    );
    out.push({
      ...h,
      investorId: first.investorId,
      instrumentId: first.instrumentId!,
      name: first.name,
      category: first.category,
      nav,
      navDate: first.navDate,
      estimated: g.some((r) => r.estimated),
    });
  }
  return out.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

/** Entries not matched to a scheme yet, by the scheme name as typed. */
export async function loadUnmatched(tx: Tx, investorId?: Who) {
  if (Array.isArray(investorId) && investorId.length === 0) return [];
  const rows = await tx
    .select({
      scheme: transactions.schemeText,
      entries: sql<number>`count(*)::int`,
      netInvested: sql<string>`coalesce(sum(case when ${transactions.type} in ('redemption', 'switch_out', 'idcw_payout') then -${transactions.amount} when ${transactions.type} = 'idcw_reinvest' then 0 else ${transactions.amount} end), 0)::text`,
    })
    .from(transactions)
    .where(and(isNull(transactions.instrumentId), whose(investorId)))
    .groupBy(transactions.schemeText);
  return rows.map((r) => ({ scheme: r.scheme ?? "(no scheme name)", entries: r.entries, netInvested: Number(r.netInvested) }));
}

/** Distinct scheme names (entries and SIPs) still to match, with how often each is used. */
export async function unmatchedSchemeNames(tx: Tx): Promise<{ scheme: string; entries: number; sips: number; amount: number }[]> {
  const t = await tx
    .select({ scheme: transactions.schemeText, n: sql<number>`count(*)::int`, amount: sql<string>`sum(${transactions.amount})::text` })
    .from(transactions)
    .where(and(isNull(transactions.instrumentId), isNotNull(transactions.schemeText)))
    .groupBy(transactions.schemeText);
  const s = await tx
    .select({ scheme: sips.schemeText, n: sql<number>`count(*)::int` })
    .from(sips)
    .where(and(isNull(sips.instrumentId), isNotNull(sips.schemeText)))
    .groupBy(sips.schemeText);
  const map = new Map<string, { scheme: string; entries: number; sips: number; amount: number }>();
  for (const r of t) map.set(r.scheme!, { scheme: r.scheme!, entries: r.n, sips: 0, amount: Number(r.amount) });
  for (const r of s) {
    const m = map.get(r.scheme!) ?? { scheme: r.scheme!, entries: 0, sips: 0, amount: 0 };
    m.sips = r.n;
    map.set(r.scheme!, m);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount || b.sips - a.sips || a.scheme.localeCompare(b.scheme));
}

export { combine };
