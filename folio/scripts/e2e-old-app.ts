/**
 * Browser test: bringing over the old FundVault app's CSV exports from the Import page (made-up data in
 * test/fixtures/old-app). Needs the local dev server and NAVs loaded.   npx tsx scripts/e2e-old-app.ts
 */
import { chromium, type Page } from "playwright";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { OLD_APP_URL, CONSOLE_EXPORT } from "../src/lib/imports/old-app";

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

  // ── Straight from the old app (its database is stood in for by the test files) ──
  const csvRows = (name: string) => {
    const [head, ...lines] = readFileSync(`${FIX}${name}`, "utf8").trim().split("\n");
    const cols = head!.split(",");
    // The fixture rows have no quoted commas except the address; good enough for a stand-in.
    return lines.map((l) => {
      const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
      return Object.fromEntries(cols.map((c, i) => [c, cells[i] === "" ? null : cells[i]]));
    });
  };
  const TABLES: Record<string, unknown[]> = { clients: csvRows("clients-export.csv"), investments: csvRows("investments-export.csv"), sips: csvRows("sips-export.csv") };
  let tokenSeen = "";
  const fakeOldApp = async (route: import("playwright").Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/token") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (body.password !== "old-app-pass") return route.fulfill({ status: 400, json: { error: "invalid_grant" } });
      return route.fulfill({ json: { access_token: "test-token" } });
    }
    tokenSeen = route.request().headers()["authorization"] ?? "";
    const table = url.pathname.split("/").pop()!;
    return route.fulfill({ json: TABLES[table] ?? [] });
  };
  await p.context().route(`${OLD_APP_URL}/**`, fakeOldApp);
  await sql`delete from transactions where practice_id = (select m.practice_id from memberships m join users u on u.id = m.user_id where u.email = ${EMAIL})`;
  await sql`delete from sips where practice_id = (select m.practice_id from memberships m join users u on u.id = m.user_id where u.email = ${EMAIL})`;
  await sql`delete from investors where practice_id = (select m.practice_id from memberships m join users u on u.id = m.user_id where u.email = ${EMAIL})`;
  await go(p, "/app/import");
  await p.getByRole("tab", { name: "Old FundVault app" }).click();
  await p.getByLabel("Old app email").fill("father@example.com");
  await p.getByLabel("Old app password").fill("wrong");
  await p.getByRole("button", { name: "Get his data" }).click();
  await p.getByText("The old app didn't accept that email and password").waitFor();
  check(true, "a wrong old-app password is refused");
  await p.getByLabel("Old app password").fill("old-app-pass");
  await p.getByRole("button", { name: "Get his data" }).click();
  await p.getByText("3 rows from the old app").first().waitFor();
  check(tokenSeen === "Bearer test-token", "tables are read with his old-app session");
  await p.getByRole("button", { name: "Check (saves nothing)" }).click();
  await p.getByText("The totals match the old app.").waitFor();
  await p.getByRole("button", { name: "Import into Folio" }).click();
  await p.getByText(/^Done\./).waitFor();
  const [{ c }] = (await sql`select count(*)::int as c from investors i join memberships m on m.practice_id = i.practice_id join users u on u.id = m.user_id where u.email = ${EMAIL}`) as unknown as [{ c: number }];
  check(c === 2, "imported straight from the old app");

  // The Google-user fallback script: run on an old-app page with a session, it downloads the three files.
  const oldContext = await b.newContext({ acceptDownloads: true });
  await oldContext.route(`${OLD_APP_URL}/**`, fakeOldApp);
  const old = await oldContext.newPage();
  await old.route("https://old-app.test/", (r) => r.fulfill({ contentType: "text/html", body: "<html><body>old app</body></html>" }));
  await old.goto("https://old-app.test/");
  await old.evaluate(() => localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: "test-token" })));
  old.on("dialog", (d) => void d.accept());
  const downloads: string[] = [];
  old.on("download", (d) => downloads.push(d.suggestedFilename()));
  await old.evaluate(CONSOLE_EXPORT);
  await old.waitForTimeout(1500);
  check(downloads.join(",") === "clients.csv,investments.csv,sips.csv", `the export script downloads the three files (${downloads.join(", ")})`);
  await oldContext.close();

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} finally {
  await b.close();
  await sql.end();
}
