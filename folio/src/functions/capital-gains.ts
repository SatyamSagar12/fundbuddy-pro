/**
 * Capital gains report for one client or one family, for one financial year. The yearly exemption is per person,
 * so a family's figures are each member's summary added up.
 */
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPractice } from "@/server/db/scope";
import { families, investors } from "@/server/db/schema";
import { requireMember, scopeOf } from "@/server/member";
import { gainsFor, loadGainsInput } from "@/server/capital-gains";
import { sortBuckets, summarise, yearsWithSales, type Bucket, type YearSummary } from "@/lib/capital-gains";
import { fyOf, fyLabel, TAX_CLASS_LABEL, TAX_RULES_VERSION } from "@/lib/tax-rules";
import { todayIst } from "@/lib/records";

const input = z
  .object({ client: z.uuid().optional(), family: z.uuid().optional(), fy: z.number().int().min(2017).max(2100).optional() })
  .refine((v) => Boolean(v.client) !== Boolean(v.family), "Choose a client or a family.");

/** Adds people's summaries: buckets with the same key are summed, each with its own person's exemption already used. */
function addUp(parts: readonly YearSummary[]): Omit<YearSummary, "exemption"> {
  const buckets = new Map<string, Bucket>();
  for (const p of parts) {
    for (const b of p.buckets) {
      const t = buckets.get(b.key);
      if (!t) buckets.set(b.key, { ...b });
      else {
        t.gains += b.gains;
        t.losses += b.losses;
        t.net += b.net;
        t.exempted += b.exempted;
        t.tax = t.tax === null || b.tax === null ? null : t.tax + b.tax;
      }
    }
  }
  const sum = (k: "saleValue" | "cost" | "gain" | "shortTerm" | "longTerm" | "estimatedTax" | "slabIncome") => parts.reduce((s, p) => s + p[k], 0);
  return {
    buckets: sortBuckets([...buckets.values()]),
    saleValue: sum("saleValue"),
    cost: sum("cost"),
    gain: sum("gain"),
    shortTerm: sum("shortTerm"),
    longTerm: sum("longTerm"),
    estimatedTax: sum("estimatedTax"),
    slabIncome: sum("slabIncome"),
  };
}

export const getCapitalGains = createServerFn({ method: "GET" })
  .validator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const who = await withPractice(scopeOf(m), async (tx) => {
      if (data.client) {
        const [c] = await tx.select({ id: investors.id, name: investors.name }).from(investors).where(eq(investors.id, data.client));
        return c ? { title: c.name, people: [c], familyId: null as string | null } : null;
      }
      const [f] = await tx.select({ id: families.id, name: families.name }).from(families).where(eq(families.id, data.family!));
      if (!f) return null;
      const people = await tx.select({ id: investors.id, name: investors.name }).from(investors).where(eq(investors.familyId, f.id)).orderBy(investors.name);
      return { title: f.name, people, familyId: f.id };
    });
    if (!who) return null;
    const ids = who.people.map((p) => p.id);
    const all = await gainsFor(() => withPractice(scopeOf(m), (tx) => loadGainsInput(tx, ids)));
    const years = yearsWithSales(all.lines);
    const current = fyOf(todayIst());
    const fy = data.fy ?? years[0] ?? current;
    const choices = [...new Set([current, ...years])].sort((a, b) => b - a);
    const names = new Map(who.people.map((p) => [p.id, p.name]));
    const perPerson = who.people
      .map((p) => ({ id: p.id, name: p.name, summary: summarise(all.lines.filter((l) => l.investorId === p.id), fy) }))
      .filter((p) => p.summary.buckets.length > 0);
    const lines = all.lines
      .filter((l) => fyOf(l.sold) === fy)
      .map((l) => ({ ...l, client: names.get(l.investorId) ?? "", folioNo: all.folioNos.get(l.folio) ?? "", taxedAs: TAX_CLASS_LABEL[l.taxClass] }));
    return {
      title: who.title,
      isFamily: who.familyId !== null,
      clientId: data.client ?? null,
      familyId: who.familyId,
      fy,
      fyLabel: fyLabel(fy),
      years: choices.map((y) => ({ fy: y, label: fyLabel(y) })),
      total: addUp(perPerson.map((p) => p.summary)),
      perPerson,
      lines,
      problems: all.problems.filter((p) => fyOf(p.date) === fy),
      unmatchedSales: all.unmatchedSales,
      guessed: [...new Set(lines.filter((l) => l.guessed).map((l) => l.scheme))],
      grandfatherNavMissing: [...new Set(lines.filter((l) => l.grandfatherNavMissing).map((l) => l.scheme))],
      rulesVersion: TAX_RULES_VERSION,
    };
  });
