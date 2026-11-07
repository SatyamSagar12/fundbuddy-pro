/**
 * The morning briefing: what changed in the book and who to call, in one short list.
 * Shown on Home, and emailed to each team member at about 8 am (each sees only the clients they may see).
 */
import { and, desc, gte, inArray, sql } from "drizzle-orm";
import type { Tx } from "./db/scope";
import { investors, transactions } from "./db/schema";
import { combine, loadHoldings, unmatchedSchemeNames } from "./valuation";
import { loadSipBook, sipTotals } from "./sip-book";
import { addDays } from "@/lib/sip-book";

/** A redemption this size or more is worth a call. */
export const BIG_REDEMPTION = 100_000;
const RECENT_DAYS = 7;

export type Person = { investorId: string; client: string; mobile: string | null };

export type Briefing = {
  today: string;
  navDate: string | null;
  value: number;
  /** Change in value since the NAV before the latest one, for holdings with NAV history. */
  dayChange: number | null;
  dayChangePct: number | null;
  sips: ReturnType<typeof sipTotals> & {
    bouncedList: (Person & { scheme: string; amount: number; date: string | null })[];
    endingList: (Person & { scheme: string; amount: number; endDate: string | null })[];
    paidRecent: { count: number; amount: number };
    dueWeek: { count: number; amount: number };
  };
  redemptions: (Person & { scheme: string; amount: number; date: string })[];
  newMoney: { count: number; amount: number };
  birthdays: (Person & { date: string; inDays: number })[];
  unmatched: number;
};

export async function buildBriefing(tx: Tx, today: string): Promise<Briefing & { total: ReturnType<typeof combine> }> {
  const holdings = await loadHoldings(tx);
  const total = combine(holdings);

  // Yesterday's value: every held unit at the NAV before the latest one.
  let dayChange: number | null = null;
  const held = holdings.filter((h) => h.units > 0 && h.nav !== null && h.navDate);
  if (held.length) {
    const ids = [...new Set(held.map((h) => h.instrumentId))];
    const prev = await tx.execute<{ instrument_id: string; nav: string }>(sql`
      select distinct on (p.instrument_id) p.instrument_id, p.nav
      from nav_prices p join instruments i on i.id = p.instrument_id
      where p.instrument_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) and p.date < i.latest_nav_date
      order by p.instrument_id, p.date desc`);
    const before = new Map([...prev].map((r) => [r.instrument_id, Number(r.nav)]));
    let change = 0;
    let found = false;
    for (const h of held) {
      const p = before.get(h.instrumentId);
      if (p === undefined) continue;
      found = true;
      change += h.units * (h.nav! - p);
    }
    if (found) dayChange = Math.round(change);
  }
  const base = total.value - (dayChange ?? 0);

  const book = await loadSipBook(tx, today);
  const people = await tx
    .select({ id: investors.id, name: investors.name, mobile: investors.mobile, dob: investors.dob })
    .from(investors);
  const byId = new Map(people.map((p) => [p.id, p]));
  const person = (id: string): Person => ({ investorId: id, client: byId.get(id)?.name ?? "", mobile: byId.get(id)?.mobile ?? null });

  const since = addDays(today, -RECENT_DAYS);
  const weekAhead = addDays(today, 7);
  const recentSip = book.rows.filter((r) => r.lastPaid && r.lastPaid >= since);
  const due = book.rows.filter((r) => (r.status === "active" || r.status === "bounced") && r.nextDue && r.nextDue >= today && r.nextDue <= weekAhead);

  const recent = await tx
    .select({
      investorId: transactions.investorId,
      type: transactions.type,
      amount: transactions.amount,
      date: transactions.tradeDate,
      scheme: transactions.schemeText,
    })
    .from(transactions)
    .where(and(gte(transactions.tradeDate, since), inArray(transactions.type, ["purchase", "redemption"])))
    .orderBy(desc(transactions.tradeDate));
  const bigOut = recent.filter((t) => t.type === "redemption" && Number(t.amount) >= BIG_REDEMPTION);
  const newIn = recent.filter((t) => t.type === "purchase" && Number(t.amount) > 0);

  // Birthdays in the next 7 days (29 Feb counts on 28 Feb in other years).
  const birthdays: Briefing["birthdays"] = [];
  for (const p of people) {
    if (!p.dob) continue;
    for (let i = 0; i <= 7; i++) {
      const d = addDays(today, i);
      const md = p.dob.slice(5) === "02-29" && !isLeap(+d.slice(0, 4)) ? "02-28" : p.dob.slice(5);
      if (d.slice(5) === md) {
        birthdays.push({ ...person(p.id), date: d, inDays: i });
        break;
      }
    }
  }
  birthdays.sort((a, b) => a.inDays - b.inDays || a.client.localeCompare(b.client));

  return {
    total,
    today,
    navDate: total.navDate,
    value: Math.round(total.value),
    dayChange,
    dayChangePct: dayChange !== null && base > 0 ? dayChange / base : null,
    sips: {
      ...sipTotals(book.rows),
      bouncedList: book.rows
        .filter((r) => r.status === "bounced")
        .map((r) => ({ ...person(r.investorId), scheme: r.scheme, amount: r.amount, date: r.lastBounce })),
      endingList: book.rows
        .filter((r) => r.endingSoon)
        .map((r) => ({ ...person(r.investorId), scheme: r.scheme, amount: r.amount, endDate: r.endDate })),
      paidRecent: { count: recentSip.length, amount: Math.round(recentSip.reduce((s, r) => s + r.amount, 0)) },
      dueWeek: { count: due.length, amount: Math.round(due.reduce((s, r) => s + r.amount, 0)) },
    },
    redemptions: bigOut.map((t) => ({ ...person(t.investorId), scheme: t.scheme ?? "", amount: Number(t.amount), date: t.date })),
    newMoney: { count: newIn.length, amount: Math.round(newIn.reduce((s, t) => s + Number(t.amount), 0)) },
    birthdays,
    unmatched: (await unmatchedSchemeNames(tx)).length,
  };
}

function isLeap(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** True when the briefing has something worth an email. */
export function worthSending(b: Briefing): boolean {
  return b.value > 0 || b.sips.bounced > 0 || b.redemptions.length > 0 || b.birthdays.length > 0 || b.sips.active > 0;
}

