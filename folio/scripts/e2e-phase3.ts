/**
 * Browser test of phase 3: email import (Gmail confirmation, password-protected mailback, retry after saving the
 * password), the SIP book from registrar data (bounced SIP), Home's Today list, and the morning briefing email.
 * Needs the local dev server with INBOUND_DOMAIN and INBOX_TOKEN in .dev.vars, and the `zip` command.
 *   npx tsx scripts/e2e-phase3.ts            (SHOTS=dir to save screenshots)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import postgres from "postgres";

const BASE = process.env["APP_URL"] ?? "http://localhost:3000";
const sql = postgres(process.env["DATABASE_URL"] ?? "postgres://folio_owner:folio_owner@127.0.0.1:5432/folio", { onnotice: () => {} });
const EMAIL = `e2e.p3+${Date.now()}@example.com`;
const PASSWORD = "a-long-test-password";
const ZIP_PASSWORD = "Mailback#2026";
const TOKEN = /^INBOX_TOKEN=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1]?.trim();
if (!TOKEN) throw new Error("Set INBOX_TOKEN in .dev.vars");

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}
const go = (p: Page, path: string) => p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });

const dmy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const monthsAgo = (n: number, day = 5) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  d.setDate(day);
  return d;
};

/** A CAMS-style transaction report: a monthly SIP whose latest instalment bounced, and a big redemption. */
function camsCsv(): string {
  const head = "AMC_CODE,FOLIO_NO,PRODCODE,SCHEME,INV_NAME,TRXNTYPE,TRXNNO,TRXNMODE,TRXNSTAT,TRADDATE,POSTDATE,PURPRICE,UNITS,AMOUNT,BROK_CODE,TRXN_NATUR,PAN";
  const rows: string[] = [];
  let n = 50000;
  for (let i = 6; i >= 1; i--) {
    const d = dmy(monthsAgo(i));
    rows.push(`H,7654321/01,H02G,HDFC Flexi Cap Fund - Growth Plan,ASHA VERMA,SIN,${n++},N,OK,${d},${d},1500.0000,3.333,5000.00,ARN-12345,Systematic Investment,ZZAPV2002B`);
  }
  // The latest instalment came back unpaid a few days later.
  const last = monthsAgo(1);
  const back = new Date(last.getTime() + 4 * 86400000);
  rows.push(`H,7654321/01,H02G,HDFC Flexi Cap Fund - Growth Plan,ASHA VERMA,SIN,${n++},N,OK,${dmy(back)},${dmy(back)},1500.0000,-3.333,-5000.00,ARN-12345,SIP Purchase Reversal - Payment not received,ZZAPV2002B`);
  const red = new Date(Date.now() - 2 * 86400000);
  rows.push(`H,7654321/01,H02G,HDFC Flexi Cap Fund - Growth Plan,ASHA VERMA,R,${n++},N,OK,${dmy(red)},${dmy(red)},1800.0000,100.000,180000.00,ARN-12345,Redemption,ZZAPV2002B`);
  return [head, ...rows].join("\n");
}

function mime(to: string, from: string, subject: string, text: string, zip?: { name: string; bytes: Buffer }): string {
  const b = "E2EBOUNDARY";
  const parts = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${b}"`, "", `--${b}`, "Content-Type: text/plain; charset=utf-8", "", text, ""];
  if (zip) parts.push(`--${b}`, `Content-Type: application/zip; name="${zip.name}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${zip.name}"`, "", zip.bytes.toString("base64").replace(/(.{76})/g, "$1\r\n"), "");
  parts.push(`--${b}--`, "");
  return parts.join("\r\n");
}

async function deliver(to: string, raw: string): Promise<number> {
  const res = await fetch(`${BASE}/__inbox`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "x-folio-to": to }, body: raw });
  return res.status;
}

