/**
 * Form rules for clients, investments and SIPs, shared by the pages (instant messages) and the server (the
 * real check). Same rules as the old FundVault app: Indian PAN, 10-digit mobile, IFSC, MICR, account number.
 */
import { z } from "zod";

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const MOBILE_REGEX = /^[6-9]\d{9}$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const MICR_REGEX = /^\d{9}$/;
export const ACCOUNT_NO_REGEX = /^\d{9,18}$/;

export const NOMINEE_RELATIONS = ["Spouse", "Son", "Daughter", "Father", "Mother", "Brother", "Sister", "Other"] as const;

const opt = <T extends z.ZodType>(schema: T) => z.literal("").or(schema);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");

export const clientSchema = z.object({
  name: z.string().trim().min(2, "Enter the client's full name.").max(100),
  mobile: opt(z.string().trim().regex(MOBILE_REGEX, "Enter a valid 10-digit mobile number.")),
  email: opt(z.string().trim().toLowerCase().pipe(z.email({ message: "Enter a valid email." }))),
  address: z.string().trim().max(300),
  pan: opt(z.string().trim().toUpperCase().regex(PAN_REGEX, "PAN must look like ABCDE1234F.")),
  dob: opt(date),
  bankAccountNo: opt(z.string().trim().regex(ACCOUNT_NO_REGEX, "Account number must be 9–18 digits.")),
  bankName: z.string().trim().max(120),
  ifsc: opt(z.string().trim().toUpperCase().regex(IFSC_REGEX, "IFSC must look like HDFC0001234.")),
  micr: opt(z.string().trim().regex(MICR_REGEX, "MICR code must be 9 digits.")),
  branch: z.string().trim().max(120),
  nomineeName: z.string().trim().max(100),
  nomineeDob: opt(date),
  nomineePan: opt(z.string().trim().toUpperCase().regex(PAN_REGEX, "Nominee PAN must look like ABCDE1234F.")),
  nomineeMobile: opt(z.string().trim().regex(MOBILE_REGEX, "Enter a valid 10-digit nominee mobile number.")),
  nomineeEmail: opt(z.string().trim().toLowerCase().pipe(z.email({ message: "Enter a valid nominee email." }))),
  nomineeRelation: z.string().trim().max(40),
  notes: z.string().trim().max(2000),
});
export type ClientForm = z.infer<typeof clientSchema>;

export const EMPTY_CLIENT: ClientForm = {
  name: "",
  mobile: "",
  email: "",
  address: "",
  pan: "",
  dob: "",
  bankAccountNo: "",
  bankName: "",
  ifsc: "",
  micr: "",
  branch: "",
  nomineeName: "",
  nomineeDob: "",
  nomineePan: "",
  nomineeMobile: "",
  nomineeEmail: "",
  nomineeRelation: "",
  notes: "",
};

export const INVESTMENT_TYPES = [
  { value: "purchase", label: "One-time" },
  { value: "sip", label: "SIP" },
  { value: "redemption", label: "Redemption" },
] as const;
export const PAYMENT_MODES = [
  { value: "online", label: "Online" },
  { value: "cheque", label: "Cheque" },
  { value: "mandate", label: "Mandate (NACH)" },
] as const;

/** The AMFI scheme picked from the list; empty when only a name was typed. */
const instrumentId = z.literal("").or(z.uuid()).default("");

export const investmentSchema = z.object({
  investorId: z.uuid({ message: "Choose a client." }),
  scheme: z.string().trim().min(2, "Enter the scheme name.").max(160),
  instrumentId,
  type: z.enum(["purchase", "sip", "redemption"]),
  amount: z.coerce.number().positive("Amount must be more than 0.").max(1e11),
  date: date,
  paymentMode: z.enum(["online", "cheque", "mandate"]),
  reference: z.string().trim().max(60),
});
export type InvestmentForm = z.infer<typeof investmentSchema>;

export const SIP_FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
] as const;
export const SIP_STATUSES = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "stopped", label: "Stopped" },
] as const;

export const sipSchema = z.object({
  investorId: z.uuid({ message: "Choose a client." }),
  scheme: z.string().trim().min(2, "Enter the scheme name.").max(160),
  instrumentId,
  amount: z.coerce.number().positive("Amount must be more than 0.").max(1e10),
  frequency: z.enum(["monthly", "quarterly"]),
  startDate: date,
  status: z.enum(["active", "paused", "stopped"]),
});
export type SipForm = z.infer<typeof sipSchema>;

/** Today in India, as YYYY-MM-DD. */
export function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
