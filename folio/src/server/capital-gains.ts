/**
 * Capital gains for one client or one family: loads their whole transaction history (FIFO needs every purchase),
 * the schemes' categories, and the 31 Jan 2018 NAVs that grandfathered equity units need. The maths is in
 * src/lib/capital-gains.ts.
 */
import { and, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "./db/client";
import type { Tx } from "./db/scope";
import { folios, instruments, navPrices, transactions } from "./db/schema";
import { historyUrl, httpFetcher, type Fetcher } from "./nav";
import { parseMfapiHistory } from "@/lib/amfi";
import { matchSales, type CgScheme, type CgTxn } from "@/lib/capital-gains";
import { GRANDFATHER_DATE, taxClassOf } from "@/lib/tax-rules";

const UNIT_TYPES = ["purchase", "sip", "switch_in", "idcw_reinvest", "redemption", "switch_out"];
const SALES = ["redemption", "switch_out"];
/** The 31 Jan 2018 NAV, or the last one before it within a week (a scheme closed that day). */
const NAV_FROM = "2018-01-24";

/** Everything the FIFO match needs, read in the member's scope (row-level security applies). */
export async function loadGainsInput(tx: Tx, investorIds: readonly string[]) {
  if (!investorIds.length) return { txns: [], schemes: new Map<string, CgScheme & { amfiCode: string | null }>(), folioNos: new Map<string, string>(), unmatchedSales: 0 };
  const ids = [...investorIds];
  const rows = await tx
    .select({
      investorId: transactions.investorId,
      folioId: transactions.folioId,
      instrumentId: transactions.instrumentId,
      date: transactions.tradeDate,
      type: transactions.type,
      amount: transactions.amount,
      units: transactions.units,
    })
    .from(transactions)
    .where(and(inArray(transactions.investorId, ids), isNotNull(transactions.instrumentId), inArray(transactions.type, UNIT_TYPES)));
  const [unmatched] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(inArray(transactions.investorId, ids), isNull(transactions.instrumentId), inArray(transactions.type, SALES)));
  const instrumentIds = [...new Set(rows.map((r) => r.instrumentId!))];
  const info = instrumentIds.length
    ? await tx
        .select({ id: instruments.id, name: instruments.name, category: instruments.category, amfiCode: instruments.amfiCode })
        .from(instruments)
        .where(inArray(instruments.id, instrumentIds))
    : [];
  const folioRows = await tx.select({ id: folios.id, folioNo: folios.folioNo }).from(folios).where(inArray(folios.investorId, ids));
  const schemes = new Map<string, CgScheme & { amfiCode: string | null }>();
  for (const i of info) {
    const c = taxClassOf(i.category, i.name);
    schemes.set(i.id, { name: i.name, taxClass: c.taxClass, guessed: c.guessed, amfiCode: i.amfiCode, nav31Jan2018: null });
  }
  const txns: CgTxn[] = rows.map((r) => ({
    investorId: r.investorId,
    folio: r.folioId ?? "",
    instrumentId: r.instrumentId!,
    date: r.date,
    type: r.type,
    amount: Number(r.amount),
    units: r.units === null ? null : Number(r.units),
  }));
  return { txns, schemes, folioNos: new Map(folioRows.map((f) => [f.id, f.folioNo])), unmatchedSales: unmatched?.n ?? 0 };
}

/**
 * Fills `nav31Jan2018` for equity schemes with units bought by 31 Jan 2018 that were later sold. Read from the stored
 * history; when it isn't there (the history starts later), fetched once from mfapi.in and only that week stored.
 * Runs as the database owner (NAVs are shared market data), outside any practice scope.
 */
export async function fillGrandfatherNavs(
  txns: readonly CgTxn[],
  schemes: Map<string, CgScheme & { amfiCode: string | null }>,
  opts: { fetcher?: Fetcher; maxFetches?: number } = {},
): Promise<void> {
  const sold = new Set(txns.filter((t) => SALES.includes(t.type)).map((t) => t.instrumentId));
  const need = [...new Set(txns.filter((t) => t.date <= GRANDFATHER_DATE && sold.has(t.instrumentId) && !SALES.includes(t.type)).map((t) => t.instrumentId))].filter(
    (id) => schemes.get(id)?.taxClass === "equity",
  );
  if (!need.length) return;
  const stored = async () =>
    db()
      .selectDistinctOn([navPrices.instrumentId], { instrumentId: navPrices.instrumentId, nav: navPrices.nav })
      .from(navPrices)
      .where(and(inArray(navPrices.instrumentId, need), gte(navPrices.date, NAV_FROM), lte(navPrices.date, GRANDFATHER_DATE)))
      .orderBy(navPrices.instrumentId, sql`${navPrices.date} desc`);
  let found = new Map((await stored()).map((r) => [r.instrumentId, Number(r.nav)]));
  let fetches = 0;
  for (const id of need) {
    const code = schemes.get(id)?.amfiCode;
    if (found.has(id) || !code || fetches >= (opts.maxFetches ?? 8)) continue;
    fetches++;
    try {
      const rows = parseMfapiHistory(JSON.parse(await (opts.fetcher ?? httpFetcher)(historyUrl(code)))).filter((r) => r.date >= NAV_FROM && r.date <= GRANDFATHER_DATE);
      if (rows.length) await db().insert(navPrices).values(rows.map((r) => ({ instrumentId: id, date: r.date, nav: r.nav }))).onConflictDoNothing();
    } catch (e) {
      console.error(`31 Jan 2018 NAV for ${code} failed:`, e instanceof Error ? e.message : e);
    }
  }
  if (fetches) found = new Map((await stored()).map((r) => [r.instrumentId, Number(r.nav)]));
  for (const [id, nav] of found) {
    const s = schemes.get(id);
    if (s) s.nav31Jan2018 = nav;
  }
}

export async function gainsFor(load: () => Promise<Awaited<ReturnType<typeof loadGainsInput>>>, opts: { fetcher?: Fetcher } = {}) {
  const input = await load();
  await fillGrandfatherNavs(input.txns, input.schemes, opts);
  return { ...matchSales(input.txns, input.schemes), folioNos: input.folioNos, unmatchedSales: input.unmatchedSales };
}
