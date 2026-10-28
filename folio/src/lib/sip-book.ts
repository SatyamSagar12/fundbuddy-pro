/**
 * The SIP book, worked out from the registrars' own transactions instead of typed in.
 *
 * Every SIP instalment a registrar reports is grouped by client, folio and scheme. A reversal (the same amount
 * taken back within a few weeks, which is how CAMS and KFintech report a bounced instalment) marks that
 * instalment as bounced. From the rhythm of the instalments we know the frequency, when the next one is due and
 * whether the SIP is still running:
 *
 *  - active   the last instalment went through and the next one isn't overdue yet
 *  - bounced  the latest instalment was reversed (call the client)
 *  - missed   no instalment for more than one cycle (paused, or quietly stopped)
 *  - stopped  nothing for three cycles
 *
 * Pure functions, so the rules are tested without a database.
 */

export type SipEvent = {
  /** Client, folio and scheme: one SIP series per key. */
  key: string;
  date: string;
  /** Positive for an instalment, negative for a reversal (bounce). */
  amount: number;
};

export type SipFrequency = "weekly" | "monthly" | "quarterly";
export type SipState = "active" | "bounced" | "missed" | "stopped";

export type DetectedSip = {
  key: string;
  amount: number;
  frequency: SipFrequency;
  firstDate: string;
  lastPaid: string | null;
  lastBounce: string | null;
  /** Instalments that went through, ever. */
  paid: number;
  /** Bounces in the last 12 months. */
  bouncesYear: number;
  nextDue: string;
  status: SipState;
};

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY);

export function addDays(d: string, n: number): string {
  return iso(t(d) + n * DAY);
}

/** Same day next month (31 Jan → 28/29 Feb), the way SIP dates roll. */
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

const PERIOD: Record<SipFrequency, number> = { weekly: 7, monthly: 30, quarterly: 91 };

function frequencyOf(dates: string[]): SipFrequency {
  if (dates.length < 2) return "monthly";
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d)).filter((g) => g > 0).sort((a, b) => a - b);
  if (!gaps.length) return "monthly";
  const median = gaps[Math.floor(gaps.length / 2)]!;
  if (median <= 12) return "weekly";
  if (median >= 70) return "quarterly";
  return "monthly";
}

function next(d: string, f: SipFrequency): string {
  return f === "weekly" ? addDays(d, 7) : addMonths(d, f === "quarterly" ? 3 : 1);
}

/** All SIP series in a set of instalments and reversals, as of `today` (YYYY-MM-DD). */
export function detectSips(events: SipEvent[], today: string): DetectedSip[] {
  const groups = new Map<string, SipEvent[]>();
  for (const e of events) {
    if (!e.amount) continue;
    let g = groups.get(e.key);
    if (!g) groups.set(e.key, (g = []));
    g.push(e);
  }
  const out: DetectedSip[] = [];
  for (const [key, g] of groups) {
    g.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
    // Pair each reversal with the latest unpaired instalment of the same amount before it (within 45 days).
    const paid: { date: string; amount: number; bounced: boolean }[] = [];
    const bounces: string[] = [];
    for (const e of g) {
      if (e.amount > 0) {
        paid.push({ date: e.date, amount: e.amount, bounced: false });
        continue;
      }
      const match = [...paid]
        .reverse()
        .find((p) => !p.bounced && Math.abs(p.amount + e.amount) <= 1 && daysBetween(p.date, e.date) >= 0 && daysBetween(p.date, e.date) <= 45);
      if (match) {
        match.bounced = true;
        bounces.push(match.date);
      }
    }
    if (!paid.length) continue;
    const good = paid.filter((p) => !p.bounced);
    const all = paid.map((p) => p.date);
    const frequency = frequencyOf(all);
    const period = PERIOD[frequency];
    const lastPaid = good.at(-1)?.date ?? null;
    const lastBounce = bounces.sort().at(-1) ?? null;
    const lastEvent = [lastPaid, lastBounce].filter(Boolean).sort().at(-1)!;
    const since = daysBetween(lastPaid ?? lastEvent, today);
    let status: SipState;
    if (lastBounce && (!lastPaid || lastBounce >= lastPaid) && daysBetween(lastBounce, today) <= 2 * period + 15) status = "bounced";
    else if (lastPaid && since <= period + 12) status = "active";
    else if (since <= 3 * period + 12) status = "missed";
    else status = "stopped";
    const amount = (good.at(-1) ?? paid.at(-1)!).amount;
    let due = next(lastEvent, frequency);
    // A running SIP's next date is always ahead of today.
    for (let i = 0; (status === "active" || status === "bounced") && due < today && i < 60; i++) due = next(due, frequency);
    out.push({
      key,
      amount,
      frequency,
      firstDate: paid[0]!.date,
      lastPaid,
      lastBounce,
      paid: good.length,
      bouncesYear: bounces.filter((d) => daysBetween(d, today) <= 365).length,
      nextDue: due,
      status,
    });
  }
  return out;
}

/** Monthly amount of a SIP (weekly ×52/12, quarterly ÷3). */
export function monthlyAmount(amount: number, frequency: string): number {
  if (frequency === "weekly") return (amount * 52) / 12;
  if (frequency === "quarterly") return amount / 3;
  if (frequency === "daily") return amount * 21;
  return amount;
}

/** SIP money that actually came in per month (YYYY-MM), for the last `months` months, oldest first. */
export function inflowByMonth(events: { date: string; amount: number }[], today: string, months = 12): { month: string; amount: number }[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) keys.push(addMonths(`${today.slice(0, 7)}-01`, -i).slice(0, 7));
  const sums = new Map(keys.map((k) => [k, 0]));
  for (const e of events) {
    const k = e.date.slice(0, 7);
    if (sums.has(k)) sums.set(k, sums.get(k)! + e.amount);
  }
  return keys.map((k) => ({ month: k, amount: Math.round(sums.get(k)! * 100) / 100 }));
}

/** Words and colour for a SIP's status, shared by every page that lists SIPs. */
export const SIP_STATUS: Record<string, { label: string; tone: string; hint: string }> = {
  active: { label: "Active", tone: "text-good", hint: "Last instalment went through" },
  bounced: { label: "Bounced", tone: "text-bad", hint: "The latest instalment was returned unpaid" },
  missed: { label: "Missed", tone: "text-warn", hint: "No instalment for more than one cycle" },
  paused: { label: "Paused", tone: "text-muted", hint: "Paused" },
  stopped: { label: "Stopped", tone: "text-muted", hint: "No instalment for three cycles, or marked stopped" },
};
