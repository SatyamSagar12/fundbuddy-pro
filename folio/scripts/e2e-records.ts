/**
 * Browser test of the everyday screens brought over from the old FundVault app: clients (add, validate, view,
 * edit, delete), investments, SIPs, reports with charts and table view, CSV export, and the installable-app files.
 * Needs the local dev server (./scripts/dev-server.sh).   npx tsx scripts/e2e-records.ts
 */
import { chromium, type Page } from "playwright";
import postgres from "postgres";

const BASE = process.env["APP_URL"] ?? "http://localhost:3000";
const sql = postgres(process.env["DATABASE_URL"] ?? "postgres://folio_owner:folio_owner@127.0.0.1:5432/folio", { onnotice: () => {} });
const EMAIL = `e2e.records+${Date.now()}@example.com`;
const PASSWORD = "a-long-test-password";

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}
const go = (p: Page, path: string) => p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });

await sql`delete from rate_limits`;
const b = await chromium.launch();
const p = await b.newPage({ acceptDownloads: true });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  await go(p, "/signup");
  check((await p.getByText("Continue with Google").count()) === 0, "no Google button while Google isn't set up");
  await p.getByLabel("Your practice or business name").fill("Records Wealth");
  await p.getByLabel("Your name").fill("Rec Advisor");
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

  // ── Sample data ───────────────────────────────────────────────────────────
  await go(p, "/app");
  await p.getByRole("button", { name: "Add sample data" }).click();
  await p.getByText("Sample data is in your account").waitFor();
  check(true, "sample data added from Home");
  await go(p, "/app/clients");
  check((await p.locator("main li").count()) === 8, "8 sample clients listed");
  await go(p, "/app/reports");
  await p.waitForTimeout(800);
  check((await p.locator(".recharts-bar-rectangle").count()) > 5, "reports have sample data to show");
  // A real client added alongside must survive "Remove sample data".
  await sql`insert into investors (practice_id, name) select m.practice_id, 'Real Client' from memberships m join users u on u.id = m.user_id where u.email = ${EMAIL}`;
  p.once("dialog", (d) => void d.accept());
  await go(p, "/app");
  await p.getByRole("button", { name: "Remove sample data" }).click();
  await p.getByText("Sample data is in your account").waitFor({ state: "detached" });
  await go(p, "/app/clients");
  const left = await p.locator("main li").allTextContents();
  check(left.length === 1 && left[0]!.includes("Real Client"), "Remove sample data removed only the sample clients");
  const [n] = await sql`select count(*)::int as n from transactions t join investors i on i.id = t.investor_id where i.name = 'Real Client'`;
  await sql`delete from investors where name = 'Real Client' and practice_id = (select m.practice_id from memberships m join users u on u.id = m.user_id where u.email = ${EMAIL})`;
  check(n!["n"] === 0, "no sample transactions left behind");

  // ── Clients ───────────────────────────────────────────────────────────────
  await go(p, "/app/clients");
  await p.getByRole("link", { name: "Add client" }).click();
  await p.waitForURL("**/app/clients/new");
  await p.getByLabel("Full name").fill("Ramesh Kumar");
  await p.getByLabel("Mobile", { exact: true }).fill("9812300001");
  await p.getByLabel("PAN", { exact: true }).fill("BAD");
  await p.getByRole("button", { name: "Save client" }).click();
  await p.getByText("PAN must look like ABCDE1234F.").waitFor();
  check(true, "invalid PAN is refused with a clear message");
  await p.getByLabel("PAN", { exact: true }).fill("abcpk1234q");
  await p.getByLabel("Email", { exact: true }).fill("ramesh@example.com");
  await p.getByLabel("Date of birth", { exact: true }).fill("1958-07-15");
  await p.getByLabel("Address").fill("House 4, Shanti Nagar, Patna");
  await p.getByLabel("Account number").fill("123456789012");
  await p.getByLabel("Bank name").fill("State Bank of India");
  await p.getByLabel("IFSC").fill("SBIN0001234");
  await p.getByLabel("MICR").fill("800002001");
  await p.getByLabel("Nominee name").fill("Sita Devi");
  await p.getByLabel("Relation").selectOption("Spouse");
  await p.getByRole("button", { name: "Save client" }).click();
  await p.getByRole("heading", { name: "Ramesh Kumar" }).waitFor();
  check(await p.getByText("ABCPK1234Q").isVisible(), "client saved; detail page shows the full PAN to the team");
  check(await p.getByText("SBIN0001234").isVisible(), "bank details saved and shown");
  check(await p.getByText("Sita Devi · Spouse").isVisible(), "nominee saved and shown");
  const [row] = await sql`select tax_id_enc, bank_enc, tax_id_last4 from investors where name = 'Ramesh Kumar' order by created_at desc limit 1`;
  check(!String(row!["tax_id_enc"]).includes("ABCPK") && !String(row!["bank_enc"]).includes("SBIN") && row!["tax_id_last4"] === "234Q", "PAN and bank are stored encrypted in the database");

  await p.getByRole("link", { name: "Edit" }).click();
  await p.getByLabel("Mobile", { exact: true }).fill("9812300009");
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.getByRole("heading", { name: "Ramesh Kumar" }).waitFor();
  await p.getByText("9812300009").first().waitFor();
  check(true, "client edited");

  await go(p, "/app/clients");
  check(await p.getByText("XXXXXX234Q").isVisible(), "client list shows the PAN masked");

  // ── SIPs and investments ──────────────────────────────────────────────────
  await go(p, "/app/sips");
  await p.getByRole("button", { name: "Add SIP" }).click();
  await p.getByLabel("Client", { exact: true }).first().selectOption({ label: "Ramesh Kumar" });
  await p.getByLabel("Scheme", { exact: true }).fill("ICICI Bluechip Fund");
  await p.getByLabel("SIP amount (₹)").fill("5000");
  await p.getByRole("button", { name: "Save" }).click();
  await p.getByText("SIP added.").waitFor();
  await p.getByText("1 active · ₹5,000 a month").waitFor();
  check(true, "SIP added; monthly commitment shown");

  await go(p, "/app/investments");
  for (const [scheme, type, amount, date] of [
    ["HDFC Flexi Cap Fund", "purchase", "150000", "2026-09-15"],
    ["ICICI Bluechip Fund", "sip", "5000", "2026-10-05"],
  ] as const) {
    await p.getByRole("button", { name: "Add investment" }).click();
    await p.getByLabel("Client", { exact: true }).first().selectOption({ label: "Ramesh Kumar" });
    await p.getByLabel("Scheme", { exact: true }).fill(scheme);
    await p.getByLabel("Type").selectOption(type);
    await p.getByLabel("Amount (₹)").fill(amount);
    await p.getByLabel("Date").fill(date);
    await p.getByRole("button", { name: "Save" }).click();
    await p.getByText("Investment added.").waitFor();
  }
  await p.getByText("2 entries · ₹1,55,000 net").waitFor();
  check(true, "two investments added; total shown in Indian format");

  const download = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export CSV" }).click();
  const csv = await (await download).path().then((f) => import("node:fs").then((fs) => fs.readFileSync(f!, "utf8")));
  check(csv.includes("HDFC Flexi Cap Fund") && csv.includes("150000"), "investments export to CSV");

  // ── Client page shows both ────────────────────────────────────────────────
  await go(p, "/app/clients");
  await p.getByRole("link", { name: "Ramesh Kumar" }).click();
  await p.getByText("HDFC Flexi Cap Fund", { exact: true }).waitFor();
  check(await p.getByText("₹1,55,000").first().isVisible(), "client page lists the client's investments and totals");

  // ── Reports ───────────────────────────────────────────────────────────────
  await go(p, "/app/reports");
  await p.getByText("Monthly investment flow").waitFor();
  await p.waitForTimeout(800);
  check((await p.locator(".recharts-bar-rectangle").count()) > 0, "report charts draw");
  check(await p.getByText("Monthly SIP commitment").isVisible(), "report totals shown");
  await p.getByRole("tab", { name: "Table view" }).click();
  await p.getByRole("cell", { name: "Oct 26" }).waitFor();
  check(true, "table view shows every month");
  const dl2 = p.waitForEvent("download");
  await p.getByRole("button", { name: "Yearly CSV" }).click();
  check((await dl2).suggestedFilename() === "all-clients-yearly-report.csv", "yearly report exports to CSV");

  // ── Delete ────────────────────────────────────────────────────────────────
  p.on("dialog", (d) => void d.accept());
  await go(p, "/app/investments");
  await p.getByRole("button", { name: "Delete HDFC Flexi Cap Fund" }).click();
  await p.getByText("Deleted.").waitFor();
  await p.getByText("1 entry · ₹5,000 net").waitFor();
  check(true, "investment deleted");
  await go(p, "/app/clients");
  await p.getByRole("link", { name: "Ramesh Kumar" }).click();
  await p.getByRole("button", { name: "Delete" }).click();
  await p.waitForURL((u) => u.pathname === "/app/clients");
  await p.getByText("No clients yet").waitFor();
  check(true, "client deleted with their records");

  // ── Installable app ───────────────────────────────────────────────────────
  const manifest = await (await p.request.get(`${BASE}/manifest.webmanifest`)).json();
  check(manifest.name === "Anqulas Folio" && (await p.request.get(`${BASE}/icons/icon-512.png`)).ok() && (await p.request.get(`${BASE}/sw.js`)).ok(), "app manifest, icon and service worker are served");

  check(errors.length === 0, `no browser errors${errors.length ? ": " + errors.join("; ") : ""}`);
  console.log("\nAll checks passed.");
} finally {
  await b.close();
  await sql.end();
}
