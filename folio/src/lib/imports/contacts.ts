/**
 * Client details (mobile, email, address, date of birth) from any registrar report that has them: the
 * investor / folio master reports CAMS and KFintech mail, and transaction reports that carry them.
 * Columns are found by their usual names, like the transaction reader (./feed.ts).
 */
import type { Row } from "./tables";
import { clean, cleanPan, parseDate } from "./normalise";

export type ContactRow = {
  folio: string | null;
  pan: string | null;
  name: string | null;
  amc: string | null;
  email: string | null;
  mobile: string | null;
  address: string | null;
  dob: string | null;
};

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

const COLUMNS = {
  folio: ["FOLIO_NO", "FOLIONO", "FOLIO", "FOLIO NUMBER", "TD_ACNO", "ACNO", "ACCOUNT NUMBER"],
  pan: ["PAN", "PAN_NO", "PANNO", "PAN1", "IT_PAN_NO1", "PAN NUMBER", "FIRST HOLDER PAN", "INVESTOR PAN", "INV_PAN"],
  name: ["INV_NAME", "INVNAME", "INVESTOR NAME", "INVESTOR_NAME", "NAME", "FIRST HOLDER NAME", "UNITHOLDER NAME", "INVESTOR"],
  amc: ["AMC_NAME", "AMC NAME", "FUND NAME", "AMC"],
  email: ["EMAIL", "EMAIL_ID", "EMAILID", "E_MAIL", "EMAIL ADDRESS", "INV_EMAIL", "INVESTOR EMAIL", "EMAIL1", "MAILID"],
  mobile: ["MOBILE", "MOBILE_NO", "MOBILENO", "MOB_NO", "MOBILE NUMBER", "INV_MOBILE", "MOBILE1", "CELL", "PH_MOBILE"],
  address1: ["ADDRESS1", "ADD1", "ADDRESS", "ADDRESS_1", "ADDR1", "INV_ADD1"],
  address2: ["ADDRESS2", "ADD2", "ADDRESS_2", "ADDR2", "INV_ADD2"],
  address3: ["ADDRESS3", "ADD3", "ADDRESS_3", "ADDR3", "INV_ADD3"],
  city: ["CITY", "INV_CITY"],
  pin: ["PINCODE", "PIN", "PIN_CODE", "ZIP", "INV_PIN"],
  dob: ["DOB", "DATE_OF_BIRTH", "DATE OF BIRTH", "INV_DOB", "BIRTH_DATE", "DOB1"],
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

export function cleanEmail(text: string | undefined | null): string | null {
  const t = clean(text).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(t) ? t : null;
}

/** Indian mobiles as 10 digits; other numbers with their country code. Landlines and junk are dropped. */
export function cleanMobile(text: string | undefined | null): string | null {
  let d = clean(text).replace(/[^\d+]/g, "");
  if (d.startsWith("+91")) d = d.slice(3);
  else if (d.startsWith("0091")) d = d.slice(4);
  else if (/^91\d{10}$/.test(d)) d = d.slice(2);
  else if (/^0\d{10}$/.test(d)) d = d.slice(1);
  if (/^[6-9]\d{9}$/.test(d)) return d;
  return /^\+\d{8,15}$/.test(d) ? d : null;
}

/** Contact rows from a table, or none when it has no contact columns at all. */
export function readContacts(rows: Row[]): ContactRow[] {
  const header = Object.keys(rows[0] ?? {});
  const col = findColumns(header);
  if (!col.email && !col.mobile && !col.address1 && !col.dob) return [];
  if (!col.pan && !col.folio) return [];
  const get = (r: Row, f: Field) => (col[f] ? clean(r[col[f]!] ?? "") : "");
  const out: ContactRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const address = [get(r, "address1"), get(r, "address2"), get(r, "address3"), get(r, "city"), get(r, "pin")].filter(Boolean).join(", ") || null;
    const dob = get(r, "dob") ? parseDate(get(r, "dob"), 1900) : null;
    const c: ContactRow = {
      folio: get(r, "folio").replace(/\s*\/\s*/g, "/") || null,
      pan: cleanPan(get(r, "pan")),
      name: get(r, "name") || null,
      amc: get(r, "amc") || null,
      email: cleanEmail(get(r, "email")),
      mobile: cleanMobile(get(r, "mobile")),
      address: address && address.length > 4 ? address.slice(0, 400) : null,
      dob: dob && dob < new Date().toISOString().slice(0, 10) ? dob : null,
    };
    if (!c.pan && !c.folio) continue;
    if (!c.email && !c.mobile && !c.address && !c.dob) continue;
    const k = [c.pan, c.folio, c.email, c.mobile].join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
