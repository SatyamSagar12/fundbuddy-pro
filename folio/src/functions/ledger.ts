/** Investments (transactions entered by hand) and SIPs: list, add, edit, delete. */
import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withPractice } from "@/server/db/scope";
import { investors, sips, transactions } from "@/server/db/schema";
import { requireMember, scopeOf } from "@/server/member";
import { audit } from "@/server/security";
import { investmentSchema, sipSchema } from "@/lib/records";
import { confidentScheme, fillUnitsSoon, schemeExists } from "@/server/schemes";

/** The scheme to link: the one picked, else a certain match for the typed name, else none (match it later). */
async function resolveScheme(instrumentId: string, typed: string): Promise<string | null> {
  if (instrumentId) return (await schemeExists(instrumentId))?.id ?? null;
  return confidentScheme(typed).catch(() => null);
}

const filter = z.object({ client: z.uuid().optional() });
const idInput = z.object({ id: z.uuid() });

/** Clients for the "client" dropdowns (a sub-broker gets only theirs). */
export const clientOptions = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember();
  return withPractice(scopeOf(m), (tx) =>
    tx.select({ id: investors.id, name: investors.name }).from(investors).orderBy(asc(investors.name)),
  );
});

export const listInvestments = createServerFn({ method: "GET" })
  .validator((input: unknown) => filter.parse(input ?? {}))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const rows = await withPractice(scopeOf(m), (tx) =>
      tx
        .select({
          id: transactions.id,
          investorId: transactions.investorId,
          client: investors.name,
          scheme: transactions.schemeText,
          instrumentId: transactions.instrumentId,
          type: transactions.type,
          amount: transactions.amount,
          units: transactions.units,
          nav: transactions.nav,
          unitsEstimated: transactions.unitsEstimated,
          date: transactions.tradeDate,
          paymentMode: transactions.paymentMode,
          reference: transactions.reference,
          source: transactions.source,
        })
        .from(transactions)
        .innerJoin(investors, eq(investors.id, transactions.investorId))
        .where(data.client ? eq(transactions.investorId, data.client) : undefined)
        .orderBy(desc(transactions.tradeDate), desc(transactions.createdAt))
        .limit(2000),
    );
    return rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      units: r.units === null ? null : Number(r.units),
      nav: r.nav === null ? null : Number(r.nav),
    }));
  });

export const saveInvestment = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.uuid().optional(), investment: investmentSchema }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const i = data.investment;
    const instrumentId = await resolveScheme(i.instrumentId, i.scheme);
    const row = {
      investorId: i.investorId,
      schemeText: i.scheme,
      instrumentId,
      type: i.type,
      amount: i.amount.toFixed(2),
      tradeDate: i.date,
      paymentMode: i.paymentMode,
      reference: i.reference || null,
      // Worked out again from the scheme's NAV on that date (below, and by the daily job).
      units: null,
      nav: null,
      unitsEstimated: false,
    };
    const saved = await withPractice(scopeOf(m), async (tx) => {
      // The client must be one this person can see (row-level security hides the rest).
      const [client] = await tx.select({ id: investors.id }).from(investors).where(eq(investors.id, i.investorId));
      if (!client) return [];
      return data.id
        ? tx
            .update(transactions)
            .set(row)
            .where(and(eq(transactions.id, data.id), eq(transactions.source, "manual")))
            .returning({ id: transactions.id })
        : tx
            .insert(transactions)
            .values({ ...row, practiceId: m.practiceId, source: "manual", sourceTxnId: crypto.randomUUID() })
            .returning({ id: transactions.id });
    });
    if (!saved.length) return { ok: false as const, error: data.id ? "This entry can't be edited." : "Client not found." };
    await audit(m.practiceId, m.userId, data.id ? "investment.updated" : "investment.created", { target: saved[0]!.id });
    if (instrumentId) await fillUnitsSoon(m.practiceId);
    return { ok: true as const, matched: !!instrumentId };
  });

export const deleteInvestment = createServerFn({ method: "POST" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const gone = await withPractice(scopeOf(m), (tx) =>
      tx.delete(transactions).where(eq(transactions.id, data.id)).returning({ id: transactions.id }),
    );
    if (!gone.length) return { ok: false as const, error: "Not found." };
    await audit(m.practiceId, m.userId, "investment.deleted", { target: data.id });
    return { ok: true as const };
  });

export const listSips = createServerFn({ method: "GET" })
  .validator((input: unknown) => filter.parse(input ?? {}))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const rows = await withPractice(scopeOf(m), (tx) =>
      tx
        .select({
          id: sips.id,
          investorId: sips.investorId,
          client: investors.name,
          scheme: sips.schemeText,
          instrumentId: sips.instrumentId,
          amount: sips.amount,
          frequency: sips.frequency,
          startDate: sips.startDate,
          status: sips.status,
        })
        .from(sips)
        .innerJoin(investors, eq(investors.id, sips.investorId))
        .where(data.client ? eq(sips.investorId, data.client) : undefined)
        .orderBy(asc(sips.status), desc(sips.startDate))
        .limit(2000),
    );
    return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  });

export const saveSip = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.uuid().optional(), sip: sipSchema }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const s = data.sip;
    const row = {
      investorId: s.investorId,
      schemeText: s.scheme,
      instrumentId: await resolveScheme(s.instrumentId, s.scheme),
      amount: s.amount.toFixed(2),
      frequency: s.frequency,
      startDate: s.startDate,
      status: s.status,
    };
    const saved = await withPractice(scopeOf(m), async (tx) => {
      const [client] = await tx.select({ id: investors.id }).from(investors).where(eq(investors.id, s.investorId));
      if (!client) return [];
      return data.id
        ? tx.update(sips).set(row).where(eq(sips.id, data.id)).returning({ id: sips.id })
        : tx.insert(sips).values({ ...row, practiceId: m.practiceId, source: "manual" }).returning({ id: sips.id });
    });
    if (!saved.length) return { ok: false as const, error: "Not found." };
    await audit(m.practiceId, m.userId, data.id ? "sip.updated" : "sip.created", { target: saved[0]!.id });
    return { ok: true as const };
  });

export const deleteSip = createServerFn({ method: "POST" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const gone = await withPractice(scopeOf(m), (tx) => tx.delete(sips).where(eq(sips.id, data.id)).returning({ id: sips.id }));
    if (!gone.length) return { ok: false as const, error: "Not found." };
    await audit(m.practiceId, m.userId, "sip.deleted", { target: data.id });
    return { ok: true as const };
  });

/** Everything the Reports page needs, for all clients or one. */
export const getReportData = createServerFn({ method: "GET" })
  .validator((input: unknown) => filter.parse(input ?? {}))
  .handler(async ({ data }) => {
    const m = await requireMember();
    return withPractice(scopeOf(m), async (tx) => {
      const entries = await tx
        .select({ type: transactions.type, amount: transactions.amount, date: transactions.tradeDate, scheme: transactions.schemeText })
        .from(transactions)
        .where(data.client ? eq(transactions.investorId, data.client) : undefined);
      const sipRows = await tx
        .select({ amount: sips.amount, frequency: sips.frequency, status: sips.status })
        .from(sips)
        .where(data.client ? eq(sips.investorId, data.client) : undefined);
      const clients = await tx.select({ id: investors.id, name: investors.name }).from(investors).orderBy(asc(investors.name));
      return {
        entries: entries.map((e) => ({ ...e, amount: Number(e.amount) })),
        sips: sipRows.map((s) => ({ ...s, amount: Number(s.amount) })),
        clients,
      };
    });
  });
