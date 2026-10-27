/**
 * Browser test: bringing over the old FundVault app's CSV exports from the Import page (made-up data in
 * test/fixtures/old-app). Needs the local dev server and NAVs loaded.   npx tsx scripts/e2e-old-app.ts
 */
import { chromium, type Page } from "playwright";
import postgres from "postgres";

const BASE = process.env["APP_URL"] ?? "http://localhost:3000";
const sql = postgres(process.env["DATABASE_URL"] ?? "postgres://folio_owner:folio_owner@127.0.0.1:5432/folio", { onnotice: () => {} });
const EMAIL = `e2e.oldapp+${Date.now()}@example.com`;
const PASSWORD = "a-long-test-password";
const FIX = new URL("../test/fixtures/old-app/", import.meta.url).pathname;
const shots = process.env["SHOTS"];

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}
const go = (p: Page, path: string) => p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
const FILES = ["clients-export.csv", "investments-export.csv", "sips-export.csv"].map((f) => `${FIX}${f}`);

await sql`delete from rate_limits`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  await go(p, "/signup");
  await p.getByLabel("Your practice or business name").fill("Old App Wealth");
  await p.getByLabel("Your name").fill("Old Advisor");
  await p.getByLabel("Work email").fill(EMAIL);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Create account" }).click();
  await p.getByRole("heading", { name: "Check your email" }).waitFor();
  await sql`update users set email_verified_at = now() where email = ${EMAIL}`;
  await go(p, "/login");
  await p.getByLabel("Email").fill(EMAIL);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL((u) => u.pathname === "/app");

  await go(p, "/app/import");
  await p.getByRole("tab", { name: "Old FundVault app" }).click();
  await p.locator('input[type="file"]').setInputFiles(FILES);
  await p.getByText("clients-export.csv").waitFor();
  check(await p.getByText("sips-export.csv").isVisible(), "the three exports are recognised by their columns");

  await p.getByRole("button", { name: "Check (saves nothing)" }).click();
  await p.getByText("2 clients, 3 investments, 2 SIPs").waitFor();
  check(await p.getByText("The totals match the old app.").isVisible(), "dry run: totals match the old app");
  check(await p.getByText(/built-in sample clients? (is|are) left out/).isVisible(), "the old app's sample client is left out");
  const [{ n }] = (await sql`select count(*)::int as n from investors i join memberships m on m.practice_id = i.practice_id join users u on u.id = m.user_id where u.email = ${EMAIL}`) as unknown as [{ n: number }];
  check(n === 0, "the check saved nothing");
  if (shots) await p.screenshot({ path: `${shots}/old-app-check.png`, fullPage: true });

  await p.getByRole("button", { name: "Import into Folio" }).click();
  await p.getByText(/^Done\./).waitFor();
  check(true, "imported");

  await go(p, "/app/clients");
  const names = await p.locator("main li").allTextContents();
  check(names.length === 2 && names.some((t) => t.includes("Kamla Devi")) && names.some((t) => t.includes("Suresh Prasad")), "both clients are in Folio");
  await p.getByRole("link", { name: /Kamla Devi/ }).click();
  await p.getByRole("heading", { name: "Holdings" }).waitFor();
  const rows = await p.locator("table tbody tr").allTextContents();
  check(rows.some((r) => r.includes("HDFC Flexi Cap Fund - Growth Plan")), "an exactly-named scheme was linked to AMFI and valued");
  check(await p.getByText("ZZKPD2001K").isVisible(), "PAN came over (shown decrypted on the client page)");

  // Running it again adds nothing.
  await go(p, "/app/import");
  await p.getByRole("tab", { name: "Old FundVault app" }).click();
  await p.locator('input[type="file"]').setInputFiles(FILES);
  await p.getByRole("button", { name: "Check (saves nothing)" }).click();
  await p.getByText("The totals match the old app.").waitFor();
  await p.getByRole("button", { name: "Import into Folio" }).click();
  await p.getByText(/^Done\./).waitFor();
  const [{ t }] = (await sql`select count(*)::int as t from transactions x join memberships m on m.practice_id = x.practice_id join users u on u.id = m.user_id where u.email = ${EMAIL}`) as unknown as [{ t: number }];
  check(t === 3, `importing twice doesn't double anything (${t} investments)`);

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} finally {
  await b.close();
  await sql.end();
}
