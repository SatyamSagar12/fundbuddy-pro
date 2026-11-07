/** Scheme search (pickers), matching typed scheme names to AMFI schemes, and holdings with their value. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withPractice } from "@/server/db/scope";
import { requireMember, scopeOf } from "@/server/member";
import { audit } from "@/server/security";
import { fillUnitsSoon, linkScheme, schemeExists, searchSchemes, suggestMany } from "@/server/schemes";
import { loadHoldings, unmatchedSchemeNames } from "@/server/valuation";
import { combine } from "@/lib/holdings";
import { navStatus } from "@/server/nav";

export const findSchemes = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ q: z.string().trim().max(120) }).parse(input))
  .handler(async ({ data }) => {
    await requireMember();
    if (data.q.length < 3) return [];
    return searchSchemes(data.q, 12);
  });

/** Scheme names used in entries and SIPs but not linked to a scheme yet, with suggestions. */
export const listUnmatched = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember();
  const names = await withPractice(scopeOf(m), (tx) => unmatchedSchemeNames(tx));
  const page = names.slice(0, 20);
  const suggestions = await suggestMany(page.map((n) => n.scheme));
  const status = await navStatus();
  return {
    total: names.length,
    schemesLoaded: status.schemes,
    rows: page.map((n) => ({ ...n, ...(suggestions.get(n.scheme) ?? { hits: [], confident: null }) })),
  };
});

const matchInput = z.object({
  matches: z
    .array(z.object({ scheme: z.string().min(1).max(200), instrumentId: z.uuid() }))
    .min(1)
    .max(100),
});

export const matchSchemes = createServerFn({ method: "POST" })
  .validator((input: unknown) => matchInput.parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember();
    let entries = 0;
    let sipCount = 0;
    for (const x of data.matches) {
      if (!(await schemeExists(x.instrumentId))) continue;
      const r = await linkScheme(scopeOf(m), x.scheme, x.instrumentId);
      entries += r.entries;
      sipCount += r.sips;
    }
    await audit(m.practiceId, m.userId, "schemes.matched", { meta: { schemes: data.matches.length, entries, sips: sipCount } });
    await fillUnitsSoon(m.practiceId);
    return { ok: true as const, entries, sips: sipCount };
  });

/** Holdings of one client (or everyone the member can see), valued at the latest NAV. */
export const getHoldings = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ client: z.uuid().optional() }).parse(input ?? {}))
  .handler(async ({ data }) => {
    const m = await requireMember();
    const holdings = await withPractice(scopeOf(m), (tx) => loadHoldings(tx, data.client));
    return { holdings: holdings.map(({ flows: _f, ...h }) => h), total: combine(holdings) };
  });
