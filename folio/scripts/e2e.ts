/**
 * Browser test of phase 1 against the local dev server (./scripts/dev-server.sh), with the local database.
 * .dev.vars must have PLATFORM_ADMIN_EMAILS=e2e.platform@example.com and a UPI_ID.
 *
 *   npx tsx scripts/e2e.ts
 *
 * Covers: sign-up, email confirmation, password-only sign-in, turning the optional authenticator on, recovery
 * codes, the owner requiring an authenticator for everyone, password reset, lost phone,
 * inviting a sub-broker who sees only their assigned clients, switching a member off, paying by UPI and the
 * platform admin confirming it, the lock after a lapsed plan, and basic protections.
 */
import { chromium, type Browser, type Page } from "playwright";
import postgres from "postgres";
import { currentStep, totpCode } from "../src/server/totp";

const BASE = process.env["APP_URL"] ?? "http://localhost:3000";
const DB = process.env["DATABASE_URL"] ?? "postgres://folio_owner:folio_owner@127.0.0.1:5432/folio";
const PASSWORD = "a-long-test-password";
const ADMIN = "e2e.platform@example.com";
const run = Date.now();
const OWNER = `e2e.owner+${run}@example.com`;
const SUB = `e2e.sub+${run}@example.com`;

const sql = postgres(DB, { onnotice: () => {} });

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

/** Codes are one-time per 30-second step, so each sign-in waits for an unused step. */
const usedSteps = new Map<string, number>();
async function freshCode(secret: string): Promise<string> {
  const clean = secret.replace(/\s/g, "");
  let step = currentStep();
  const last = usedSteps.get(clean) ?? -1;
  if (step <= last) step = last + 1; // one step ahead is accepted
  if (step > currentStep() + 1) {
    await new Promise((r) => setTimeout(r, 30_000));
    step = currentStep();
  }
  usedSteps.set(clean, step);
  return totpCode(clean, step);
}

async function waitForPath(page: Page, path: string) {
  try {
    await page.waitForURL((u) => u.pathname.replace(/\/$/, "") === path, { timeout: 15000 });
  } catch (e) {
    console.log(`Expected ${path}, at ${page.url()}:`, (await page.textContent("body"))?.slice(0, 300));
    throw e;
  }
}

async function go(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
}

/** The newest dev-outbox mail to `to`, and the first link in it containing `contains`. */
async function mailLink(page: Page, to: string, contains: string): Promise<string> {
  await go(page, "/dev/outbox");
  const articles = page.locator("article", { hasText: `to ${to}` });
  const body = (await articles.first().getByTestId("mail-body").textContent()) ?? "";
  const link = body.match(new RegExp(`http\\S+${contains}\\S*`))?.[0];
  if (!link) throw new Error(`No ${contains} link in mail to ${to}: ${body}`);
  return link;
}

