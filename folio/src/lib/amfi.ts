/**
 * AMFI data formats (India).
 *
 * NAVAll.txt (https://portal.amfiindia.com/spages/NAVAll.txt), published every business day by about 11 pm IST:
 *
 *   Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
 *
 *   Open Ended Schemes(Equity Scheme - Flexi Cap Fund)          <- scheme type and category
 *
 *   HDFC Mutual Fund                                           <- fund house (AMC)
 *
 *   101762;INF179K01608;-;HDFC Flexi Cap Fund - Growth Plan;1876.543;24-Oct-2026
 *
 * Since 2026 the file has separate Plan and Option columns, and the name no longer says them:
 *
 *   Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date
 *   101762;INF179K01608;-;HDFC Flexi Cap Fund;Regular Plan;Growth Option;1952.877;27-Oct-2026
 *
 * Columns are found from the header line, so both layouts read. With the new one, the plan and option are put
 * back into the name ("HDFC Flexi Cap Fund - Regular Plan - Growth Option"): a scheme's plans and options stay
 * told apart, and `planOf` / `optionOf` keep working on the name.
 *
 * mfapi.in history (https://api.mfapi.in/mf/<scheme code>): { data: [{ date: "24-10-2026", nav: "1876.54300" }, …] },
 * newest first.
 */

export type AmfiScheme = {
  amfiCode: string;
  isin: string | null;
  isinReinvest: string | null;
  name: string;
  amc: string | null;
  schemeType: string | null;
  category: string | null;
  plan: "direct" | "regular";
  option: "growth" | "idcw_payout" | "idcw_reinvest" | "bonus" | null;
  nav: string | null;
  navDate: string | null;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "24-Oct-2026" or "24-10-2026" → "2026-10-24"; null if it isn't a date. */
export function amfiDate(text: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3}|\d{1,2})-(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const month = /^\d+$/.test(m[2]!) ? m[2]!.padStart(2, "0") : MONTHS[m[2]!.toLowerCase()];
  if (!month || Number(month) > 12) return null;
  const day = m[1]!.padStart(2, "0");
  if (Number(day) < 1 || Number(day) > 31) return null;
  return `${m[3]}-${month}-${day}`;
}

/** A NAV as stored (up to 6 decimals), or null for "N.A.", zero or junk. */
export function amfiNav(text: string): string | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!(n > 0) || n > 1e9) return null;
  return n.toFixed(6).replace(/\.?0+$/, "") || null;
}

const isin = (text: string | undefined) => {
  const t = (text ?? "").trim().toUpperCase();
  return /^IN[A-Z0-9]{10}$/.test(t) ? t : null;
};

export function planOf(name: string): "direct" | "regular" {
  return /\bdirect\b/i.test(name) ? "direct" : "regular";
}

export function optionOf(name: string): AmfiScheme["option"] {
  const n = name.toLowerCase();
  if (/re-?invest/.test(n)) return "idcw_reinvest";
  if (/\bidcw\b|dividend|income distribution|\bpayout\b/.test(n)) return "idcw_payout";
  if (/\bgrowth\b/.test(n)) return "growth";
  if (/\bbonus\b/.test(n)) return "bonus";
  return null;
}

type Layout = { name: number; plan: number | null; option: number | null; nav: number; date: number };
const OLD_LAYOUT: Layout = { name: 3, plan: null, option: null, nav: 4, date: 5 };

function layoutOf(header: string): Layout {
  const cols = header.split(";").map((c) => c.trim().toLowerCase());
  const at = (label: string) => {
    const i = cols.indexOf(label);
    return i < 0 ? null : i;
  };
  const name = at("scheme name");
  const nav = at("net asset value");
  const date = at("date");
  if (name === null || nav === null || date === null) return OLD_LAYOUT;
  return { name, plan: at("plan"), option: at("option"), nav, date };
}

export function parseNavAll(text: string): AmfiScheme[] {
  const out: AmfiScheme[] = [];
  let layout = OLD_LAYOUT;
  let amc: string | null = null;
  let schemeType: string | null = null;
  let category: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("Scheme Code")) {
      layout = layoutOf(line);
      continue;
    }
    if (!line.includes(";")) {
      const head = /^(.+?)\s*Schemes?\s*\((.*)\)\s*$/i.exec(line);
      if (head) {
        schemeType = head[1]!.trim();
        category = head[2]!.trim() || null;
        amc = null;
      } else {
        amc = line;
      }
      continue;
    }
    const cols = line.split(";");
    if (cols.length <= Math.max(layout.name, layout.nav, layout.date)) continue;
    const code = cols[0]!.trim();
    const part = (i: number | null) => (i === null ? "" : (cols[i] ?? "").replace(/\s+/g, " ").trim());
    const base = part(layout.name);
    if (!/^\d{1,8}$/.test(code) || !base) continue;
    const name = [base, part(layout.plan), part(layout.option)].filter((x) => x && x !== "-").join(" - ");
    const nav = amfiNav(cols[layout.nav]!);
    const navDate = nav ? amfiDate(cols[layout.date]!) : null;
    out.push({
      amfiCode: code,
      isin: isin(cols[1]),
      isinReinvest: isin(cols[2]),
      name,
      amc,
      schemeType,
      category,
      plan: planOf(name),
      option: optionOf(name),
      nav: navDate ? nav : null,
      navDate,
    });
  }
  return out;
}

/** mfapi.in's history answer → [{ date, nav }] (oldest first), skipping bad rows. */
export function parseMfapiHistory(json: unknown): { date: string; nav: string }[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const rows: { date: string; nav: string }[] = [];
  for (const r of data) {
    const date = typeof r?.date === "string" ? amfiDate(r.date) : null;
    const nav = typeof r?.nav === "string" ? amfiNav(r.nav) : null;
    if (date && nav) rows.push({ date, nav });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
