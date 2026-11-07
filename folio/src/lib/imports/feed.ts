/**
 * CAMS and KFintech transaction reports (mailback / MIS downloads) → ImportTxn.
 *
 * The two registrars name their columns differently, and change them between report versions. Columns are found
 * by any of their known names (case, spaces and punctuation ignored), so a renamed or reordered column still
 * reads. A report without folio, scheme, date, amount and type columns is refused with the names it lacked.
 */
import type { Row } from "./tables";
import { amcFromScheme, classify, clean, cleanIsin, cleanPan, OUT_TYPES, parseDate, parseNumber, type ImportSource, type ImportTxn, type Skipped } from "./normalise";

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Known column names, best first. */
const COLUMNS = {
  folio: ["FOLIO_NO", "FOLIONO", "FOLIO", "FOLIO NUMBER", "TD_ACNO", "ACNO", "ACCOUNT NUMBER", "ACCOUNT NO"],
  scheme: ["SCHEME", "SCHEME_NAME", "SCHEME NAME", "FUNDDESC", "FUND DESCRIPTION", "SCHEME DESCRIPTION", "SCHEMEDESC", "SCH_NAME", "PRODUCT NAME"],
  amc: ["AMC_NAME", "AMC NAME", "FUND NAME", "AMC"],
  isin: ["ISIN", "SCHEMEISIN", "SCHEME ISIN", "ISIN NO", "ISIN_NO"],
  rtaCode: ["PRODCODE", "PRODUCT CODE", "PROD_CODE", "SCHEME CODE", "SCHEME_CODE", "SCHEMECODE", "FMCODE", "SCH_CODE"],
  investorName: ["INV_NAME", "INVNAME", "INVESTOR NAME", "INVESTOR_NAME", "NAME", "FIRST HOLDER NAME", "UNITHOLDER NAME"],
  pan: ["PAN", "PAN_NO", "PANNO", "PAN1", "IT_PAN_NO1", "PAN NUMBER", "FIRST HOLDER PAN", "INVESTOR PAN"],
  date: ["TRADDATE", "TRADE_DATE", "TRADE DATE", "TD_TRDT", "TRDT", "TRANSACTION DATE", "TRXN_DATE", "TRXNDATE", "TXN DATE", "NAVDATE", "NAV DATE", "POSTDATE", "TD_PRDT", "PROCESS DATE"],
  code: ["TRXNTYPE", "TRXN_TYPE", "TRXN_TYPE_", "TD_TRTYPE", "TRTYPE", "TRANSACTION TYPE", "TXN TYPE", "TRANSACTION_TYPE", "TRXN TYPE"],
  description: ["TRXN_NATUR", "TRXN_NATURE", "TRANSACTION NATURE", "TRDESC", "TRANSACTION DESCRIPTION", "TRXN_DESC", "TRXNDESC", "TXN DESCRIPTION", "DESCRIPTION", "TRXNSUBTYP"],
  amount: ["AMOUNT", "TD_AMT", "AMT", "TRANSACTION AMOUNT", "AMOUNT (RS.)", "AMOUNT RS", "GROSS AMOUNT"],
  units: ["UNITS", "TD_UNITS", "TRANSACTION UNITS", "NO OF UNITS", "UNIT"],
  nav: ["PURPRICE", "TD_POP", "PRICE", "NAV", "PURCHASE PRICE", "NAV PRICE", "RATE"],
  txnId: ["TRXNNO", "TRXN_NO", "TD_TRNO", "TRNO", "TRANSACTION NUMBER", "TRANSACTION NO", "TRANSACTION ID", "TXN NO", "USRTRXNO", "IHNO"],
  arn: ["BROK_CODE", "BROKER CODE", "BROKER_CODE", "TD_BROKER", "TD_AGENT", "AGENT CODE", "ARN", "ARN CODE", "BROKCODE"],
  status: ["TRXNSTAT", "TRXN_STAT", "TRNSTAT", "TRANSACTION STATUS", "STATUS"],
} as const;

type Field = keyof typeof COLUMNS;

function findColumns(header: string[]): Partial<Record<Field, string>> {
  const byKey = new Map(header.map((h) => [key(h), h]));
  const out: Partial<Record<Field, string>> = {};
  for (const [field, names] of Object.entries(COLUMNS) as [Field, readonly string[]][]) {
    for (const n of names) {
      const h = byKey.get(key(n));
      if (h !== undefined) {
        out[field] = h;
        break;
      }
    }
  }
  return out;
}

