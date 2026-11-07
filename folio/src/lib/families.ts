/**
 * Families: clients grouped under a head (husband, wife, parents, children). Values, gains and XIRR are worked
 * out over every member's money together, the same way as for one client (`combine` in ./holdings).
 */
import { z } from "zod";
import { combine, shownReturn, type Holding } from "./holdings";

export type FamilyRow = { id: string; name: string; headInvestorId: string | null };
export type MemberRow = { id: string; name: string; familyId: string | null };
export type MemberHolding = Holding & { investorId: string; navDate: string | null };

export const familySchema = z.object({
  name: z.string().trim().min(2, "Enter a name for the family, like “Sharma family”.").max(120),
  memberIds: z.array(z.uuid()).min(1, "Choose at least one client.").max(50, "A family can have up to 50 clients."),
  headId: z.uuid().nullable(),
});
export type FamilyForm = z.infer<typeof familySchema>;

/** The head must be one of the members. Returns the problem, or null. */
export function familyProblem(f: FamilyForm): string | null {
  if (f.headId && !f.memberIds.includes(f.headId)) return "The head of the family must be one of its members.";
  if (new Set(f.memberIds).size !== f.memberIds.length) return "A client is listed twice.";
  return null;
}

/**
 * One summary per family, largest first. `unmatched` is money in schemes not matched to AMFI yet, per client:
 * it counts as invested (as on a client's page) but has no value until matched.
 */
export function summariseFamilies(
  families: readonly FamilyRow[],
  members: readonly MemberRow[],
  holdings: readonly MemberHolding[],
  unmatched: ReadonlyMap<string, number> = new Map(),
) {
  const byInvestor = new Map<string, MemberHolding[]>();
  for (const h of holdings) {
    let list = byInvestor.get(h.investorId);
    if (!list) byInvestor.set(h.investorId, (list = []));
    list.push(h);
  }
  return families
    .map((f) => {
      const people = members.filter((m) => m.familyId === f.id);
      const own = people.flatMap((m) => byInvestor.get(m.id) ?? []);
      const total = combine(own);
      const notMatched = people.reduce((s, m) => s + (unmatched.get(m.id) ?? 0), 0);
      const head = people.find((m) => m.id === f.headInvestorId) ?? null;
      return {
        id: f.id,
        name: f.name,
        head: head ? { id: head.id, name: head.name } : null,
        members: people
          .map((m) => {
            const t = combine(byInvestor.get(m.id) ?? []);
            return { id: m.id, name: m.name, isHead: m.id === f.headInvestorId, value: t.value, gain: t.gain };
          })
          // Head first, then by value.
          .sort((a, b) => Number(b.isHead) - Number(a.isHead) || b.value - a.value || a.name.localeCompare(b.name)),
        total,
        invested: Math.round((total.cost + notMatched) * 100) / 100,
        notMatched,
        shown: shownReturn(total),
      };
    })
    .sort((a, b) => b.total.value - a.total.value || a.name.localeCompare(b.name));
}

export type FamilySummary = ReturnType<typeof summariseFamilies>[number];
