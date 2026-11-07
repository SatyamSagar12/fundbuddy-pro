/**
 * The practice's SIP book: SIPs found in the registrars' transactions (src/lib/sip-book.ts), merged with SIPs
 * typed in by hand or brought over from the old app. Read inside a practice scope (row-level security applies).
 *
 * A typed SIP that the registrar data also shows is listed once, with the registrar's status (it is the truth),
 * and stays editable. A typed SIP the registrar data doesn't show keeps its typed status.
 */
import { and, eq, inArray, lt, or } from "drizzle-orm";
import type { Tx } from "./db/scope";
import { folios, instruments, investors, sips, transactions } from "./db/schema";
import { addMonths, daysBetween, detectSips, inflowByMonth, monthlyAmount, type SipFrequency } from "@/lib/sip-book";
import { baseName } from "@/lib/scheme-match";

export type SipStatus = "active" | "bounced" | "missed" | "paused" | "stopped";

export type SipRow = {
  /** The typed SIP's id (edit/delete), or `auto:` plus the series key for one found in registrar data. */
  id: string;
  typedId: string | null;
  investorId: string;
  client: string;
  scheme: string;
  instrumentId: string | null;
  folioNo: string | null;
  amount: number;
  frequency: SipFrequency | "daily";
  startDate: string;
  endDate: string | null;
  lastPaid: string | null;
  lastBounce: string | null;
  bouncesYear: number;
  nextDue: string | null;
  status: SipStatus;
  endingSoon: boolean;
  /** Found in registrar data (status kept up to date automatically). */
  auto: boolean;
};

const REGISTRAR = ["cams", "kfintech", "cas"];
const schemeKey = (s: string | null) => (s ? baseName(s) : "");

