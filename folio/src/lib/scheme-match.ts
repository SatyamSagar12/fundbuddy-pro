/**
 * Matching a scheme name as typed ("HDFC Flexi Cap", "SBI bluechip fund") to AMFI schemes
 * ("HDFC Flexi Cap Fund - Regular Plan - Growth").
 *
 * Names are compared by their words, ignoring plan/option words. Among equally close names, a regular-plan
 * growth option ranks first: a distributor's clients hold regular plans, and growth is the usual choice.
 */

const NOISE = new Set([
  "fund", "plan", "option", "options", "scheme", "the", "of", "a", "an", "mf", "mutual",
  "regular", "direct", "growth", "idcw", "dividend", "payout", "reinvestment", "reinvest", "income",
  "distribution", "cum", "capital", "withdrawal", "gr", "dir", "reg",
]);

/** Lower-case words, with "&" read as "and" and anything in brackets (e.g. "(formerly …)") dropped. */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !NOISE.has(w));
}

/** The words that make a scheme what it is, with plan and option words left out. */
export function baseName(name: string): string {
  return nameWords(name).join(" ");
}

export type Candidate = { id: string; name: string; plan: string | null; option: string | null; latestNavDate: string | null };

/** 0 to 1: how well `query` names `candidate`. */
export function matchScore(query: string, candidate: Candidate, today: string): number {
  const q = nameWords(query);
  const c = nameWords(candidate.name);
  if (!q.length || !c.length) return 0;
  const cs = new Set(c);
  const qs = new Set(q);
  let common = 0;
  for (const w of qs) if (cs.has(w)) common++;
  // Words of the query found in the name matter most; extra words in the name count a little against it.
  let score = (common / qs.size) * 0.8 + (common / cs.size) * 0.2;
  if (q.join(" ") === c.join(" ")) score = 1;
  // Plan and option: prefer what the query says, else regular + growth.
  const ql = query.toLowerCase();
  const wantDirect = /\bdirect\b/.test(ql);
  const wantIdcw = /idcw|dividend|payout|reinvest/.test(ql);
  if ((candidate.plan === "direct") !== wantDirect) score -= 0.05;
  if (wantIdcw ? candidate.option === "growth" : candidate.option !== "growth") score -= 0.04;
  // Schemes without a NAV in the last 30 days are closed or merged.
  if (!candidate.latestNavDate || daysBetween(candidate.latestNavDate, today) > 30) score -= 0.1;
  return Math.max(0, Math.min(1, score));
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
}

export function rankCandidates<T extends Candidate>(query: string, candidates: T[], today: string): (T & { score: number })[] {
  return candidates
    .map((c) => ({ ...c, score: matchScore(query, c, today) }))
    .filter((c) => c.score > 0.3)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length);
}

/**
 * The suggestion that can be applied without a person choosing: the same scheme name, scoring clearly above the
 * next one. Null when unsure.
 */
export function confidentMatch<T extends Candidate>(query: string, ranked: (T & { score: number })[]): T | null {
  const [best, next] = ranked;
  if (!best || best.score < 0.95 || baseName(query) !== baseName(best.name)) return null;
  if (next && next.score >= best.score) return null;
  return best;
}

/** Search words for the database: the 3 longest meaningful words of the query. */
export function searchWords(query: string): string[] {
  return [...new Set(nameWords(query))].sort((a, b) => b.length - a.length).slice(0, 3);
}
