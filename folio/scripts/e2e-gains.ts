/**
 * Browser test of the capital gains report: one client and one family, a grandfathered equity sale (31 Jan 2018 NAV
 * fetched from mfapi.in), a debt sale at slab, a short-term sale, the CSV, the year switch and a phone in dark mode.
 * Needs the dev server, NAVs loaded locally (npx tsx scripts/nav-import.ts) and internet for mfapi.in.
 *   npx tsx scripts/e2e-gains.ts
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { check, cleanUp, go, phoneDarkCheck, signUpAndIn, sql } from "./e2e-helpers";

const RUN = Date.now();
const OWNER = `e2e.gains+${RUN}@example.com`;
const shots = process.env["SHOTS"];

async function scheme(where: string): Promise<string> {
  const [row] = await sql.unsafe(`select id from instruments where ${where} and latest_nav is not null order by amfi_code limit 1`);
  if (!row) throw new Error(`No scheme for ${where}: run scripts/nav-import.ts first.`);
  return row["id"] as string;
}

await cleanUp("e2e.gains");
const hdfc = await scheme(`amfi_code = '101762'`); // HDFC Flexi Cap Fund - Regular Plan - Growth Option
const liquid = await scheme(`category = 'Debt Scheme - Liquid Fund' and name ilike '%regular%growth%'`);
const midcap = await scheme(`category = 'Equity Scheme - Mid Cap Fund' and name ilike '%regular%growth%'`);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  const P = await signUpAndIn(p, OWNER, "Gains Wealth");
  const [fam] = await sql`insert into families (practice_id, name) values (${P}, 'Rao family') returning id`;
  const [asha] = await sql`insert into investors (practice_id, name, family_id) values (${P}, 'Asha Rao', ${fam!["id"]}) returning id`;
  const [ravi] = await sql`insert into investors (practice_id, name, family_id) values (${P}, 'Ravi Rao', ${fam!["id"]}) returning id`;
  await sql`update families set head_investor_id = ${asha!["id"]} where id = ${fam!["id"]}`;
  const [folio] = await sql`insert into folios (practice_id, investor_id, amc, folio_no) values (${P}, ${asha!["id"]}, 'HDFC', '1234567/89') returning id`;
  const t = (investor: string, instrument: string, date: string, type: string, amount: number, units: number, folioId: string | null = null) =>
    sql`insert into transactions (practice_id, investor_id, folio_id, instrument_id, type, trade_date, amount, units, source)
        values (${P}, ${investor}, ${folioId}, ${instrument}, ${type}, ${date}, ${amount}, ${units}, 'manual')`;
  // Asha: equity bought in 2017 (grandfathered), part sold in FY 2025-26; a debt fund bought after Apr 2023, sold.
  await t(asha!["id"], hdfc, "2017-06-01", "purchase", 40000, 100, folio!["id"]);
  await t(asha!["id"], hdfc, "2025-06-10", "redemption", 114000, 60, folio!["id"]);
  await t(asha!["id"], liquid, "2023-05-02", "purchase", 100000, 40, null);
  await t(asha!["id"], liquid, "2025-08-01", "redemption", 115000, 40, null);
  // Ravi: a short-term equity sale.
  await t(ravi!["id"], midcap, "2025-01-10", "purchase", 50000, 500, null);
  await t(ravi!["id"], midcap, "2025-09-01", "redemption", 60000, 500, null);

  await go(p, `/app/clients/${asha!["id"]}`);
  await p.getByRole("link", { name: "Capital gains" }).click();
  await p.waitForURL((u) => u.pathname === "/app/capital-gains");
  await p.getByRole("heading", { name: "How it's taxed" }).waitFor();
  const header = (await p.locator("main header").first().textContent()) ?? "";
  check(header.includes("FY 2025-26"), `the report opens on the latest year with sales (${header.replace(/\s+/g, " ").slice(0, 80)})`);
  const rows = await p.locator("table").last().locator("tbody tr").allTextContents();
  check(rows.length === 2, `two sales listed for Asha (${rows.length})`);
  const equity = rows.find((r) => r.includes("HDFC Flexi Cap")) ?? "";
  check(equity.includes("31 Jan 2018 value") && equity.includes("Long · 12.5%"), `the 2017 units are grandfathered and long-term at 12.5% (${equity})`);
  check(equity.includes("Folio 1234567/89"), "the folio number is shown");
  const [nav] = await sql`select nav::float as nav, date::text from nav_prices where instrument_id = ${hdfc} and date <= '2018-01-31' order by date desc limit 1`;
  check(nav && nav["date"] >= "2018-01-24", `the 31 Jan 2018 NAV was fetched from mfapi.in (₹${nav?.["nav"]} on ${nav?.["date"]})`);
  const costUsed = Math.max(24000, Math.min(60 * Number(nav!["nav"]), 114000));
  check(equity.replace(/,/g, "").includes(`₹${Math.round(costUsed)}`), `cost used is the higher of cost and the 31 Jan 2018 value (₹${Math.round(costUsed)})`);
  const debt = rows.find((r) => !r.includes("HDFC")) ?? "";
  check(debt.includes("Short · Slab") && debt.includes("Debt fund"), `a debt fund bought after 1 Apr 2023 is taxed at slab (${debt})`);
  const kinds = await p.locator("table").first().locator("tbody tr").allTextContents();
  check(kinds.some((k) => k.startsWith("Equity, long-term: 12.5%")) && kinds.some((k) => k.startsWith("Non-equity: added to income")), `the summary splits the kinds (${kinds.join(" | ")})`);
  if (shots) await p.screenshot({ path: `${shots}/gains-client.png`, fullPage: true });

  // CSV
  const [download] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download CSV" }).click()]);
  const text = readFileSync((await download.path())!, "utf8");
  const lines = text.trim().split(/\r?\n/);
  check(lines[0]!.includes('"Sale value"') && lines[0]!.includes('"Grandfathered"') && lines.length === 3, `the CSV has a header and one row per sale (${lines.length - 1})`);
  check(download.suggestedFilename() === "capital-gains-asha-rao-FY2025-26.csv", `the CSV is named for the client and year (${download.suggestedFilename()})`);

  // Another year: nothing sold then.
  await p.getByLabel("Financial year").selectOption({ label: "FY 2026-27" });
  await p.getByRole("heading", { name: "No sales in FY 2026-27" }).waitFor();
  check(true, "switching to a year without sales shows an empty state");

  // The family: both members, each with their own figures.
  await go(p, `/app/families/${fam!["id"]}`);
  await p.getByRole("link", { name: "Capital gains" }).click();
  await p.getByRole("heading", { name: "By member" }).waitFor();
  const members = await p.locator("main li").allTextContents();
  check(members.length === 2 && members.some((m) => m.startsWith("Ravi Rao")), `the family report lists each member (${members.length})`);
  const familyRows = await p.locator("table").last().locator("tbody tr").allTextContents();
  check(familyRows.length === 3 && familyRows.some((r) => r.includes("Ravi Rao") && r.includes("Short · 20%")), "the family report has every member's sales, Ravi's short-term at 20%");
  const familyKinds = await p.locator("table").first().locator("tbody tr").allTextContents();
  check(familyKinds[0]!.startsWith("Equity, short-term") && familyKinds.at(-1)!.startsWith("Non-equity"), `the family summary keeps equity first and slab last (${familyKinds.join(" | ")})`);
  if (shots) await p.screenshot({ path: `${shots}/gains-family.png`, fullPage: true });

  await phoneDarkCheck(b, await ctx.storageState(), `/app/capital-gains?family=${fam!["id"]}`, shots);

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  console.log("\nCapital gains: all checks passed.");
} finally {
  await b.close();
  await cleanUp("e2e.gains");
  await sql.end();
}