/** Which registrar a report is from, by its columns (CAMS: TRXNTYPE/PRODCODE; KFintech: TD_ fields). */
export function detectRegistrar(header: string[]): "cams" | "kfintech" | null {
  const keys = new Set(header.map(key));
  if (["TDACNO", "TDTRDT", "TDTRNO", "TDAMT", "TDPOP", "FMCODE"].some((k) => keys.has(k))) return "kfintech";
  if (["PRODCODE", "TRADDATE", "TRXNTYPE", "TRXNNATUR", "PURPRICE", "TRXNNO"].some((k) => keys.has(k))) return "cams";
  return null;
}

export type FeedResult = {
  source: ImportSource;
  txns: ImportTxn[];
  skipped: Skipped[];
  missing: string[];
};

const REQUIRED: Field[] = ["folio", "scheme", "date", "amount"];
const LABEL: Record<Field, string> = {
  folio: "folio number",
  scheme: "scheme name",
  amc: "fund house",
  isin: "ISIN",
  rtaCode: "scheme code",
  investorName: "investor name",
  pan: "PAN",
  date: "transaction date",
  code: "transaction type",
  description: "transaction description",
  amount: "amount",
  units: "units",
  nav: "price",
  txnId: "transaction number",
  arn: "broker code",
  status: "status",
};

export function readFeed(rows: Row[], hint?: "cams" | "kfintech"): FeedResult {
  const header = Object.keys(rows[0] ?? {});
  const source = hint ?? detectRegistrar(header) ?? "cams";
  const col = findColumns(header);
  const missing = REQUIRED.filter((f) => !col[f]).concat(!col.code && !col.description ? (["code"] as Field[]) : []);
  if (missing.length) return { source, txns: [], skipped: [], missing: missing.map((f) => LABEL[f]) };
  const get = (r: Row, f: Field) => (col[f] ? (r[col[f]!] ?? "") : "");
  const txns: ImportTxn[] = [];
  const skipped: Skipped[] = [];
  for (const r of rows) {
    const scheme = clean(get(r, "scheme"));
    const folio = clean(get(r, "folio")).replace(/\s*\/\s*/g, "/");
    const description = clean(get(r, "description"));
    const code = clean(get(r, "code"));
    const summary = [folio, scheme, get(r, "date"), description || code, get(r, "amount")].filter(Boolean).join(" · ");
    if (/reject|fail|cancel/i.test(get(r, "status"))) {
      skipped.push({ reason: "Rejected or cancelled by the registrar", text: summary });
      continue;
    }
    const date = parseDate(get(r, "date"));
    const amountRaw = parseNumber(get(r, "amount"));
    const unitsRaw = parseNumber(get(r, "units"));
    if (!folio || !scheme || !date || amountRaw === null) {
      skipped.push({ reason: "Missing folio, scheme, date or amount", text: summary });
      continue;
    }
    const type = classify(description, code, unitsRaw);
    if (!type) {
      skipped.push({ reason: "Not an investment or redemption (tax, stamp duty, or a detail change)", text: summary });
      continue;
    }
    // Money in and units held move together: a reversal of a purchase is a negative purchase.
    const out = OUT_TYPES.includes(type);
    const reversal = !out && ((unitsRaw ?? 0) < 0 || (amountRaw < 0 && (unitsRaw ?? 0) <= 0));
    const amount = reversal ? -Math.abs(amountRaw) : Math.abs(amountRaw);
    const units = unitsRaw === null ? null : reversal ? -Math.abs(unitsRaw) : Math.abs(unitsRaw);
    const nav = parseNumber(get(r, "nav"));
    const txnId = clean(get(r, "txnId"));
    const rtaCode = clean(get(r, "rtaCode")) || null;
    const arnRaw = clean(get(r, "arn")).toUpperCase();
    txns.push({
      ref: [folio, rtaCode ?? scheme, txnId || "-", date, type, units?.toFixed(4) ?? amount.toFixed(2)].join("|"),
      folio,
      amc: clean(get(r, "amc")) || amcFromScheme(scheme),
      scheme,
      isin: cleanIsin(get(r, "isin")),
      rtaCode,
      investorName: clean(get(r, "investorName")) || null,
      pan: cleanPan(get(r, "pan")),
      type,
      date,
      amount,
      units,
      nav: nav !== null && nav > 0 ? nav : null,
      arn: /^ARN-?\d+$/.test(arnRaw) ? arnRaw.replace(/^ARN-?/, "ARN-") : /^\d{3,8}$/.test(arnRaw) ? `ARN-${arnRaw}` : null,
      description: description || code,
    });
  }
  return { source, txns, skipped, missing: [] };
}
