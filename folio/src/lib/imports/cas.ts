/**
 * Detailed CAS (Consolidated Account Statement from CAMS or KFintech): text lines → folios, schemes and
 * transactions. The layout rules follow the open-source casparser project's reading of these statements.
 *
 * A statement looks like this (cells separated by tabs once read from the PDF, see ./pdf-lines.ts):
 *
 *   HDFC Mutual Fund
 *   Folio No: 1234567 / 89   PAN: ABCDE1234F   KYC: OK  PAN: OK
 *   ABCD-HDFC Flexi Cap Fund - Regular Plan - Growth (Advisor: ARN-12345) Registrar : CAMS  ISIN: INF179K01608
 *   Opening Unit Balance: 0.000
 *   05-Jan-2026  Purchase  10,000.00  5.333  1,875.00  5.333
 *   05-Jan-2026  *** Stamp Duty ***  0.50
 *   Closing Unit Balance: 5.333   NAV on 24-Oct-2026: INR 1,876.54   Total Cost Value: 10,000.00   Market Value on 24-Oct-2026: INR 10,008.18
 *
 * Each row prints the running unit balance, so every scheme is checked: opening balance + units of every row must
 * equal the closing balance. A scheme that doesn't add up is reported, never silently imported wrong.
 */
import { classify, clean, cleanIsin, cleanPan, OUT_TYPES, parseDate, parseNumber, type ImportTxn } from "./normalise";

export type CasScheme = {
  folio: string;
  pan: string | null;
  amc: string | null;
  scheme: string;
  isin: string | null;
  rtaCode: string | null;
  registrar: string | null;
  advisor: string | null;
  open: number;
  close: number | null;
  nav: number | null;
  navDate: string | null;
  value: number | null;
  cost: number | null;
  txns: ImportTxn[];
  /** Opening balance + units of every row = closing balance (within 0.002 units). */
  balanced: boolean;
};

export type CasResult = {
  investorName: string | null;
  email: string | null;
  period: { from: string; to: string } | null;
  schemes: CasScheme[];
  warnings: string[];
};

