/**
 * Browser test of phase 2: scheme picker, matching typed names, units from NAVs, holdings and value.
 * Needs the local dev server and NAVs loaded locally:
 *   npx tsx scripts/nav-import.ts --file <NAVAll file> --synthetic-history     (see the script)
 *   npx tsx scripts/e2e-nav.ts
 */
import { chromium, type Page } from "playwright";
import postgres from "postgres";

const BASE = process.env["APP_URL"] ?? "http://localhost:3000";
const sql = postgres(process.env["DATABASE_URL"] ?? "postgres://folio_owner:folio_owner@127.0.0.1:5432/folio", { onnotice: () => {} });
const EMAIL = `e2e.nav+${Date.now()}@example.com`;
const PASSWORD = "a-long-test-password";

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}
const go = (p: Page, path: string) => p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });

const [loaded] = await sql`select count(*)::int as n from instruments where latest_nav is not null`;
if (!loaded!["n"]) throw new Error("No NAVs in the local database: run scripts/nav-import.ts first.");

await sql`delete from rate_limits`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
const shots = process.env["SHOTS"];
try {
  await go(p, "/signup");
  await p.getByLabel("Your practice or business name").fill("NAV Wealth");
  await p.getByLabel("Your name").fill("Nav Advisor");
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

  // Sample data: exact scheme names are linked at once and get units.
  await p.getByRole("button", { name: "Add sample data" }).click();
  await p.getByText("Sample data is in your account").waitFor();
  await go(p, "/app");
  const value = await p.locator("text=Current value").locator("..").textContent();
  check(value && /₹[\d,]+/.test(value), `Home shows a current value (${value?.replace(/\s+/g, " ")})`);
  check(await p.getByRole("link", { name: "Match schemes" }).isVisible(), "Home points to the schemes still to match");
  if (shots) await p.screenshot({ path: `${shots}/home.png`, fullPage: true });

  await go(p, "/app/clients");
  check((await p.locator("main li").filter({ hasText: "Ramesh Kumar" }).textContent())?.includes("₹"), "Clients list shows each client's value");
  await p.getByRole("link", { name: "Ramesh Kumar" }).click();
  await p.getByRole("heading", { name: "Holdings" }).waitFor();
  const rows = await p.locator("table tbody tr").allTextContents();
  check(rows.some((r) => r.includes("HDFC Flexi Cap Fund - Growth Plan") && r.includes("XIRR")), "client page values the HDFC holding with XIRR");
  check(rows.some((r) => r.includes("units estimated from NAV")), "estimated units are labelled");
  if (shots) await p.screenshot({ path: `${shots}/client.png`, fullPage: true });

  // Match schemes: rename-style names need a person; exact ones are offered in one click.
  await go(p, "/app/schemes");
  const before = await p.locator("main h2").count();
  check(before > 0, `${before} scheme names left to match`);
  const card = p.locator("main .rounded-2xl").filter({ has: p.getByRole("heading", { name: "ICICI Prudential Bluechip Fund" }) });
  check((await card.textContent())?.includes("ICICI Prudential Large Cap Fund"), "renamed scheme suggested by its new name");
  await card.getByRole("button", { name: "Use this" }).first().click();
  await p.getByText(/Matched 1 scheme/).waitFor();
  await p.getByRole("heading", { name: "ICICI Prudential Bluechip Fund" }).waitFor({ state: "detached" });
  check((await p.locator("main h2").count()) === before - 1, "matched scheme leaves the list");
  // Search for one by other words.
  const kotak = p.locator("main .rounded-2xl").filter({ has: p.getByRole("heading", { name: "Kotak Emerging Equity Fund" }) });
  await kotak.getByPlaceholder("Search other schemes…").fill("kotak midcap");
  await kotak.getByText("Kotak Midcap Fund - Regular Plan - Growth").waitFor();
  await kotak.getByRole("button", { name: "Use this" }).first().click();
  await p.getByRole("heading", { name: "Kotak Emerging Equity Fund" }).waitFor({ state: "detached" });
  check(true, "a scheme found by search can be matched");
  if (shots) await p.screenshot({ path: `${shots}/match.png`, fullPage: true });

  const [units] = await sql`select count(*)::int as n from transactions t join investors i on i.id = t.investor_id
    join memberships m on m.practice_id = t.practice_id join users u on u.id = m.user_id
    where u.email = ${EMAIL} and t.scheme_text = 'ICICI Prudential Bluechip Fund' and t.units is not null`;
  check(units!["n"] > 0, "matched entries got units straight away");

  // Scheme picker on a new investment.
  await go(p, "/app/investments?add=true");
  await p.getByLabel("Client").first().selectOption({ label: "Priya Menon" });
  await p.getByLabel("Scheme", { exact: true }).fill("parag flexi");
  await p.getByRole("option", { name: /Parag Parikh Flexi Cap Fund - Regular Plan - Growth/ }).click();
  check(await p.getByText("Linked to the AMFI scheme").isVisible(), "picking a scheme links it");
  await p.getByLabel("Amount (₹)").fill("25000");
  await p.getByLabel("Date").fill("2026-06-10");
  await p.getByRole("button", { name: "Save" }).click();
  await p.getByText("Investment added.").waitFor();
  const entry = p.locator("main li").filter({ hasText: "Parag Parikh Flexi Cap Fund - Regular Plan - Growth" }).first();
  check((await entry.textContent())?.match(/≈ [\d,.]+ units at ₹/), "new investment shows its units and NAV");
  if (shots) await p.screenshot({ path: `${shots}/investments.png`, fullPage: true });

  // Phone width: holdings table scrolls inside its card, page doesn't.
  await p.setViewportSize({ width: 390, height: 844 });
  await go(p, "/app/clients");
  await p.getByRole("link", { name: "Priya Menon" }).click();
  await p.getByRole("heading", { name: "Holdings" }).waitFor();
  const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!wide, "no sideways page scroll on a phone");
  if (shots) await p.screenshot({ path: `${shots}/client-phone.png`, fullPage: true });

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} finally {
  await b.close();
  await sql.end();
}
