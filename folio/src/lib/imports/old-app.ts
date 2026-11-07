/**
 * Reading the old FundVault app's data straight from its database (Lovable Cloud), in the browser.
 *
 * The person signs in with their old-app email and password; the browser then reads the clients, investments and
 * SIPs tables with that session, exactly as the old app itself does, and hands them to the Import page. The data
 * goes from the old app to this browser to Folio; it is never stored anywhere in between.
 *
 * The project address and key below are the old app's public ones (shipped in every copy of the old app's web
 * page); they open nothing without a signed-in user.
 */

export const OLD_APP_URL = "https://tojgfdjfmmnywjjrzdkn.supabase.co";
export const OLD_APP_KEY = "sb_publishable_iNueS_IOeMlZy5a2QRsm7Q_Iqb3nj8h";

export class OldAppError extends Error {}

export async function signInOldApp(email: string, password: string): Promise<string> {
  const res = await fetch(`${OLD_APP_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: OLD_APP_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  if (res.status === 400 || res.status === 401) {
    throw new OldAppError("The old app didn't accept that email and password. If he signs in to the old app with Google, use the other way below.");
  }
  if (!res.ok) throw new OldAppError(`The old app answered ${res.status}. Try again in a minute.`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new OldAppError("The old app didn't return a session.");
  return body.access_token;
}

/** Every row of a table, 1000 at a time. */
export async function readOldTable(table: "clients" | "investments" | "sips", token: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${OLD_APP_URL}/rest/v1/${table}?select=*&order=created_at.asc`, {
      headers: { apikey: OLD_APP_KEY, authorization: `Bearer ${token}`, range: `${from}-${from + 999}`, "range-unit": "items" },
    });
    if (!res.ok) throw new OldAppError(`Couldn't read ${table} from the old app (${res.status}).`);
    const page = (await res.json()) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

/** Rows as CSV text (the same shape as the old app's CSV export), for the importer. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

/**
 * For someone who signs in to the old app with Google: pasted into the browser console on the old app's page while
 * signed in, it downloads the three CSV files to upload here. It only reads.
 */
export const CONSOLE_EXPORT = [
  "(async () => {",
  '  const k = Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));',
  '  if (!k) return alert("Sign in to the old app first, then run this again.");',
  "  const token = JSON.parse(localStorage.getItem(k)).access_token;",
  `  const url = "${OLD_APP_URL}", key = "${OLD_APP_KEY}";`,
  '  const cell = (v) => { const s = v == null ? "" : String(v); return /[",\\r\\n]/.test(s) ? \'"\' + s.replace(/"/g, \'""\') + \'"\' : s; };',
  '  for (const t of ["clients", "investments", "sips"]) {',
  "    let rows = [];",
  "    for (let f = 0; ; f += 1000) {",
  '      const r = await fetch(url + "/rest/v1/" + t + "?select=*&order=created_at.asc", { headers: { apikey: key, authorization: "Bearer " + token, range: f + "-" + (f + 999) } });',
  "      const p = await r.json(); rows = rows.concat(p); if (p.length < 1000) break;",
  "    }",
  "    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];",
  '    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\\n");',
  '    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = t + ".csv"; a.click();',
  "    await new Promise((r) => setTimeout(r, 400));",
  "  }",
  '  alert("Downloaded clients.csv, investments.csv and sips.csv. Upload them on the Folio Import page.");',
  "})();",
].join("\n");
