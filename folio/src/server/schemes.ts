/**
 * Finding AMFI schemes by name, and linking a practice's entries and SIPs to them.
 * Scheme data is shared (read as the owner); linking happens inside the practice scope.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db/client";
import { withPractice, type Scope } from "./db/scope";
import { instruments, sips, transactions } from "./db/schema";
import { fillUnits } from "./nav";
import { confidentMatch, nameWords, rankCandidates, searchWords } from "@/lib/scheme-match";
import { todayIst } from "@/lib/records";

const columns = {
  id: instruments.id,
  name: instruments.name,
  amc: instruments.amc,
  category: instruments.category,
  plan: instruments.plan,
  option: instruments.option,
  latestNav: instruments.latestNav,
  latestNavDate: instruments.latestNavDate,
};

export type SchemeHit = {
  id: string;
  name: string;
  amc: string | null;
  category: string | null;
  plan: string | null;
  option: string | null;
  nav: number | null;
  navDate: string | null;
  score: number;
};

const escapeLike = (w: string) => w.replace(/[\\%_]/g, (c) => "\\" + c);

function toHit(r: { id: string; name: string; amc: string | null; category: string | null; plan: string | null; option: string | null; latestNav: string | null; latestNavDate: string | null; score: number }): SchemeHit {
  return { id: r.id, name: r.name, amc: r.amc, category: r.category, plan: r.plan, option: r.option, nav: r.latestNav === null ? null : Number(r.latestNav), navDate: r.latestNavDate, score: r.score };
}

/** Best matches for a typed name: every meaningful word must appear in the scheme name. */
export async function searchSchemes(query: string, limit = 12): Promise<SchemeHit[]> {
  const words = searchWords(query);
  if (!words.length) return [];
  const rows = await db()
    .select(columns)
    .from(instruments)
    .where(and(...words.map((w) => sql`lower(${instruments.name}) like ${`%${escapeLike(w)}%`}`)))
    .limit(400);
  return rankCandidates(query, rows, todayIst()).slice(0, limit).map(toHit);
}

/**
 * Suggestions for many typed names at once (the "Match schemes" page): one query for all schemes whose name starts
 * with the same first word (usually the fund house), ranked per name.
 */
export async function suggestMany(names: string[], perName = 4): Promise<Map<string, { hits: SchemeHit[]; confident: string | null }>> {
  const firsts = [...new Set(names.map((n) => nameWords(n)[0]).filter((w): w is string => !!w))];
  const out = new Map<string, { hits: SchemeHit[]; confident: string | null }>();
  if (!firsts.length) return out;
  const rows = await db()
    .select(columns)
    .from(instruments)
    .where(sql`lower(${instruments.name}) like any (array[${sql.join(firsts.map((w) => sql`${`${escapeLike(w)}%`}`), sql`, `)}]::text[])`);
  const today = todayIst();
  for (const name of names) {
    const ranked = rankCandidates(name, rows, today);
    out.set(name, { hits: ranked.slice(0, perName).map(toHit), confident: confidentMatch(name, ranked)?.id ?? null });
  }
  return out;
}

/** The scheme to link automatically for a typed name, only when the match is certain. */
export async function confidentScheme(name: string): Promise<string | null> {
  const words = searchWords(name);
  if (!words.length) return null;
  const rows = await db()
    .select(columns)
    .from(instruments)
    .where(and(...words.map((w) => sql`lower(${instruments.name}) like ${`%${escapeLike(w)}%`}`)))
    .limit(400);
  return confidentMatch(name, rankCandidates(name, rows, todayIst()))?.id ?? null;
}

export async function schemeExists(id: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db().select({ id: instruments.id, name: instruments.name }).from(instruments).where(eq(instruments.id, id));
  return row ?? null;
}

/**
 * Links every unmatched entry and SIP named `schemeText` to the scheme. Entries entered here (not from registrar
 * files) get their units worked out again from the scheme's NAVs.
 */
export async function linkScheme(scope: Scope, schemeText: string, instrumentId: string): Promise<{ entries: number; sips: number }> {
  return withPractice(scope, async (tx) => {
    const e = await tx
      .update(transactions)
      .set({ instrumentId, units: null, nav: null, unitsEstimated: false })
      .where(and(eq(transactions.schemeText, schemeText), isNull(transactions.instrumentId), inArray(transactions.source, ["manual", "legacy", "sample"])))
      .returning({ id: transactions.id });
    const s = await tx
      .update(sips)
      .set({ instrumentId })
      .where(and(eq(sips.schemeText, schemeText), isNull(sips.instrumentId)))
      .returning({ id: sips.id });
    return { entries: e.length, sips: s.length };
  });
}

/** Works out units for this practice's newly linked entries. Never fails the caller: the background job retries. */
export async function fillUnitsSoon(practiceId: string): Promise<void> {
  try {
    await fillUnits({ practiceId, maxFetches: 5 });
  } catch (e) {
    console.error("Filling units failed:", e instanceof Error ? e.message : e);
  }
}
