/**
 * Families: list with value, gain and XIRR; one family's page; create, edit, delete; put a client in a family.
 * Everything runs in the member's scope, so a sub-broker sees only families that hold one of their own clients,
 * and only their own clients inside them (row-level security, migration 0010).
 */
import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withPractice, type Tx } from "@/server/db/scope";
import { families, investors, sips, transactions } from "@/server/db/schema";
import { requireMember, scopeOf } from "@/server/member";
import { audit } from "@/server/security";
import { loadHoldings, loadUnmatched } from "@/server/valuation";
import { familyProblem, familySchema, summariseFamilies } from "@/lib/families";

const idInput = z.object({ id: z.uuid() });

/** Money in schemes not matched to AMFI yet, per client (counts as invested, has no value). */
async function unmatchedByInvestor(tx: Tx, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await tx
    .select({
      investorId: transactions.investorId,
      net: sql<string>`coalesce(sum(case when ${transactions.type} in ('redemption', 'switch_out', 'idcw_payout') then -${transactions.amount} when ${transactions.type} = 'idcw_reinvest' then 0 else ${transactions.amount} end), 0)::text`,
    })
    .from(transactions)
    .where(and(isNull(transactions.instrumentId), inArray(transactions.investorId, ids)))
    .groupBy(transactions.investorId);
  return new Map(rows.map((r) => [r.investorId, Number(r.net)]));
}

export const listFamilies = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember();
  return withPractice(scopeOf(m), async (tx) => {
    const fams = await tx
      .select({ id: families.id, name: families.name, headInvestorId: families.headInvestorId })
      .from(families)
      .orderBy(families.name);
    const members = await tx
      .select({ id: investors.id, name: investors.name, familyId: investors.familyId })
      .from(investors)
      .where(isNotNull(investors.familyId))
      .orderBy(investors.name);
    const [alone] = await tx.select({ n: sql<number>`count(*)::int` }).from(investors).where(isNull(investors.familyId));
    const ids = members.map((r) => r.id);
    const holdings = await loadHoldings(tx, ids);
    return {
      families: summariseFamilies(fams, members, holdings, await unmatchedByInvestor(tx, ids)),
      notInFamily: alone?.n ?? 0,
    };
  });
});

export const getFamily = createServerFn({ method: "GET" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember();
    return withPractice(scopeOf(m), async (tx) => {
      const [f] = await tx.select().from(families).where(eq(families.id, data.id));
      if (!f) return null;
      const members = await tx
        .select({ id: investors.id, name: investors.name, familyId: investors.familyId, mobile: investors.mobile, email: investors.email })
        .from(investors)
        .where(eq(investors.familyId, f.id))
        .orderBy(investors.name);
      const ids = members.map((r) => r.id);
      const holdings = await loadHoldings(tx, ids);
      const [summary] = summariseFamilies([f], members, holdings, await unmatchedByInvestor(tx, ids));
      const names = new Map(members.map((r) => [r.id, r.name]));
      const familySips = ids.length
        ? await tx
            .select({ investorId: sips.investorId, amount: sips.amount, frequency: sips.frequency, status: sips.status })
            .from(sips)
            .where(inArray(sips.investorId, ids))
        : [];
      const active = familySips.filter((s) => s.status === "active");
      return {
        ...summary!,
        contacts: members.map((r) => ({ id: r.id, mobile: r.mobile, email: r.email })),
        holdings: holdings.map(({ flows: _f, ...h }) => ({ ...h, member: names.get(h.investorId) ?? "" })),
        unmatched: await loadUnmatched(tx, ids),
        sips: {
          active: active.length,
          monthly: active.reduce((s, x) => s + (x.frequency === "quarterly" ? Number(x.amount) / 3 : Number(x.amount)), 0),
        },
        canDelete: m.role !== "subbroker",
      };
    });
  });

/** For the family form: the family (when editing) and every client the member can see, with their family. */
export const familyFormData = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ id: z.uuid().optional() }).parse(input ?? {}))
  .handler(async ({ data }) => {
    const m = await requireMember();
    return withPractice(scopeOf(m), async (tx) => {
      const [f] = data.id ? await tx.select().from(families).where(eq(families.id, data.id)) : [];
      if (data.id && !f) return null;
      const clients = await tx
        .select({ id: investors.id, name: investors.name, mobile: investors.mobile, familyId: investors.familyId, family: families.name })
        .from(investors)
        .leftJoin(families, eq(families.id, investors.familyId))
        .orderBy(investors.name)
        .limit(2000);
      return {
        family: f ? { id: f.id, name: f.name, headId: f.headInvestorId } : null,
        clients,
      };
    });
  });

