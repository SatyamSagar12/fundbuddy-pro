/**
 * Market data jobs (shared by every practice, run as the database owner):
 *
 *  1. importNavAll:  the daily AMFI file → every scheme's name, codes and latest NAV (~15,000 rows, only changed
 *                    rows are written), plus that day's NAV into the history of schemes clients hold.
 *  2. fillUnits:     entries matched to a scheme but without units get them from the NAV of their date (or the
 *                    next day with a NAV), fetching that scheme's history from mfapi.in the first time.
 *
 * Cloudflare Pages has no scheduled jobs, so `refreshIfDue` runs after a page request (in the background) when
 * the last import is more than 6 hours old. A Worker cron or `POST /__maintenance/nav` can run it too.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "./db/client";
import { instruments, marketState, navPrices } from "./db/schema";
import { parseMfapiHistory, parseNavAll, type AmfiScheme } from "@/lib/amfi";
import { UNIT_TYPES } from "@/lib/holdings";

export type Fetcher = (url: string) => Promise<string>;

export const NAVALL_URLS = ["https://portal.amfiindia.com/spages/NAVAll.txt", "https://www.amfiindia.com/spages/NAVAll.txt"];
export const historyUrl = (amfiCode: string) => `https://api.mfapi.in/mf/${encodeURIComponent(amfiCode)}`;

export const httpFetcher: Fetcher = async (url) => {
  const res = await fetch(url, {
    headers: { "user-agent": "AnqulasFolio/1.0 (+https://folio.anqulas.com)", accept: "text/plain, application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
};

async function getState(key: string): Promise<{ value: string | null; updatedAt: Date } | null> {
  const [row] = await db().select({ value: marketState.value, updatedAt: marketState.updatedAt }).from(marketState).where(eq(marketState.key, key));
  return row ?? null;
}

async function setState(key: string, value: string): Promise<void> {
  await db()
    .insert(marketState)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: marketState.key, set: { value, updatedAt: new Date() } });
}

export type NavImportResult = { schemes: number; changed: number; navDate: string | null; tracked: number };

/** Saves a parsed NAVAll file. Writes only rows whose details or NAV changed. */
export async function saveNavAll(schemes: AmfiScheme[], minSchemes = 1000): Promise<NavImportResult> {
  if (schemes.length < minSchemes) {
    // A real file has ~15,000 schemes. A short one is an error page or a cut-off download: keep yesterday's data.
    throw new Error(`NAV file looks incomplete (${schemes.length} schemes)`);
  }
  return saveSchemes(schemes);
}

export async function saveSchemes(schemes: AmfiScheme[]): Promise<NavImportResult> {
  let changed = 0;
  const unique = [...new Map(schemes.map((s) => [s.amfiCode, s])).values()];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500).map((s) => ({
      kind: "mutual_fund",
      country: "IN",
      currency: "INR",
      amfiCode: s.amfiCode,
      isin: s.isin,
      isinReinvest: s.isinReinvest,
      name: s.name,
      amc: s.amc,
      category: s.category,
      schemeType: s.schemeType,
      plan: s.plan,
      option: s.option,
      latestNav: s.nav,
      latestNavDate: s.navDate,
      active: true,
    }));
    const ex = (c: string) => sql.raw(`excluded.${c}`);
    const rows = await db()
      .insert(instruments)
      .values(chunk)
      .onConflictDoUpdate({
        target: instruments.amfiCode,
        set: {
          isin: ex("isin"),
          isinReinvest: ex("isin_reinvest"),
          name: ex("name"),
          amc: ex("amc"),
          category: ex("category"),
          schemeType: ex("scheme_type"),
          plan: ex("plan"),
          option: ex("option"),
          // A scheme listed with "N.A." keeps its last known NAV.
          latestNav: sql`coalesce(excluded.latest_nav, ${instruments.latestNav})`,
          latestNavDate: sql`coalesce(excluded.latest_nav_date, ${instruments.latestNavDate})`,
          active: sql`true`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`(${instruments.name}, ${instruments.amc}, ${instruments.category}, ${instruments.isin}, ${instruments.isinReinvest}, ${instruments.schemeType}) is distinct from (excluded.name, excluded.amc, excluded.category, excluded.isin, excluded.isin_reinvest, excluded.scheme_type)
          or (excluded.latest_nav_date is not null and ${instruments.latestNavDate} is distinct from excluded.latest_nav_date)
          or (excluded.latest_nav is not null and ${instruments.latestNav} is distinct from excluded.latest_nav)
          or not ${instruments.active}`,
      })
      .returning({ id: instruments.id });
    changed += rows.length;
  }
  // Schemes clients hold keep a day-by-day history.
  const tracked = await db().execute<{ n: number }>(sql`
    with ins as (
      insert into nav_prices (instrument_id, date, nav)
      select id, latest_nav_date, latest_nav from instruments
      where history_from is not null and latest_nav is not null and latest_nav_date is not null
      on conflict do nothing
      returning 1
    ) select count(*)::int as n from ins`);
  const navDate = unique.reduce<string | null>((m, s) => (s.navDate && (!m || s.navDate > m) ? s.navDate : m), null);
  return { schemes: unique.length, changed, navDate, tracked: [...tracked][0]?.n ?? 0 };
}

