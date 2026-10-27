/**
 * The one shape every import becomes (registrar feeds and CAS statements alike), and the rules for reading
 * transaction types, dates and numbers the way Indian registrars write them.
 */

export type ImportSource = "cams" | "kfintech" | "cas";

/** purchase | sip | redemption | switch_in | switch_out | idcw_reinvest | idcw_payout */
export type TxnType = "purchase" | "sip" | "redemption" | "switch_in" | "switch_out" | "idcw_reinvest" | "idcw_payout";

export type ImportTxn = {
  /** Registrar's own id when given; with folio and scheme it makes re-sent files harmless. */
  ref: string;
  folio: string;
  amc: string | null;
  scheme: string;
  isin: string | null;
  rtaCode: string | null;
  investorName: string | null;
  pan: string | null;
  type: TxnType;
  date: string;
  /** Rupees, positive. A reversal of a purchase has negative amount and units. */
  amount: number;
  units: number | null;
  nav: number | null;
  /** Distributor code (ARN-…) the transaction came through, when the file says. */
  arn: string | null;
  description: string;
};

export type Skipped = { reason: string; text: string };

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const iso = (y: number, m: number, d: number) =>
  y >= 1980 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;

/**
 * "24-Oct-2026", "24 Oct 2026", "24/10/2026", "24-10-2026", "2026-10-24", "20261024", "10/24/2026 00:00:00".
 * Day-first unless the first number can't be a day... month (Indian files are day-first).
 */
export function parseDate(text: string): string | null {
  const t = text.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$/i, "");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-\s/.]*([A-Za-z]{3})[A-Za-z]*[-\s/.,]*(\d{2,4})$/.exec(t);
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    const year = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return month ? iso(year, month, +m[1]!) : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(t);
  if (m) {
    let [a, b] = [+m[1]!, +m[2]!];
    if (b > 12 && a <= 12) [a, b] = [b, a];
    const year = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return iso(year, b, a);
  }
  return null;
}

/** "1,23,456.78", "(1,000.00)", "-12.5", "" → number or null. Parentheses mean negative. */
export function parseNumber(text: string | undefined | null): number | null {
  if (text === undefined || text === null) return null;
  let t = String(text).trim().replace(/,/g, "").replace(/^₹|^INR\s*|^Rs\.?\s*/i, "");
  if (!t) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (t.startsWith("-")) {
    negative = !negative;
    t = t.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

const STP = /\bs\s*t\s*p\b|systematic\s+transfer/i;

/**
 * What a transaction is, from its description, the registrar's type code and the sign of its units (in the
 * manner of the open-source casparser rules). Null for rows that aren't money moving: taxes, stamp duty,
 * address changes, nominee registrations.
 */
export function classify(description: string, code: string, units: number | null): TxnType | null {
  const d = description.toLowerCase();
  const c = code.trim().toUpperCase();
  if (/\b(stt|stamp duty|tds|tax deducted)\b/.test(d) && !/purchase|redemption|sip|switch/.test(d)) return null;
  if (/registration of nominee|change of address|address updated|kyc|nominee/.test(d) && units === null) return null;
  if (/(div\.|dividend|idcw)/.test(d) || /^(DR|DIR|DIVR|DP|DIV|DVP|DIVP)$/.test(c)) {
    return /reinv/.test(d) || /^(DR|DIR|DIVR)$/.test(c) ? "idcw_reinvest" : "idcw_payout";
  }
  const out = units !== null ? units < 0 : null;
  const switchLike = /switch|lateral shift|transfer (in|out)/.test(d) || STP.test(d);
  if (switchLike) {
    const saysIn = /\bin\b/.test(d);
    const saysOut = /\bout\b/.test(d);
    if (saysOut && !saysIn) return "switch_out";
    if (saysIn && !saysOut) return "switch_in";
    return out === true ? "switch_out" : "switch_in";
  }
  if (/redemption|redeem|repurchase|withdrawal|\bswp\b|systematic withdrawal|sale/.test(d)) return "redemption";
  if (/\bsip\b|systematic|instal+ment|sys.+invest/.test(d)) return "sip";
  if (/purchase|subscription|investment|\bnfo\b|\bipo\b|additional|fresh|new/.test(d)) return "purchase";
  // No telling description: the code, then the sign of the units.
  if (/^(SIN|SIP|SYS|SIPR|ISIP)/.test(c)) return "sip";
  if (/^(SO|SWOF|SWO|STPO|LTOF|TO|TRFO)/.test(c)) return "switch_out";
  if (/^(SI|SWIN|SWI|STPI|LTIN|TI|TRFI)/.test(c)) return "switch_in";
  if (/^(R|RED|SWD|SWP|REDR)/.test(c)) return "redemption";
  if (/^(P|NEW|ADD|NFO|IPO|PUR|ADDPUR|FRESH)/.test(c)) return "purchase";
  if (out === true) return "redemption";
  if (out === false) return "purchase";
  return null;
}

export const OUT_TYPES: TxnType[] = ["redemption", "switch_out"];

/** Text kept for display and matching: one line, single spaces. */
export function clean(text: string | undefined | null): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export function cleanPan(text: string | undefined | null): string | null {
  const t = clean(text).toUpperCase();
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(t) ? t : null;
}

export function cleanIsin(text: string | undefined | null): string | null {
  const t = clean(text).toUpperCase();
  return /^IN[A-Z0-9]{10}$/.test(t) ? t : null;
}

/** "HDFC Flexi Cap Fund - Regular Plan" → "HDFC" (the fund house, when nothing better is given). */
export function amcFromScheme(scheme: string): string {
  return clean(scheme).split(" ")[0] ?? "";
}
