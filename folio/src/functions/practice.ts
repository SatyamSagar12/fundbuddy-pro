/** Practice data for the signed-in team member. All client data goes through withPractice (row-level security). */
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { auditLog, families, investors, practices, sips, transactions, users } from "@/server/db/schema";
import { cryptoFor, requireMember, scopeOf } from "@/server/member";
import { addSampleData, removeSampleData } from "@/server/sample-data";
import { combine, loadHoldings, unmatchedSchemeNames } from "@/server/valuation";
import { confidentScheme, fillUnitsSoon, linkScheme } from "@/server/schemes";

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember();
  return withPractice(scopeOf(m), async (tx) => {
    const [clients] = await tx.select({ n: sql<number>`count(*)::int` }).from(investors);
    const [sipStats] = await tx
      .select({
        active: sql<number>`count(*) filter (where ${sips.status} = 'active')::int`,
        monthly: sql<string>`coalesce(sum(case when ${sips.status} <> 'active' then 0 when ${sips.frequency} = 'quarterly' then ${sips.amount} / 3 else ${sips.amount} end), 0)::text`,
      })
      .from(sips);
    const [invested] = await tx
      .select({ total: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} in ('purchase', 'sip')), 0)::text` })
      .from(transactions);
    const recent = await tx
      .select({
        id: transactions.id,
        client: investors.name,
        scheme: transactions.schemeText,
        type: transactions.type,
        amount: transactions.amount,
        date: transactions.tradeDate,
      })
      .from(transactions)
      .innerJoin(investors, eq(investors.id, transactions.investorId))
      .orderBy(desc(transactions.tradeDate), desc(transactions.createdAt))
      .limit(6);
    const [sample] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(investors)
      .where(sql`${investors.legacyId} like 'sample:%'`);
    const total = combine(await loadHoldings(tx));
    const unmatched = (await unmatchedSchemeNames(tx)).length;
    return {
      total,
      unmatched,
      hasSample: (sample?.n ?? 0) > 0,
      canRemoveSample: m.role !== "subbroker",
      clients: clients?.n ?? 0,
      activeSips: sipStats?.active ?? 0,
      monthlySip: Number(sipStats?.monthly ?? 0),
      invested: Number(invested?.total ?? 0),
      recent: recent.map((r) => ({ ...r, amount: Number(r.amount) })),
    };
  });
});

export const listClients = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ q: z.string().trim().max(100).optional() }).parse(input ?? {}))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const q = data.q ?? "";
    // A full PAN is matched through its keyed hash; names, mobiles and emails by text.
    const panHash = /^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(q) ? await (await cryptoFor(m.practiceId)).taxIdHash(q) : null;
    return withPractice(scopeOf(m), async (tx) => {
      const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
      const where = q
        ? or(
            ilike(investors.name, like),
            ilike(investors.mobile, like),
            ilike(investors.email, like),
            panHash ? eq(investors.taxIdHash, panHash) : undefined,
          )
        : undefined;
      const rows = await tx
        .select({
          id: investors.id,
          name: investors.name,
          mobile: investors.mobile,
          email: investors.email,
          taxIdLast4: investors.taxIdLast4,
          assignedUserId: investors.assignedUserId,
          family: families.name,
        })
        .from(investors)
        .leftJoin(families, eq(families.id, investors.familyId))
        .where(where)
        .orderBy(investors.name)
        .limit(500);
      const ids = rows.map((r) => r.id);
      const counts = ids.length
        ? await tx
            .select({ investorId: sips.investorId, n: sql<number>`count(*)::int` })
            .from(sips)
            .where(and(inArray(sips.investorId, ids), eq(sips.status, "active")))
            .groupBy(sips.investorId)
        : [];
      const sipCount = new Map(counts.map((c) => [c.investorId, c.n]));
      const value = new Map<string, number>();
      if (ids.length) {
        for (const h of await loadHoldings(tx)) value.set(h.investorId, (value.get(h.investorId) ?? 0) + (h.value ?? 0));
      }
      return rows.map((r) => ({
        ...r,
        pan: r.taxIdLast4 ? `XXXXXX${r.taxIdLast4}` : null,
        activeSips: sipCount.get(r.id) ?? 0,
        value: value.has(r.id) ? Math.round(value.get(r.id)!) : null,
      }));
    });
  });

export const getPractice = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember();
  const [p] = await db()
    .select({
      name: practices.name,
      arn: practices.arn,
      euin: practices.euin,
      plan: practices.plan,
      trialEndsAt: practices.trialEndsAt,
      billingExempt: practices.billingExempt,
      requireTotp: practices.requireTotp,
    })
    .from(practices)
    .where(eq(practices.id, m.practiceId));
  return { ...p!, canEdit: m.role === "owner", me: { name: m.name, role: m.role } };
});

export const updatePractice = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(2, "Enter the practice name.").max(120),
        arn: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^(ARN-?\d{1,8})?$/, "ARN looks like ARN-123456."),
        euin: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^(E\d{6})?$/, "EUIN looks like E123456."),
        requireTotp: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const m = await requireMember(["owner"]);
    if (data.requireTotp) {
      const [me] = await db().select({ on: users.totpEnabledAt }).from(users).where(eq(users.id, m.userId));
      if (!me?.on) {
        return { ok: false as const, error: "Turn on your own authenticator first (Settings → Security), then require it for everyone." };
      }
    }
    await db()
      .update(practices)
      .set({
        name: data.name,
        arn: data.arn ? data.arn.replace(/^ARN-?/, "ARN-") : null,
        euin: data.euin || null,
        requireTotp: data.requireTotp,
      })
      .where(eq(practices.id, m.practiceId));
    await withPractice(m.practiceId, (tx) =>
      tx.insert(auditLog).values({ practiceId: m.practiceId, userId: m.userId, action: "practice.updated" }),
    );
    return { ok: true as const };
  });

/** Fills the practice with made-up sample clients, SIPs and investments to try every screen. */
export const addSample = createServerFn({ method: "POST" }).handler(async () => {
  const m = await requireMember(["owner", "staff", "subbroker"]);
  const added = await addSampleData(scopeOf(m), await cryptoFor(m.practiceId), m.role === "subbroker" ? m.userId : null);
  // Link the sample schemes that match an AMFI scheme exactly; the others show how "Match schemes" works.
  const names = await withPractice(scopeOf(m), (tx) => unmatchedSchemeNames(tx));
  let linked = 0;
  for (const n of names) {
    const id = await confidentScheme(n.scheme);
    if (id) {
      await linkScheme(scopeOf(m), n.scheme, id);
      linked++;
    }
  }
  if (linked) await fillUnitsSoon(m.practiceId);
  await withPractice(m.practiceId, (tx) =>
    tx.insert(auditLog).values({ practiceId: m.practiceId, userId: m.userId, action: "sample.added", meta: { clients: added } }),
  );
  return { ok: true as const, added };
});

/** Deletes only the sample data; real clients are never touched. */
export const removeSample = createServerFn({ method: "POST" }).handler(async () => {
  const m = await requireMember(["owner", "staff"]);
  const removed = await removeSampleData(scopeOf(m));
  await withPractice(m.practiceId, (tx) =>
    tx.insert(auditLog).values({ practiceId: m.practiceId, userId: m.userId, action: "sample.removed", meta: { clients: removed } }),
  );
  return { ok: true as const, removed };
});