export async function loadSipBook(tx: Tx, today: string, investorId?: string): Promise<{ rows: SipRow[]; inflow: { month: string; amount: number }[] }> {
  const events = await tx
    .select({
      investorId: transactions.investorId,
      client: investors.name,
      folioId: transactions.folioId,
      folioNo: folios.folioNo,
      instrumentId: transactions.instrumentId,
      instrumentName: instruments.name,
      schemeText: transactions.schemeText,
      date: transactions.tradeDate,
      amount: transactions.amount,
    })
    .from(transactions)
    .innerJoin(investors, eq(investors.id, transactions.investorId))
    .leftJoin(folios, eq(folios.id, transactions.folioId))
    .leftJoin(instruments, eq(instruments.id, transactions.instrumentId))
    .where(
      and(
        inArray(transactions.source, REGISTRAR),
        // Instalments, and reversals (a bounce is sometimes reported as a negative purchase).
        or(eq(transactions.type, "sip"), and(eq(transactions.type, "purchase"), lt(transactions.amount, "0"))),
        investorId ? eq(transactions.investorId, investorId) : undefined,
      ),
    );

  const meta = new Map<string, (typeof events)[number]>();
  const keyOf = (e: (typeof events)[number]) =>
    [e.investorId, e.folioId ?? e.folioNo ?? "-", e.instrumentId ?? schemeKey(e.schemeText)].join("|");
  const sipEvents = events.map((e) => {
    const key = keyOf(e);
    const prev = meta.get(key);
    if (!prev || e.date > prev.date) meta.set(key, e);
    return { key, date: e.date, amount: Number(e.amount) };
  });
  // Series made only of reversals (negative purchases that reverse no SIP) are dropped by detectSips.
  const detected = detectSips(sipEvents, today);

  const typed = await tx
    .select({
      id: sips.id,
      investorId: sips.investorId,
      client: investors.name,
      instrumentId: sips.instrumentId,
      instrumentName: instruments.name,
      schemeText: sips.schemeText,
      amount: sips.amount,
      frequency: sips.frequency,
      startDate: sips.startDate,
      endDate: sips.endDate,
      status: sips.status,
    })
    .from(sips)
    .innerJoin(investors, eq(investors.id, sips.investorId))
    .leftJoin(instruments, eq(instruments.id, sips.instrumentId))
    .where(investorId ? eq(sips.investorId, investorId) : undefined);

  const rows: SipRow[] = [];
  const claimed = new Set<string>();
  const byInvestor = new Map<string, typeof detected>();
  for (const d of detected) {
    const inv = d.key.split("|")[0]!;
    let list = byInvestor.get(inv);
    if (!list) byInvestor.set(inv, (list = []));
    list.push(d);
  }

  for (const s of typed) {
    const amount = Number(s.amount);
    const name = s.instrumentName ?? s.schemeText ?? "";
    // The registrar series for the same client and scheme, closest in amount.
    const candidates = (byInvestor.get(s.investorId) ?? []).filter((d) => {
      if (claimed.has(d.key)) return false;
      const e = meta.get(d.key)!;
      return (s.instrumentId && e.instrumentId === s.instrumentId) || (schemeKey(e.instrumentName ?? e.schemeText) === schemeKey(name) && schemeKey(name) !== "");
    });
    const match = candidates.sort((a, b) => Math.abs(a.amount - amount) - Math.abs(b.amount - amount))[0];
    const endingSoon = Boolean(s.endDate && daysBetween(today, s.endDate) >= 0 && daysBetween(today, s.endDate) <= 45);
    if (match) {
      claimed.add(match.key);
      const e = meta.get(match.key)!;
      rows.push({
        id: s.id,
        typedId: s.id,
        investorId: s.investorId,
        client: s.client,
        scheme: e.instrumentName ?? e.schemeText ?? name,
        instrumentId: e.instrumentId ?? s.instrumentId,
        folioNo: e.folioNo,
        amount: match.amount,
        frequency: match.frequency,
        startDate: match.firstDate < s.startDate ? match.firstDate : s.startDate,
        endDate: s.endDate,
        lastPaid: match.lastPaid,
        lastBounce: match.lastBounce,
        bouncesYear: match.bouncesYear,
        nextDue: match.status === "active" || match.status === "bounced" ? match.nextDue : null,
        status: s.status === "paused" && match.status === "missed" ? "paused" : match.status,
        endingSoon: endingSoon && match.status === "active",
        auto: true,
      });
      continue;
    }
    const status: SipStatus = s.status === "active" ? "active" : s.status === "paused" ? "paused" : "stopped";
    let due: string | null = null;
    if (status === "active") {
      const step = s.frequency === "quarterly" ? 3 : 1;
      due = s.startDate;
      for (let i = 0; due < today && i < 1200; i++) due = addMonths(s.startDate, step * (i + 1));
    }
    rows.push({
      id: s.id,
      typedId: s.id,
      investorId: s.investorId,
      client: s.client,
      scheme: name || "—",
      instrumentId: s.instrumentId,
      folioNo: null,
      amount,
      frequency: (s.frequency as SipRow["frequency"]) ?? "monthly",
      startDate: s.startDate,
      endDate: s.endDate,
      lastPaid: null,
      lastBounce: null,
      bouncesYear: 0,
      nextDue: s.endDate && due && due > s.endDate ? null : due,
      status,
      endingSoon: endingSoon && status === "active",
      auto: false,
    });
  }

  for (const d of detected) {
    if (claimed.has(d.key)) continue;
    const e = meta.get(d.key)!;
    rows.push({
      id: `auto:${d.key}`,
      typedId: null,
      investorId: e.investorId,
      client: e.client,
      scheme: e.instrumentName ?? e.schemeText ?? "—",
      instrumentId: e.instrumentId,
      folioNo: e.folioNo,
      amount: d.amount,
      frequency: d.frequency,
      startDate: d.firstDate,
      endDate: null,
      lastPaid: d.lastPaid,
      lastBounce: d.lastBounce,
      bouncesYear: d.bouncesYear,
      nextDue: d.status === "active" || d.status === "bounced" ? d.nextDue : null,
      status: d.status,
      endingSoon: false,
      auto: true,
    });
  }

  const ORDER: Record<SipStatus, number> = { bounced: 0, missed: 1, active: 2, paused: 3, stopped: 4 };
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || Number(b.endingSoon) - Number(a.endingSoon) || a.client.localeCompare(b.client) || b.amount - a.amount);

  const inflow = inflowByMonth(
    events.filter((e) => e.date >= addMonths(`${today.slice(0, 7)}-01`, -11)).map((e) => ({ date: e.date, amount: Number(e.amount) })),
    today,
  );
  return { rows, inflow };
}

/** Totals for headers and the morning briefing. */
export function sipTotals(rows: SipRow[]) {
  const running = rows.filter((r) => r.status === "active" || r.status === "bounced");
  return {
    active: rows.filter((r) => r.status === "active").length,
    bounced: rows.filter((r) => r.status === "bounced").length,
    missed: rows.filter((r) => r.status === "missed").length,
    endingSoon: rows.filter((r) => r.endingSoon).length,
    monthly: Math.round(running.reduce((s, r) => s + monthlyAmount(r.amount, r.frequency), 0)),
  };
}

