/** A client's or a family's portfolio statement: what the branded PDF shows (built by ./statement-pdf.ts). */

export const AMFI_DISCLAIMER = "Mutual Fund investments are subject to market risks, read all scheme related documents carefully.";

export type StatementData = {
  practice: { name: string; arn: string | null; euin: string | null };
  /** The client's name, or the family's. */
  title: string;
  /** Family members (one name for a single client). */
  people: string[];
  isFamily: boolean;
  /** YYYY-MM-DD, India time. */
  generatedOn: string;
  navDate: string | null;
  total: { value: number; invested: number; gain: number; returnLabel: "XIRR" | "Return"; returnValue: number | null };
  holdings: {
    scheme: string;
    member: string;
    units: number;
    invested: number;
    value: number | null;
    gain: number | null;
    returnLabel: "XIRR" | "Return";
    returnValue: number | null;
    estimated: boolean;
  }[];
  /** Money in schemes not matched to AMFI yet: no value until matched. */
  notValued: { scheme: string; invested: number }[];
  sips: { scheme: string; member: string; amount: number; frequency: string; since: string; status: string }[];
  /** The last 12 months, newest first. */
  transactions: { date: string; scheme: string; member: string; type: string; amount: number; units: number | null }[];
};

/** "Sharma family" → "sharma-family-statement-2026-10-28.pdf". */
export function statementFileName(d: Pick<StatementData, "title" | "generatedOn">): string {
  const slug = d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "portfolio";
  return `${slug}-statement-${d.generatedOn}.pdf`;
}
