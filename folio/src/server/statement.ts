/**
 * The figures for a client's or a family's statement (see src/lib/statement.ts), read in a scope: a team member's
 * (row-level security for sub-brokers) or a client's own portal scope. The PDF itself is made in the browser.
 */
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { db } from "./db/client";
import type { Tx } from "./db/scope";
import { instruments, practices, sips, transactions } from "./db/schema";
import { combine, loadHoldings, loadUnmatched } from "./valuation";
import { shownReturn } from "@/lib/holdings";
import { todayIst } from "@/lib/records";
import type { StatementData } from "@/lib/statement";

export async function practiceBrand(practiceId: string): Promise<StatementData["practice"]> {
  const [p] = await db().select({ name: practices.name, arn: practices.arn, euin: practices.euin }).from(practices).where(eq(practices.id, practiceId));
  if (!p) throw new Error("Practice not found");
  return p;
}

function minusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
}

export async function loadStatement(
  tx: Tx,
  people: readonly { id: string; name: string }[],
  title: string,
  isFamily: boolean,
): Promise<Omit<StatementData, "practice">> {
  const ids = people.map((p) => p.id);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const today = todayIst();
  const holdings = await loadHoldings(tx, ids);
  const notValued = await loadUnmatched(tx, ids);
  const total = combine(holdings);
  const shown = shownReturn(total);
  const sipRows = ids.length
    ? await tx
        .select({
          investorId: sips.investorId,
          scheme: instruments.name,
          typed: sips.schemeText,
          amount: sips.amount,
          frequency: sips.frequency,
          since: sips.startDate,
          status: sips.status,
        })
        .from(sips)
        .leftJoin(instruments, eq(instruments.id, sips.instrumentId))
        .where(and(inArray(sips.investorId, ids), ne(sips.status, "stopped"), ne(sips.status, "ended")))
        .orderBy(desc(sips.amount))
    : [];
  const txns = ids.length
    ? await tx
        .select({
          investorId: transactions.investorId,
          date: transactions.tradeDate,
          scheme: instruments.name,
          typed: transactions.schemeText,
          type: transactions.type,
          amount: transactions.amount,
          units: transactions.units,
        })
        .from(transactions)
        .leftJoin(instruments, eq(instruments.id, transactions.instrumentId))
        .where(and(inArray(transactions.investorId, ids), gte(transactions.tradeDate, minusDays(today, 365))))
        .orderBy(desc(transactions.tradeDate), desc(transactions.createdAt))
        .limit(500)
    : [];
  return {
    title,
    people: people.map((p) => p.name),
    isFamily,
    generatedOn: today,
    navDate: total.navDate,
    total: {
      value: total.value,
      invested: Math.round((total.cost + notValued.reduce((s, u) => s + u.netInvested, 0)) * 100) / 100,
      gain: total.gain,
      returnLabel: shown.label,
      returnValue: shown.value,
    },
    holdings: holdings
      .filter((h) => h.units > 0)
      .map((h) => {
        const r = shownReturn(h);
        return {
          scheme: h.name,
          member: names.get(h.investorId) ?? "",
          units: h.units,
          invested: h.cost,
          value: h.value,
          gain: h.gain,
          returnLabel: r.label,
          returnValue: r.value,
          estimated: h.estimated,
        };
      }),
    notValued: notValued.filter((u) => u.netInvested > 0).map((u) => ({ scheme: u.scheme, invested: u.netInvested })),
    sips: sipRows.map((s) => ({
      scheme: s.scheme ?? s.typed ?? "-",
      member: names.get(s.investorId) ?? "",
      amount: Number(s.amount),
      frequency: s.frequency,
      since: s.since,
      status: s.status,
    })),
    transactions: txns.map((t) => ({
      date: t.date,
      scheme: t.scheme ?? t.typed ?? "-",
      member: names.get(t.investorId) ?? "",
      type: t.type,
      amount: Number(t.amount),
      units: t.units === null ? null : Number(t.units),
    })),
  };
}