export const saveFamily = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.uuid().optional(), family: familySchema }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const f = data.family;
    const problem = familyProblem(f);
    if (problem) return { ok: false as const, error: problem };
    const id = data.id ?? crypto.randomUUID();
    const result = await withPractice(scopeOf(m), async (tx) => {
      const seen = await tx.select({ id: investors.id }).from(investors).where(inArray(investors.id, f.memberIds));
      if (seen.length !== f.memberIds.length) return "Some of these clients weren't found. Refresh the page and try again.";
      let head = f.headId;
      if (data.id) {
        const [old] = await tx.select().from(families).where(eq(families.id, id));
        if (!old) return "Family not found.";
        // A sub-broker can't see every member: keep a head who is another team member's client.
        if (!head && old.headInvestorId) {
          const [visible] = await tx.select({ id: investors.id }).from(investors).where(eq(investors.id, old.headInvestorId));
          if (!visible && m.role === "subbroker") head = old.headInvestorId;
        }
        await tx.update(families).set({ name: f.name, headInvestorId: head }).where(eq(families.id, id));
        // Only the clients this member can see are taken out; others' clients stay in the family.
        await tx
          .update(investors)
          .set({ familyId: null, updatedAt: new Date() })
          .where(and(eq(investors.familyId, id), notInArray(investors.id, f.memberIds)));
      } else {
        // No RETURNING: the new family has no members yet, so the read policy wouldn't show it back.
        await tx.insert(families).values({ id, practiceId: m.practiceId, name: f.name, headInvestorId: head });
      }
      await tx.update(investors).set({ familyId: id, updatedAt: new Date() }).where(inArray(investors.id, f.memberIds));
      // A client moved here from another family is no longer that family's head.
      await tx
        .update(families)
        .set({ headInvestorId: null })
        .where(and(inArray(families.headInvestorId, f.memberIds), sql`${families.id} <> ${id}`));
      return null;
    });
    if (result) return { ok: false as const, error: result };
    await audit(m.practiceId, m.userId, data.id ? "family.updated" : "family.created", { target: id, meta: { members: f.memberIds.length } });
    return { ok: true as const, id };
  });

export const deleteFamily = createServerFn({ method: "POST" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember(["owner", "staff"]);
    // The clients stay; they're only ungrouped (the foreign key sets their family to empty).
    const gone = await withPractice(scopeOf(m), (tx) => tx.delete(families).where(eq(families.id, data.id)).returning({ id: families.id }));
    if (!gone.length) return { ok: false as const, error: "Family not found." };
    await audit(m.practiceId, m.userId, "family.deleted", { target: data.id });
    return { ok: true as const };
  });

/** Families to pick from on a client's page, and which one (if any) the client is in. */
export const clientFamily = createServerFn({ method: "GET" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember();
    return withPractice(scopeOf(m), async (tx) => {
      const [c] = await tx.select({ familyId: investors.familyId }).from(investors).where(eq(investors.id, data.id));
      if (!c) return null;
      const options = await tx.select({ id: families.id, name: families.name, headId: families.headInvestorId }).from(families).orderBy(families.name);
      const current = options.find((o) => o.id === c.familyId) ?? null;
      const others = current
        ? await tx
            .select({ id: investors.id, name: investors.name })
            .from(investors)
            .where(and(eq(investors.familyId, current.id), sql`${investors.id} <> ${data.id}`))
            .orderBy(investors.name)
        : [];
      return {
        current: current ? { id: current.id, name: current.name, isHead: current.headId === data.id, others } : null,
        options: options.map((o) => ({ id: o.id, name: o.name })),
      };
    });
  });

export const setClientFamily = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ investorId: z.uuid(), familyId: z.uuid().nullable(), makeHead: z.boolean().default(false) }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const problem = await withPractice(scopeOf(m), async (tx) => {
      const [c] = await tx.select({ familyId: investors.familyId }).from(investors).where(eq(investors.id, data.investorId));
      if (!c) return "Client not found.";
      if (data.familyId) {
        const [f] = await tx.select({ id: families.id }).from(families).where(eq(families.id, data.familyId));
        if (!f) return "Family not found.";
      }
      // Leaving a family (or moving) ends being its head. Done first, while the old family is still visible.
      await tx
        .update(families)
        .set({ headInvestorId: null })
        .where(and(eq(families.headInvestorId, data.investorId), data.familyId ? sql`${families.id} <> ${data.familyId}` : undefined));
      await tx.update(investors).set({ familyId: data.familyId, updatedAt: new Date() }).where(eq(investors.id, data.investorId));
      if (data.familyId && data.makeHead) {
        await tx.update(families).set({ headInvestorId: data.investorId }).where(eq(families.id, data.familyId));
      }
      return null;
    });
    if (problem) return { ok: false as const, error: problem };
    await audit(m.practiceId, m.userId, "client.family_changed", { target: data.investorId, meta: { familyId: data.familyId } });
    return { ok: true as const };
  });
