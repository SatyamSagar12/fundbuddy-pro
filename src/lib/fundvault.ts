import { z } from "zod";

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const MOBILE_REGEX = /^[6-9]\d{9}$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const MICR_REGEX = /^\d{9}$/;
export const ACCOUNT_NO_REGEX = /^\d{9,18}$/;

export const NOMINEE_RELATIONS = [
  "Spouse",
  "Son",
  "Daughter",
  "Father",
  "Mother",
  "Brother",
  "Sister",
  "Other",
] as const;

export const clientSchema = z.object({
  name: z.string().trim().min(2, "Full name is required").max(100),
  mobile: z.string().trim().regex(MOBILE_REGEX, "Enter a valid 10-digit mobile number"),
  email: z.string().trim().email("Enter a valid email").max(255).or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PAN_REGEX, "PAN must look like ABCDE1234F")
    .or(z.literal("")),
  dob: z.string().optional().or(z.literal("")),
  bank_account_no: z
    .string()
    .trim()
    .regex(ACCOUNT_NO_REGEX, "Account number must be 9–18 digits")
    .or(z.literal("")),
  bank_name: z.string().trim().max(120).optional().or(z.literal("")),
  ifsc_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(IFSC_REGEX, "IFSC must look like HDFC0001234")
    .or(z.literal("")),
  micr_code: z.string().trim().regex(MICR_REGEX, "MICR code must be 9 digits").or(z.literal("")),
  branch_name: z.string().trim().max(120).optional().or(z.literal("")),
  nominee_name: z.string().trim().max(100).optional().or(z.literal("")),
  nominee_dob: z.string().optional().or(z.literal("")),
  nominee_pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PAN_REGEX, "Nominee PAN must look like ABCDE1234F")
    .or(z.literal("")),
  nominee_mobile: z
    .string()
    .trim()
    .regex(MOBILE_REGEX, "Enter a valid 10-digit nominee mobile number")
    .or(z.literal("")),
  nominee_email: z.string().trim().email("Enter a valid nominee email").max(255).or(z.literal("")),
  nominee_relation: z.string().trim().max(40).optional().or(z.literal("")),
});

export type ClientInput = z.infer<typeof clientSchema>;

export const investmentSchema = z.object({
  client_id: z.string().uuid("Select a client"),
  scheme: z.string().trim().min(2, "Scheme name is required").max(120),
  type: z.enum(["SIP", "One-time"]),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  date: z.string().min(1, "Date is required"),
  payment_mode: z.enum(["Online", "Cheque"]),
  transaction_id: z.string().trim().max(60).optional().or(z.literal("")),
});

export const sipSchema = z.object({
  client_id: z.string().uuid("Select a client"),
  scheme: z.string().trim().min(2, "Scheme name is required").max(120),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  frequency: z.enum(["Monthly", "Quarterly"]),
  start_date: z.string().min(1, "Start date is required"),
  status: z.enum(["Active", "Paused"]),
});

export const inr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);

export const formatDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Indian financial year containing `date`: Apr 2025–Mar 2026 => "FY 2025-26". */
export function financialYear(date: Date) {
  const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export type MonthlyPoint = {
  key: string;
  label: string;
  sip: number;
  oneTime: number;
  total: number;
};

/**
 * Buckets investments into the trailing `months` calendar months ending with the
 * current month. Months with no activity are kept as zero rows so the time axis
 * stays continuous rather than collapsing gaps.
 */
export function monthlyBreakdown(
  investments: { type: string; amount: number; date: string }[],
  months = 12,
  now = new Date(),
): MonthlyPoint[] {
  const buckets = new Map<string, MonthlyPoint>();
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, {
      key,
      label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      sip: 0,
      oneTime: 0,
      total: 0,
    });
  }

  for (const inv of investments) {
    const d = new Date(inv.date);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const amount = Number(inv.amount) || 0;
    if (inv.type === "SIP") bucket.sip += amount;
    else bucket.oneTime += amount;
    bucket.total += amount;
  }

  return [...buckets.values()];
}

export type YearlyPoint = {
  year: string;
  sip: number;
  oneTime: number;
  total: number;
  count: number;
};

/** Totals per Indian financial year, oldest first. */
export function yearlyBreakdown(
  investments: { type: string; amount: number; date: string }[],
): YearlyPoint[] {
  const buckets = new Map<string, YearlyPoint>();

  for (const inv of investments) {
    const d = new Date(inv.date);
    if (Number.isNaN(d.getTime())) continue;
    const year = financialYear(d);
    const bucket = buckets.get(year) ?? { year, sip: 0, oneTime: 0, total: 0, count: 0 };
    const amount = Number(inv.amount) || 0;
    if (inv.type === "SIP") bucket.sip += amount;
    else bucket.oneTime += amount;
    bucket.total += amount;
    bucket.count += 1;
    buckets.set(year, bucket);
  }

  return [...buckets.values()].sort((a, b) => a.year.localeCompare(b.year));
}

/** Top schemes by invested amount, with the remainder folded into "Other". */
export function topSchemes(
  investments: { scheme: string; amount: number }[],
  limit = 5,
): { scheme: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const inv of investments) {
    totals.set(inv.scheme, (totals.get(inv.scheme) ?? 0) + (Number(inv.amount) || 0));
  }
  const sorted = [...totals.entries()]
    .map(([scheme, amount]) => ({ scheme, amount }))
    .sort((a, b) => b.amount - a.amount);

  if (sorted.length <= limit) return sorted;
  const rest = sorted.slice(limit).reduce((sum, s) => sum + s.amount, 0);
  return [...sorted.slice(0, limit), { scheme: "Other", amount: rest }];
}

/** Committed SIP inflow per month, normalising quarterly SIPs to a monthly figure. */
export function monthlySipCommitment(
  sips: { amount: number; frequency: string; status: string }[],
) {
  return sips
    .filter((s) => s.status === "Active")
    .reduce((sum, s) => sum + (Number(s.amount) || 0) / (s.frequency === "Quarterly" ? 3 : 1), 0);
}

/** Compact INR for axis ticks: 12.5L, 3.2Cr — full precision stays in the table view. */
export function inrCompact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
  if (abs >= 1e3) return `₹${(value / 1e3).toFixed(0)}K`;
  return `₹${Math.round(value)}`;
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join(
    "\n",
  );
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
