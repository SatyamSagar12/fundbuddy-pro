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