/** Signs in; with a secret, also enters the authenticator code. */
async function signIn(page: Page, email: string, password: string, secret?: string) {
  await go(page, "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (!secret) return;
  await waitForPath(page, "/two-factor");
  await page.getByLabel("6-digit code").fill(await freshCode(secret));
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Turns the optional authenticator on from Settings → Security. */
async function turnOnAuthenticator(page: Page) {
  await go(page, "/app/settings/security");
  await page.getByRole("link", { name: "Turn on" }).click();
  return setUpAuthenticator(page);
}

/** Sets up the authenticator on the setup page; returns the secret and the recovery codes. */
async function setUpAuthenticator(page: Page) {
  await waitForPath(page, "/two-factor/setup");
  const secret = (await page.getByTestId("totp-secret").textContent())!;
  await page.getByLabel("6-digit code").fill(await freshCode(secret));
  await page.getByRole("button", { name: "Turn on and continue" }).click();
  await page.getByTestId("recovery-codes").waitFor();
  const codes = (await page.getByTestId("recovery-codes").locator("li").allTextContents()).map((c) => c.trim());
  await page.getByRole("button", { name: /I've saved them/ }).click();
  await waitForPath(page, "/app");
  return { secret, codes };
}

async function signUp(browser: Browser, email: string, practice: string) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await go(page, "/signup");
  await page.getByLabel("Your practice or business name").fill(practice);
  await page.getByLabel("Your name").fill("Test Advisor");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  // The platform admin's first sign-up is approved at once (bootstrap); everyone else confirms by email.
  const outcome = await Promise.race([
    page.getByRole("heading", { name: "Check your email" }).waitFor().then(() => "email" as const),
    page.getByText("You're the platform admin").waitFor().then(() => "approved" as const),
  ]);
  if (email === ADMIN) check(outcome === "approved", "the first platform admin sign-up is approved at once");
  if (outcome === "email") {
    await page.goto(await mailLink(page, email, "verify-email"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Confirm my email" }).click();
    await page.getByRole("heading", { name: "Email confirmed" }).waitFor();
  }
  await go(page, "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The authenticator is optional: a new account goes straight to Home.
  await waitForPath(page, "/app");
  await page.getByText("Recommended:").waitFor();
  const auth = await turnOnAuthenticator(page);
  return { page, ...auth };
}

const errors: string[] = [];
// Clean slate: earlier e2e accounts and practices, and rate-limit counters.
await sql`delete from practices where id in (select m.practice_id from memberships m join users u on u.id = m.user_id where u.email like 'e2e.%@example.com' and m.role = 'owner')`;
await sql`delete from users where email like 'e2e.%@example.com'`;
await sql`delete from rate_limits`;

const browser = await chromium.launch();
try {
  // ── Owner signs up ────────────────────────────────────────────────────────
  const owner = await signUp(browser, OWNER, "E2E Wealth");
  check(true, "new account signs in with a password only and Home recommends an authenticator");
  check(owner.codes.length === 10 && /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(owner.codes[0]!), "10 recovery codes shown after authenticator setup");
  const [p] = await sql`select p.id from practices p join memberships m on m.practice_id = p.id join users u on u.id = m.user_id where u.email = ${OWNER}`;
  const practiceId = p!["id"] as string;
  await owner.page.getByText("Good to see you").waitFor();
  check(true, "owner reaches Home");

  // Two clients, so assignment can be tested.
  await sql`insert into investors (practice_id, name, mobile) values (${practiceId}, 'Asha Client', '9800000001'), (${practiceId}, 'Bharat Client', '9800000002')`;

  // ── Password reset ────────────────────────────────────────────────────────
  const other = await browser.newPage();
  await go(other, "/forgot-password");
  await other.getByLabel("Email").fill(OWNER);
  await other.getByRole("button", { name: "Send reset link" }).click();
  await other.getByText("If that email has an account").waitFor();
  await go(other, "/forgot-password");
  await other.getByLabel("Email").fill("nobody.e2e@example.com");
  await other.getByRole("button", { name: "Send reset link" }).click();
  await other.getByText("If that email has an account").waitFor();
  check(true, "forgot-password answers the same for unknown emails");
  const resetLink = await mailLink(other, OWNER, "reset-password");
  await other.goto(resetLink, { waitUntil: "networkidle" });
  const NEW_PASSWORD = "another-long-password";
  await other.getByLabel("New password").fill(NEW_PASSWORD);
  await other.getByLabel("Type it again").fill(NEW_PASSWORD);
  await other.getByRole("button", { name: "Save new password" }).click();
  await other.getByRole("heading", { name: "Password changed" }).waitFor();
  check(true, "password reset with the emailed link");
  await other.goto(resetLink, { waitUntil: "networkidle" });
  await other.getByLabel("New password").fill("yet-another-password");
  await other.getByLabel("Type it again").fill("yet-another-password");
  await other.getByRole("button", { name: "Save new password" }).click();
  await other.getByText("expired or was already used").waitFor();
  check(true, "a reset link works only once");
  await go(owner.page, "/app/clients");
  await waitForPath(owner.page, "/login");
  check(true, "resetting the password signed out the owner's other session");
  await signIn(owner.page, OWNER, NEW_PASSWORD, owner.secret);
  await waitForPath(owner.page, "/app");
  check(true, "new password + authenticator code signs in");

  // ── Lost phone ────────────────────────────────────────────────────────────
  await owner.page.getByRole("button", { name: "Sign out" }).first().click();
  await waitForPath(owner.page, "/login");
  await owner.page.getByLabel("Email").fill(OWNER);
  await owner.page.getByLabel("Password").fill(NEW_PASSWORD);
  await owner.page.getByRole("button", { name: "Sign in" }).click();
  await waitForPath(owner.page, "/two-factor");
  await owner.page.getByRole("button", { name: "Lost your phone?" }).click();
  await owner.page.getByLabel("Recovery code").fill("WRONG-CODE1");
  await owner.page.getByRole("button", { name: "Use recovery code" }).click();
  await owner.page.getByText("That recovery code didn't work").waitFor();
  await owner.page.getByLabel("Recovery code").fill(owner.codes[0]!.toLowerCase());
  await owner.page.getByRole("button", { name: "Use recovery code" }).click();
  const second = await setUpAuthenticator(owner.page);
  check(second.secret !== owner.secret && second.codes[0] !== owner.codes[0], "recovery code removed the old authenticator; a new one and new codes were set up");
  owner.secret = second.secret;
  owner.codes = second.codes;

  // ── Team: invite a sub-broker ─────────────────────────────────────────────
  await go(owner.page, "/app/settings/team");
  await owner.page.getByLabel("Their email").fill(SUB);
  await owner.page.getByLabel("Sub-broker").check();
  await owner.page.getByRole("button", { name: "Send invitation" }).click();
  await owner.page.getByText("Invitation sent.").waitFor();
  await owner.page.getByText(SUB).waitFor();
  check(true, "invitation listed as pending");
  const inviteLink = await mailLink(owner.page, SUB, "invite");

  const sub = await browser.newPage();
  sub.on("pageerror", (e) => errors.push(`sub: ${e.message}`));
  await sub.goto(inviteLink, { waitUntil: "networkidle" });
  await sub.getByRole("heading", { name: "Join E2E Wealth" }).waitFor();
  await sub.getByLabel("Your name").fill("Sub Broker");
  await sub.getByLabel("Choose a password").fill(PASSWORD);
  await sub.getByRole("button", { name: "Join" }).click();
  await sub.getByRole("heading", { name: "You've joined" }).waitFor();
  check(true, "sub-broker accepted the invitation");
  await go(sub, "/login");
  await sub.getByLabel("Email").fill(SUB);
  await sub.getByLabel("Password").fill(PASSWORD);
  await sub.getByRole("button", { name: "Sign in" }).click();
  await waitForPath(sub, "/app");
  check(true, "invited member signs in with a password only");
  await go(sub, "/app/clients");
  await sub.getByText("No clients yet.").waitFor();
  check(true, "sub-broker sees no clients before any are assigned");

  await go(owner.page, "/app/clients");
  await owner.page.getByLabel("Who handles Asha Client").selectOption({ label: "Sub Broker" });
  await owner.page.waitForTimeout(500);
  await go(sub, "/app/clients");
  const subClients = await sub.locator("main li").allTextContents();
  check(subClients.length === 1 && subClients[0]!.includes("Asha Client"), "after assignment the sub-broker sees exactly that client");
  await go(owner.page, "/app/clients");
  check((await owner.page.locator("main li").count()) === 2, "the owner still sees every client");

  // The owner requires an authenticator for everyone: the sub-broker must set one up, with no "Not now".
  await go(owner.page, "/app/settings");
  await owner.page.getByLabel(/Require an authenticator app for everyone/).check();
  await owner.page.getByRole("button", { name: "Save" }).click();
  await owner.page.getByText("Saved.").waitFor();
  await go(sub, "/app/clients");
  await waitForPath(sub, "/two-factor/setup");
  check((await sub.getByRole("link", { name: "Not now" }).count()) === 0, "once required, a member without an authenticator must set one up (no 'Not now')");
  const subAuth = await setUpAuthenticator(sub);
  await go(sub, "/app/settings/security");
  await sub.getByText("Your practice requires it, so it can't be turned off.").waitFor();
  check(true, "a required authenticator can't be turned off");

  await go(owner.page, "/app/settings/team");
  await owner.page.getByRole("button", { name: "Switch off" }).click();
  await owner.page.getByText("can no longer sign in").waitFor();
  await go(sub, "/app/clients");
  await waitForPath(sub, "/login");
  await signIn(sub, SUB, PASSWORD, subAuth.secret);
  await waitForPath(sub, "/no-access");
  check(true, "a switched-off member is signed out and can't open the practice");

  // ── Billing: pay by UPI, admin confirms ───────────────────────────────────
  await go(owner.page, "/app/settings/billing");
  check((await owner.page.getByTestId("billing-state").textContent())?.startsWith("Free trial until"), "billing shows the trial");
  await owner.page.getByRole("radio", { name: /Yearly/ }).click();
  await owner.page.getByRole("button", { name: "Choose Growth" }).click();
  await owner.page.getByText("Pay ₹9,990 for Growth, 1 year").waitFor();
  check(true, "UPI request shows the yearly Growth price from the plan table");
  await owner.page.getByLabel("UTR (12 digits)").fill("1234");
  await owner.page.getByRole("button", { name: "I've paid" }).click();
  await owner.page.getByText("12-digit number").waitFor();
  const utr = String(run).slice(-12).padStart(12, "4");
  await owner.page.getByLabel("UTR (12 digits)").fill(utr);
  await owner.page.getByRole("button", { name: "I've paid" }).click();
  await owner.page.getByText("We'll check the payment").waitFor();
  check(true, "UTR submitted; payment waiting to be checked");

  const nonAdmin = await owner.page.request.get(`${BASE}/platform`);
  check(nonAdmin.status() === 404, "the platform console is 'not found' for a non-admin");

  const admin = await signUp(browser, ADMIN, "Anqulas Platform");
  await go(admin.page, "/platform");
  try {
    await admin.page.getByText(`UTR ${utr}`).waitFor({ timeout: 10000 });
  } catch (e) {
    console.log("PLATFORM PAGE:", (await admin.page.textContent("body"))?.slice(0, 600));
    throw e;
  }
  await admin.page.getByRole("button", { name: "Received, confirm" }).click();
  await admin.page.getByText("Payment confirmed; plan extended.").waitFor();
  check(true, "platform admin confirmed the UPI payment");
  await go(owner.page, "/app/settings/billing");
  const state = (await owner.page.getByTestId("billing-state").textContent()) ?? "";
  const [pp] = await sql`select plan, paid_until, trial_ends_at from practices where id = ${practiceId}`;
  const expected = new Date(pp!["trial_ends_at"]);
  expected.setUTCMonth(expected.getUTCMonth() + 12);
  check(
    pp!["plan"] === "growth" && Math.abs(new Date(pp!["paid_until"]).getTime() - expected.getTime()) < 1000 && state.startsWith("Paid until"),
    "Growth paid for a year after the remaining trial days",
  );

  // ── Lock after a lapsed plan ──────────────────────────────────────────────
  await sql`update practices set paid_until = now() - interval '4 days', trial_ends_at = now() - interval '40 days' where id = ${practiceId}`;
  await go(owner.page, "/app/clients");
  await waitForPath(owner.page, "/app/settings/billing");
  check((await owner.page.getByTestId("billing-state").textContent())?.includes("Your data is safe"), "lapsed plan: the owner is sent to billing; nothing deleted");
  await sql`update practices set paid_until = now() + interval '30 days' where id = ${practiceId}`;

  check(errors.length === 0, `no browser errors${errors.length ? ": " + errors.join("; ") : ""}`);
  console.log("\nAll checks passed.");
} finally {
  await browser.close();
  await sql.end();
}