const DATE_START = /^(\d{1,2}[-\s]?[A-Za-z]{3}[-\s]?\d{4})\b/;
const NUMBER = /^\(?-?[\d,]*\.?\d+\)?$/;
const FOLIO_RE = /Folio\s*No\s*[:.]?\s*([0-9A-Z]+(?:\s*\/\s*[0-9A-Z]+)?)/i;
const PAN_RE = /PAN\s*:\s*([A-Z]{5}\d{4}[A-Z])/i;
const OPEN_RE = /Opening\s+Unit\s+Balance\s*:?\s*([\d,.]+)/i;
const CLOSE_RE = /Closing\s+Unit\s+Balance\s*:?\s*([\d,.]+)/i;
const NAV_RE = /NAV\s+on\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s*:\s*INR\s*([\d,.]+)/i;
const VALUE_RE = /(?:Market\s+Value|Valuation)\s+on\s+\d{1,2}-[A-Za-z]{3}-\d{4}\s*:\s*INR\s*([\d,.]+)/i;
const COST_RE = /Total\s+Cost\s+Value\s*:?\s*([\d,.]+)/i;
const AMC_RE = /^([A-Za-z0-9&.' ()-]+?\s+(?:Mutual\s*Fund|MF|Fund\s*House))\s*$/i;
const SCHEME_LINE_RE = /^\s*(?=[A-Z0-9 ]{0,40}[A-Z])([A-Z0-9]+(?: [A-Z0-9]+)*)-(.+)$/i;
const ISIN_RE = /\bIN[FE][0-9A-Z]{8}\d\b/;
const ADVISOR_RE = /Advisor\s*:\s*([^)]+?)\s*\)/i;
const REGISTRAR_RE = /\b(CAMS|KFINTECH|KFIN|KARVY)\b/i;
const NAME_END_RE = /\(\s*Advisor\s*:|Registrar\s*:?|Nominee\s+\d|-?\s*ISIN\s*:|\bARN-?\d+\b|\bINA\d+\b|\b(?:CAMS|KFINTECH|KFIN|KARVY)\b/i;
const PERIOD_RE = /(\d{1,2}-[A-Za-z]{3}-\d{4})\s+To\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/i;

/** Cells of a line: split on tabs (set by the PDF reader where columns are apart) or 2+ spaces. */
function cellsOf(line: string): string[] {
  return line
    .split(/\t+| {2,}/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function schemeName(raw: string): string {
  let name = raw.replace(/-?\s*ISIN\s*:\s*IN[A-Z0-9]*/gi, " ").replace(/\(\s*Advisor\s*:[^)]*\)/gi, " ");
  const cut = NAME_END_RE.exec(name);
  if (cut) name = name.slice(0, cut.index);
  name = name.replace(/\((formerly|erstwhile)[^)]*\)/gi, "").replace(/\((Demat|Non-Demat).*/i, "");
  return clean(name).replace(/[\s\-–:,(]+$/, "");
}

export function parseCas(lines: string[]): CasResult {
  const warnings: string[] = [];
  const schemes: CasScheme[] = [];
  let period: CasResult["period"] = null;
  let email: string | null = null;
  let investorName: string | null = null;
  let amc: string | null = null;
  let folio: string | null = null;
  let pan: string | null = null;
  let header: string[] = [];
  // (Cast so TypeScript doesn't narrow it to null: the helpers below assign it.)
  let current = null as (CasScheme & { running: number; balances: (number | null)[] }) | null;
  let lastWasTxn = false;

  const finish = () => {
    if (!current) return;
    const { running: _r, balances: _b, ...s } = current;
    s.balanced = s.close === null || Math.abs(current.running - s.close) < 0.002;
    if (!s.balanced) warnings.push(`${s.scheme} (folio ${s.folio}): the rows add up to ${current.running.toFixed(3)} units but the statement says ${s.close?.toFixed(3)}. This scheme was left out; please check it by hand.`);
    schemes.push(s);
    current = null;
  };

  const startScheme = (openText: string) => {
    finish();
    const text = header.join(" ");
    const lineIdx = header.findIndex((h) => SCHEME_LINE_RE.test(h) && !/^ARN-/i.test(h));
    if (!folio || lineIdx < 0) {
      if (header.length) warnings.push(`A scheme without a readable folio or name was skipped near: ${clean(text).slice(0, 80)}`);
      header = [];
      return;
    }
    const m = SCHEME_LINE_RE.exec(header[lineIdx]!)!;
    const nameText = [m[2]!, ...header.slice(lineIdx + 1)].join(" ");
    current = {
      folio,
      pan,
      amc,
      scheme: schemeName(nameText),
      isin: cleanIsin(ISIN_RE.exec(text)?.[0]),
      rtaCode: clean(m[1]),
      registrar: REGISTRAR_RE.exec(text)?.[1]?.toUpperCase().replace("KARVY", "KFINTECH").replace(/^KFIN$/, "KFINTECH") ?? null,
      advisor: clean(ADVISOR_RE.exec(text)?.[1]) || null,
      open: parseNumber(openText) ?? 0,
      close: null,
      nav: null,
      navDate: null,
      value: null,
      cost: null,
      txns: [],
      balanced: true,
      running: parseNumber(openText) ?? 0,
      balances: [],
    };
    header = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const flat = clean(line.replace(/\t/g, " "));
    if (!flat) continue;

    if (!period) {
      const p = PERIOD_RE.exec(flat);
      if (p) period = { from: parseDate(p[1]!)!, to: parseDate(p[2]!)! };
    }
    if (!email) {
      const e = /Email\s*(?:Id)?\s*:\s*(\S+@\S+)/i.exec(flat);
      if (e) {
        email = e[1]!;
        continue;
      }
    }
    if (email && !investorName && !schemes.length && !current && /^[A-Za-z][A-Za-z .'&-]{2,79}$/.test(flat) && flat.split(" ").length >= 2 && !AMC_RE.test(flat) && !/statement|account|portfolio|summary/i.test(flat)) {
      investorName = flat;
      continue;
    }

    const close = CLOSE_RE.exec(flat);
    if (close && current) {
      current.close = parseNumber(close[1]);
      const nav = NAV_RE.exec(flat);
      if (nav) {
        current.navDate = parseDate(nav[1]!);
        current.nav = parseNumber(nav[2]);
      }
      current.value = parseNumber(VALUE_RE.exec(flat)?.[1]);
      current.cost = parseNumber(COST_RE.exec(flat)?.[1]);
      finish();
      lastWasTxn = false;
      continue;
    }
    // NAV, value and cost may sit on the lines just after the closing balance.
    const target = current ?? schemes[schemes.length - 1];
    if (target && !DATE_START.test(flat) && (NAV_RE.test(flat) || VALUE_RE.test(flat) || COST_RE.test(flat))) {
      const nav = NAV_RE.exec(flat);
      if (nav) {
        target.navDate = parseDate(nav[1]!);
        target.nav = parseNumber(nav[2]);
      }
      target.value = parseNumber(VALUE_RE.exec(flat)?.[1]) ?? target.value;
      target.cost = parseNumber(COST_RE.exec(flat)?.[1]) ?? target.cost;
      continue;
    }

    const folioMatch = FOLIO_RE.exec(flat);
    if (folioMatch && !DATE_START.test(flat)) {
      finish();
      folio = folioMatch[1]!.replace(/\s+/g, "");
      pan = cleanPan(PAN_RE.exec(flat)?.[1]) ?? pan;
      header = [];
      lastWasTxn = false;
      continue;
    }
    if (AMC_RE.test(flat) && !current && !/folio/i.test(flat)) {
      amc = AMC_RE.exec(flat)![1]!.trim();
      continue;
    }

    const open = OPEN_RE.exec(flat);
    if (open) {
      // Text before the label on the same line belongs to the header.
      const before = flat.slice(0, open.index).trim();
      if (before) header.push(before);
      startScheme(open[1]!);
      lastWasTxn = false;
      continue;
    }

    if (current) {
      const dated = DATE_START.exec(flat);
      if (dated) {
        const date = parseDate(dated[1]!);
        const cells = cellsOf(line);
        // The date may be its own cell or the start of the first one.
        if (cells[0] && DATE_START.test(cells[0])) cells[0] = cells[0].replace(DATE_START, "").trim();
        const nums: number[] = [];
        while (cells.length && NUMBER.test(cells[cells.length - 1]!)) nums.unshift(parseNumber(cells.pop()!)!);
        const description = clean(cells.join(" "));
        let amount: number | null = null;
        let units: number | null = null;
        let price: number | null = null;
        let balance: number | null = null;
        if (nums.length >= 4) [amount, units, price, balance] = nums.slice(-4) as [number, number, number, number];
        else if (nums.length === 3) {
          // Units, price and balance with no amount (bonus, merger), or amount, units, balance.
          const [a, b, c] = nums as [number, number, number];
          if (Math.abs(current.running + a - c) < 0.002 || Math.abs(current.running - Math.abs(a) - c) < 0.002) [units, price, balance] = [a, b, c];
          else [amount, units, balance] = [a, b, c];
        }
        if (!date || units === null) {
          // Stamp duty, STT, TDS, nominee notes: no units, nothing to hold.
          lastWasTxn = false;
          continue;
        }
        // Trust the printed running balance for the sign (some statements put brackets on reversed rows).
        if (balance !== null) {
          if (Math.abs(current.running + units - balance) > 0.002 && Math.abs(current.running - units - balance) < 0.002) {
            units = -units;
            if (amount !== null) amount = -amount;
          }
          if (Math.abs(current.running + units - balance) > 0.002) {
            warnings.push(`${current.scheme} (folio ${current.folio}), ${date}: the units don't follow from the previous balance; the statement's balance is used from here.`);
          }
          current.running = balance;
        } else current.running += units;
        if (amount === null && price !== null) amount = Math.round(Math.abs(units) * price * 100) / 100;
        const type = classify(description, "", units);
        if (!type) {
          lastWasTxn = false;
          continue;
        }
        const out = OUT_TYPES.includes(type);
        const reversal = !out && units < 0;
        current.txns.push({
          ref: [current.folio, current.isin ?? current.rtaCode ?? current.scheme, date, type, units.toFixed(4), balance?.toFixed(4) ?? ""].join("|"),
          folio: current.folio,
          amc: current.amc,
          scheme: current.scheme,
          isin: current.isin,
          rtaCode: current.rtaCode,
          investorName,
          pan: current.pan,
          type,
          date,
          amount: reversal ? -Math.abs(amount ?? 0) : Math.abs(amount ?? 0),
          units: reversal ? -Math.abs(units) : Math.abs(units),
          nav: price,
          arn: current.advisor && /^ARN-?\d+$/i.test(current.advisor) ? current.advisor.toUpperCase().replace(/^ARN-?/, "ARN-") : null,
          description,
        });
        lastWasTxn = true;
        continue;
      }
      // A wrapped description continues the previous row.
      if (lastWasTxn && !/\d{2,}/.test(flat) && flat.length < 80) {
        const t = current.txns[current.txns.length - 1];
        if (t) t.description = clean(`${t.description} ${flat}`);
        continue;
      }
      lastWasTxn = false;
      continue;
    }

    // Between a folio line and "Opening Unit Balance": the scheme header (may wrap over lines).
    if (folio) header.push(flat);
    if (header.length > 12) header.shift();
  }
  finish();
  return { investorName, email, period, schemes, warnings };
}

/** The transactions to import from a statement: only schemes whose units add up to the closing balance. */
export function casTransactions(result: CasResult): ImportTxn[] {
  return result.schemes.filter((s) => s.balanced).flatMap((s) => s.txns);
}