export async function importNavAll(fetcher: Fetcher = httpFetcher, minSchemes = 1000): Promise<NavImportResult> {
  let lastError: unknown;
  for (const url of NAVALL_URLS) {
    try {
      const result = await saveNavAll(parseNavAll(await fetcher(url)), minSchemes);
      await setState("nav_import", JSON.stringify({ ...result, at: new Date().toISOString() }));
      return result;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Loads a scheme's NAV history from `from` on. Returns false if the source had nothing. */
export async function loadHistory(instrumentId: string, amfiCode: string, from: string, fetcher: Fetcher = httpFetcher): Promise<boolean> {
  const rows = parseMfapiHistory(JSON.parse(await fetcher(historyUrl(amfiCode)))).filter((r) => r.date >= from);
  for (let i = 0; i < rows.length; i += 1000) {
    await db()
      .insert(navPrices)
      .values(rows.slice(i, i + 1000).map((r) => ({ instrumentId, date: r.date, nav: r.nav })))
      .onConflictDoNothing();
  }
  // Tried from `from` on, even if the scheme started later: no need to ask again.
  await db()
    .update(instruments)
    .set({ historyFrom: sql`least(coalesce(${instruments.historyFrom}, ${from}::date), ${from}::date)` })
    .where(eq(instruments.id, instrumentId));
  return rows.length > 0;
}

function minusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
}

const unitTypes = sql.join(UNIT_TYPES.map((t) => sql`${t}`), sql`, `);

/**
 * Gives units to entries that have a scheme but no units: units = amount ÷ NAV of the trade date, or of the next
 * day with a NAV (within 10 days), less stamp duty on purchases (same rule as `unitsFor` in lib/holdings.ts).
 * `practiceId` limits it to one practice (after someone matches schemes); `maxFetches` bounds history downloads.
 */
export async function fillUnits(opts: { practiceId?: string; maxFetches?: number; fetcher?: Fetcher } = {}): Promise<{ filled: number; fetched: number; failed: number }> {
  const practice = opts.practiceId ? sql`and t.practice_id = ${opts.practiceId}` : sql``;
  const needs = await db().execute<{ instrument_id: string; amfi_code: string | null; history_from: string | null; first: string }>(sql`
    select t.instrument_id, i.amfi_code, i.history_from::text, min(t.trade_date)::text as first
    from transactions t join instruments i on i.id = t.instrument_id
    where t.units is null and t.type in (${unitTypes}) ${practice}
    group by t.instrument_id, i.amfi_code, i.history_from`);
  let fetched = 0;
  let failed = 0;
  for (const n of needs) {
    const from = minusDays(n.first, 10);
    if (n.history_from && n.history_from <= from) continue;
    if (!n.amfi_code) continue;
    if (fetched + failed >= (opts.maxFetches ?? 25)) break;
    try {
      await loadHistory(n.instrument_id, n.amfi_code, from, opts.fetcher);
      fetched++;
    } catch (e) {
      failed++;
      console.error(`NAV history for ${n.amfi_code} failed:`, e instanceof Error ? e.message : e);
    }
  }
  const filled = await db().execute<{ n: number }>(sql`
    with m as (
      select t.id,
        (select p.nav from nav_prices p
          where p.instrument_id = t.instrument_id and p.date >= t.trade_date and p.date <= t.trade_date + 10
          order by p.date limit 1) as nav
      from transactions t
      where t.instrument_id is not null and t.units is null and t.type in (${unitTypes}) ${practice}
    ), u as (
      update transactions t
      set nav = m.nav,
          units = round(t.amount * (case when t.type in ('purchase', 'sip', 'switch_in') and t.trade_date >= date '2020-07-01' then 0.99995 else 1 end) / m.nav, 4),
          units_estimated = true
      from m where t.id = m.id and m.nav is not null and m.nav > 0
      returning 1
    ) select count(*)::int as n from u`);
  return { filled: [...filled][0]?.n ?? 0, fetched, failed };
}

const IMPORT_EVERY_MS = 6 * 3600 * 1000;
const RETRY_AFTER = "1 hour";
let lastCheck = 0;

/**
 * Imports NAVs if the last import is over 6 hours old, then fills units. Safe to call on every request: it checks
 * the database at most every 10 minutes per app instance, and only one instance at a time does the work
 * (claimed with an atomic update; a failed attempt is retried after an hour).
 */
export async function refreshIfDue(fetcher: Fetcher = httpFetcher): Promise<NavImportResult | null> {
  if (Date.now() - lastCheck < 10 * 60 * 1000) return null;
  lastCheck = Date.now();
  const last = await getState("nav_import");
  if (last && Date.now() - last.updatedAt.getTime() < IMPORT_EVERY_MS) return null;
  const claimed = await db().execute(sql`
    insert into market_state (key, value, updated_at) values ('nav_attempt', null, now())
    on conflict (key) do update set updated_at = now()
    where market_state.updated_at < now() - ${RETRY_AFTER}::interval
    returning key`);
  if (![...claimed].length) return null;
  return runNavJobs(fetcher);
}

export async function runNavJobs(fetcher: Fetcher = httpFetcher, minSchemes = 1000): Promise<NavImportResult & { filled: number }> {
  const result = await importNavAll(fetcher, minSchemes);
  const fill = await fillUnits({ fetcher });
  return { ...result, filled: fill.filled };
}

export async function navStatus(): Promise<{ lastImport: (NavImportResult & { at: string }) | null; schemes: number; tracked: number; pendingUnits: number }> {
  const last = await getState("nav_import");
  const [counts] = await db()
    .select({
      schemes: sql<number>`count(*)::int`,
      tracked: sql<number>`count(*) filter (where ${instruments.historyFrom} is not null)::int`,
    })
    .from(instruments);
  const [pending] = await db().execute<{ n: number }>(
    sql`select count(*)::int as n from transactions where instrument_id is not null and units is null and type in (${unitTypes})`,
  );
  return {
    lastImport: last?.value ? JSON.parse(last.value) : null,
    schemes: counts?.schemes ?? 0,
    tracked: counts?.tracked ?? 0,
    pendingUnits: pending?.n ?? 0,
  };
}