await sql`delete from rate_limits`;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
const shots = process.env["SHOTS"];
try {
  await go(p, "/signup");
  await p.getByLabel("Your practice or business name").fill("Phase Three Wealth");
  await p.getByLabel("Your name").fill("Nawal Kishore");
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

  // ── Email import settings ──
  await go(p, "/app/settings/mail");
  const address = (await p.locator("code").first().textContent())?.trim() ?? "";
  check(/^mb-[a-z0-9]{12}@in\.folio\.local$/.test(address), `the practice has a private address (${address})`);
  await p.getByText("Waiting for Gmail's code").waitFor();

  check((await deliver("mb-zzzzzzzzzzzz@in.folio.local", "From: x@camsonline.com\r\n\r\nhi")) === 404, "an unknown address is refused");
  check(
    (await deliver(
      address,
      mime(address, "Gmail Team <forwarding-noreply@google.com>", "(#552201983) Gmail Forwarding Confirmation - Receive Mail from father@gmail.com", "father@gmail.com has requested to automatically forward mail to your email address.\nConfirmation code: 552201983\nhttps://mail-settings.google.com/mail/vf-abc"),
    )) === 200,
    "Gmail's confirmation is accepted",
  );
  await p.getByRole("button", { name: "Check again" }).click();
  await p.getByText("552201983").waitFor();
  check(true, "Gmail's code shows on the page");

  const dir = mkdtempSync(join(tmpdir(), "folio-e2e-"));
  writeFileSync(join(dir, "WBR2.csv"), camsCsv());
  execFileSync("zip", ["-q", "-j", "-P", ZIP_PASSWORD, join(dir, "WBR2.zip"), join(dir, "WBR2.csv")]);
  const zip = { name: "WBR2_ARN-12345.zip", bytes: readFileSync(join(dir, "WBR2.zip")) };
  check((await deliver(address, mime(address, "CAMS <donotreply@camsonline.com>", "WBR2 Transaction Report", "Attached.", zip))) === 200, "a CAMS mailback is accepted");
  await go(p, "/app/settings/mail");
  await p.getByText("Needs the ZIP password").waitFor();
  check(true, "without a saved password it waits");
  if (shots) await p.screenshot({ path: `${shots}/p3-mail-waiting.png`, fullPage: true });

  await p.getByLabel("Password").fill(ZIP_PASSWORD);
  await p.getByRole("button", { name: "Save" }).click();
  await p.getByText("1 waiting email imported").waitFor();
  check(true, "saving the password imports the waiting email");
  await p.getByText("Working: emails are arriving and importing").waitFor();
  const detail = await p.getByText(/new transactions/).first().textContent();
  check(detail?.includes("8 new transactions") && detail.includes("1 new clients"), `the import is listed (${detail})`);
  if (shots) await p.screenshot({ path: `${shots}/p3-mail-done.png`, fullPage: true });

  // A second copy of the same email adds nothing.
  await deliver(address, mime(address, "CAMS <donotreply@camsonline.com>", "WBR2 Transaction Report", "Attached.", zip));
  await go(p, "/app/settings/mail");
  check(await p.getByText("Imported · 0 new").isVisible(), "a re-sent report adds nothing twice");

  // ── SIP book ──
  const [practice] = await sql`select m.practice_id from memberships m join users u on u.id = m.user_id where u.email = ${EMAIL}`;
  await sql`update investors set mobile = '98290 12345', dob = (current_date + 2) - interval '50 years' where practice_id = ${practice!["practice_id"]}`;
  await go(p, "/app/sips");
  check(await p.getByText("1 SIP bounced").isVisible(), "the SIP page warns about the bounce");
  await p.getByRole("tab", { name: /Bounced/ }).click();
  const row = await p.locator("li", { hasText: "Asha Verma" }).first().textContent();
  check(row?.includes("Bounced") && row.includes("folio 7654321/01") && row.includes("Auto"), `the bounced SIP is listed (${row?.replace(/\s+/g, " ").slice(0, 140)})`);
  check(await p.getByText("SIP money received").isVisible(), "the monthly SIP money chart shows");
  if (shots) await p.screenshot({ path: `${shots}/p3-sips.png`, fullPage: true });

  // ── Home: Today ──
  await go(p, "/app");
  const today = p.locator("section[aria-label='Today']");
  const text = (await today.textContent()) ?? "";
  check(text.includes("SIP bounced") && text.includes("Redeemed ₹1,80,000") && text.includes("Birthday"), "Today lists the bounce, the redemption and the birthday");
  const wa = await today.getByRole("link", { name: "WhatsApp" }).first().getAttribute("href");
  check(wa?.startsWith("https://wa.me/919829012345?text="), `WhatsApp opens the client's chat with a message (${wa?.slice(0, 60)})`);
  if (shots) await p.screenshot({ path: `${shots}/p3-home.png`, fullPage: true });

  // ── Morning summary setting and email ──
  await go(p, "/app/settings");
  const box = p.getByLabel(/Email it to me/);
  check(await box.isChecked(), "the morning summary email is on by default");
  await box.uncheck();
  await p.waitForTimeout(400);
  await go(p, "/app/settings");
  check(!(await p.getByLabel(/Email it to me/).isChecked()), "turning it off is kept");
  await p.getByLabel(/Email it to me/).check();
  await p.waitForTimeout(400);

  await sql`delete from market_state where key = 'briefing_sent'`;
  const tick = await fetch(`${BASE}/__inbox/tick`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } });
  const tickBody = (await tick.json()) as { briefings: { sent: number } | null };
  check(tick.ok && (tickBody.briefings?.sent ?? 0) >= 1, `the scheduled tick sends the briefings (${JSON.stringify(tickBody.briefings)})`);
  await go(p, "/dev/outbox");
  const outbox = (await p.locator("body").textContent()) ?? "";
  check(outbox.includes("Folio: Book") && outbox.includes("SIP bounced: Asha Verma"), "the briefing email names who to call");

  // Phone width.
  const phone = await b.newContext({ viewport: { width: 375, height: 800 }, storageState: await ctx.storageState() });
  const m = await phone.newPage();
  for (const path of ["/app", "/app/sips", "/app/settings/mail"]) {
    await go(m, path);
    const wide = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!wide, `${path} fits a phone screen`);
    if (shots) await m.screenshot({ path: `${shots}/p3-phone${path.replace(/\//g, "-")}.png`, fullPage: true });
  }
  check(errors.length === 0, `no page errors (${errors.join("; ")})`);
} finally {
  await b.close();
  await sql.end();
}
