/**
 * Report numbers, from the old FundVault app: monthly SIP vs one-time flow, Indian financial-year totals,
 * top schemes, monthly SIP commitment. Redemptions are left out of inflow figures.
 */
import { monthlyAmount } from "./sip-book";
export type Entry = { type: string; amount: number; date: string; scheme: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Indian financial year containing `date`: Apr 2025–Mar 2026 → "FY 2025-26". */
export function financialYear(date: Date): string {
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const isInflow = (e: Entry) => e.type === "sip" || e.type === "purchase";
const parse = (d: string) => new Date(d + "T00:00:00");

export type MonthlyPoint = { key: string; label: string; sip: number; oneTime: number; total: number };

/** The last `months` calendar months up to `now`; empty months stay as zero so the axis is continuous. */
export function monthlyBreakdown(entries: Entry[], months = 12, now = new Date()): MonthlyPoint[] {
  const buckets = new Map<string, MonthlyPoint>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, { key, label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, sip: 0, oneTime: 0, total: 0 });
  }
  for (const e of entries) {
    if (!isInflow(e)) continue;
    const b = buckets.get(e.date.slice(0, 7));
    if (!b) continue;
    if (e.type === "sip") b.sip += e.amount;
    else b.oneTime += e.amount;
    b.total += e.amount;
  }
  return [...buckets.values()];
}

export type YearlyPoint = { year: string; sip: number; oneTime: number; total: number; count: number };

export function yearlyBreakdown(entries: Entry[]): YearlyPoint[] {
  const buckets = new Map<string, YearlyPoint>();
  for (const e of entries) {
    if (!isInflow(e)) continue;
    const year = financialYear(parse(e.date));
    const b = buckets.get(year) ?? { year, sip: 0, oneTime: 0, total: 0, count: 0 };
    if (e.type === "sip") b.sip += e.amount;
    else b.oneTime += e.amount;
    b.total += e.amount;
    b.count += 1;
    buckets.set(year, b);
  }
  return [...buckets.values()].sort((a, b) => a.year.localeCompare(b.year));
}

/** Top schemes by amount invested; the rest folded into "Other". */
export function topSchemes(entries: Entry[], limit = 5): { scheme: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (!isInflow(e)) continue;
    const s = e.scheme?.trim() || "Unnamed scheme";
    totals.set(s, (totals.get(s) ?? 0) + e.amount);
  }
  const sorted = [...totals].map(([scheme, amount]) => ({ scheme, amount })).sort((a, b) => b.amount - a.amount);
  if (sorted.length <= limit) return sorted;
  const rest = sorted.slice(limit).reduce((s, x) => s + x.amount, 0);
  return [...sorted.slice(0, limit), { scheme: "Other", amount: rest }];
}

/** Active SIPs per month, quarterly ones divided by 3. */
export function monthlySipCommitment(list: { amount: number; frequency: string; status: string }[]): number {
  return list.filter((s) => s.status === "active").reduce((sum, s) => sum + monthlyAmount(s.amount, s.frequency), 0);
}

/** Short rupees for chart axes: ₹12.5L, ₹3.2Cr. */
export function inrCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
  if (abs >= 1e3) return `₹${(value / 1e3).toFixed(0)}K`;
  return `₹${Math.round(value)}`;
}
