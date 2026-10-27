/**
 * Browser test of registrar and CAS imports with the made-up files in test/fixtures/imports.
 * Needs the local dev server and NAVs loaded (see scripts/e2e-nav.ts).   npx tsx scripts/e2e-import.ts
 */
import { chromium, type Page } from "playwright";
import postgres from "postgres";

const BASE = process.env["APP_URL"] ?? "http://localhost:3000";
const sql = postgres(process.env["DATABASE_URL"] ?? "postgres://folio_owner:folio_owner@127.0.0.1:5432/folio", { onnotice: () => {} });
const EMAIL = `e2e.import+${Date.now()}@example.com`;
const PASSWORD = "a-long-test-password";
const FIX = new URL("../test/fixtures/imports/", import.meta.url).pathname;
const shots = process.env["SHOTS"];

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}
const go = (p: Page, path: string) => p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });

await sql`delete from rate_limits`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  await go(p, "/signup");
  await p.getByLabel("Your practice or business name").fill("Import Wealth");
  await p.getByLabel("Your name").fill("Imp Advisor");
  await p.getByLabel("Work email").fill(EMAIL);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Create account" }).click();
  await p.getByRole("heading", { name: "Check your email" }).waitFor();
  await sql`update users set email_verified_at = now() where email = ${EMAIL}`;
  await sql`update practices set arn = 'ARN-12345' where id = (select m.practice_id from memberships m join users u on u.id = m.user_id where u.email = ${EMAIL})`;
  await go(p, "/login");
  await p.getByLabel("Email").fill(EMAIL);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL((u) => u.pathname === "/app");

  // ── CAMS report in a password ZIP ─────────────────────────────────────────
  await go(p, "/app/import");
  await p.locator('input[type="file"]').setInputFiles(`${FIX}cams-feed-aes256.zip`);
  await p.getByRole("button", { name: "Read the file" }).click();
  await p.getByText("This ZIP is password-protected").waitFor();
  check(true, "a protected ZIP asks for its password");
  await p.getByLabel(/ZIP password/).fill("nope");
  await p.getByRole("button", { name: "Read the file" }).click();
  await p.getByText("That password didn't open the ZIP").waitFor();
  check(true, "a wrong ZIP password is refused");
  await p.getByLabel(/ZIP password/).fill("folio123");
  await p.getByRole("button", { name: "Read the file" }).click();
  await p.getByText("5 transactions read").waitFor();
  check(await p.getByText("2 rows left out").isVisible(), "tax and rejected rows are left out, and listed");
  await p.getByRole("button", { name: "Check against your clients" }).click();
  await p.getByRole("button", { name: "Import 5 transactions" }).waitFor();
  check((await p.getByText("New client", { exact: true }).count()) === 2, "both clients are new to this practice");
  if (shots) await p.screenshot({ path: `${shots}/import-preview.png`, fullPage: true });
  await p.getByRole("button", { name: "Import 5 transactions" }).click();
  await p.getByText("Imported 5 transactions").waitFor();
  check(true, "CAMS report imported");

  await p.locator('input[type="file"]').setInputFiles(`${FIX}cams-feed-aes256.zip`);
  await p.getByRole("button", { name: "Read the file" }).click();
  await p.getByRole("button", { name: "Check against your clients" }).click();
  await p.getByRole("button", { name: "Nothing new to import" }).waitFor();
  check(true, "the same file again adds nothing");

  // ── KFintech report (Excel) for the same client, matched by PAN ───────────
  await p.locator('input[type="file"]').setInputFiles(`${FIX}kfin-feed.xlsx`);
  await p.getByRole("button", { name: "Read the file" }).click();
  await p.getByText("3 transactions read").waitFor();
  await p.getByRole("button", { name: "Check against your clients" }).click();
  await p.getByRole("button", { name: "Import 3 transactions" }).waitFor();
  check((await p.getByText("New client", { exact: true }).count()) === 0, "KFintech rows go to the existing client by PAN");
  await p.getByRole("button", { name: "Import 3 transactions" }).click();
  await p.getByText("Imported 3 transactions").waitFor();

  // ── CAS statement (password PDF) ──────────────────────────────────────────
  await p.getByRole("tab", { name: /Client CAS/ }).click();
  await p.locator('input[type="file"]').setInputFiles(`${FIX}cas-sample.pdf`);
  await p.getByLabel(/Statement password/).fill("WRONG00000");
  await p.getByRole("button", { name: "Read the statement" }).click();
  await p.getByText("That password didn't open the statement").waitFor();
  check(true, "a wrong statement password is refused");
  await p.getByLabel(/Statement password/).fill("ZZRPK1001A");
  await p.getByRole("button", { name: "Read the statement" }).click();
  await p.getByText("5 transactions read").waitFor();
  check((await p.getByText("· adds up").count()) === 2, "both schemes in the statement add up");
  await p.getByRole("button", { name: "Check against your clients" }).click();
  await p.getByText("Already in").waitFor();
  const figures = await p.locator("dl").first().textContent();
  check(figures?.includes("To add2") && figures.includes("Already in3"), `the CAS adds only what the CAMS report lacked (${figures})`);
  check(await p.getByText(/held through another distributor/).isVisible(), "the folio through another ARN is flagged");
  if (shots) await p.screenshot({ path: `${shots}/import-cas.png`, fullPage: true });
  await p.getByRole("button", { name: "Import 2 transactions" }).click();
  await p.getByText("Imported 2 transactions").waitFor();

  // ── The result ────────────────────────────────────────────────────────────
  await go(p, "/app/clients");
  await p.getByRole("link", { name: /Ramesh Kumar/ }).click();
  await p.getByRole("heading", { name: "Holdings" }).waitFor();
  const rows = await p.locator("table tbody tr").allTextContents();
  check(rows.some((r) => r.includes("HDFC Flexi Cap Fund - Growth Plan") && r.includes("7.950")), "holding shows the registrar's exact units (10 + 1.95 − 2 − 2 reversed)");
  check(!rows.some((r) => r.includes("HDFC") && r.includes("estimated")), "registrar units are not marked as estimates");
  check(rows.some((r) => r.includes("Parag Parikh")), "the CAS-only folio is there too");
  if (shots) await p.screenshot({ path: `${shots}/import-client.png`, fullPage: true });

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} finally {
  await b.close();
  await sql.end();
}
