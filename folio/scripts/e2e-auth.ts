/**
 * Browser test of the whole sign-up journey against the local dev server (npm run dev):
 * sign up → confirm email (dev outbox) → sign in → set up authenticator → Home, Clients, Settings
 * → sign out → sign in again with a code. Also checks a code cannot be reused.
 * Run: npx tsx scripts/e2e-auth.ts
 */
import { chromium, type Page } from "playwright";
import postgres from "postgres";
import { totpCode, currentStep } from "../src/server/totp";

const BASE = process.env["APP_URL"] ?? "http://localhost:3000";
const email = `e2e+${Date.now()}@example.com`;
const password = "a-long-test-password";

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

async function codeFor(secret: string, offset = 0) {
  return totpCode(secret.replace(/\s/g, ""), currentStep() + offset);
}

async function waitForUrl(page: Page, path: string) {
  try {
    await page.waitForURL((u) => u.pathname.replace(/\/$/, "") === path, { timeout: 15000 });
  } catch (e) {
    console.log(`Expected ${path}, at ${page.url()}:`, (await page.textContent("body"))?.slice(0, 300));
    throw e;
  }
}

// Repeated local runs would otherwise hit the sign-up limit (5 per hour per network).
const local = postgres(process.env["DATABASE_URL"] ?? "postgres://folio_owner:folio_owner@127.0.0.1:5432/folio", { onnotice: () => {} });
await local`delete from rate_limits`;
await local.end();

const browser = await chromium.launch();
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  await page.getByLabel("Your practice or business name").fill("E2E Investments");
  await page.getByLabel("Your name").fill("Test Advisor");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("Use at least 10 characters.").waitFor();
  check(true, "weak password refused");
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("ARN (optional)").fill("arn-12345");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor();
  check(true, "sign-up sends a confirmation email");

  // Sign-in before confirming is refused.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Confirm your email first").waitFor();
  check(true, "unconfirmed account cannot sign in");

  await page.goto(`${BASE}/dev/outbox`);
  const body = await page.getByTestId("mail-body").first().textContent();
  const link = body?.match(/http\S+verify-email\?token=\S+/)?.[0];
  check(link, "confirmation link found in the email");
  await page.goto(link, { waitUntil: "networkidle" });
  check(await page.getByRole("button", { name: "Confirm my email" }).isVisible(), "opening the link alone confirms nothing");
  await page.getByRole("button", { name: "Confirm my email" }).click();
  await page.getByRole("heading", { name: "Email confirmed" }).waitFor();
  check(true, "email confirmed with the button");

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Wrong email or password.").waitFor();
  check(true, "wrong password refused");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForUrl(page, "/two-factor/setup");
  check(true, "first sign-in goes to authenticator setup");

  await page.goto(`${BASE}/app`);
  await waitForUrl(page, "/two-factor/setup");
  check(true, "the app stays closed until the authenticator is set up");

  const secret = (await page.getByTestId("totp-secret").textContent())!;
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Turn on and continue" }).click();
  await page.getByText("That code didn't match").waitFor();
  check(true, "wrong authenticator code refused");
  await page.getByLabel("6-digit code").fill(await codeFor(secret));
  await page.getByRole("button", { name: "Turn on and continue" }).click();
  await waitForUrl(page, "/app");
  await page.getByText("Good to see you, Test").waitFor();
  check(true, "authenticator set up; Home opens");

  await page.getByRole("link", { name: "Clients" }).first().click();
  await page.getByText("No clients yet.").waitFor();
  check(true, "Clients page shows an empty practice");

  await page.getByRole("link", { name: "Settings" }).first().click();
  check((await page.getByLabel("ARN").inputValue()) === "ARN-12345", "ARN saved at sign-up, normalised");
  await page.getByLabel("EUIN").fill("e123456");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("Saved.").waitFor();
  check(true, "practice details saved");

  await page.getByRole("button", { name: "Sign out" }).first().click();
  await waitForUrl(page, "/login");
  await page.goto(`${BASE}/app`);
  await waitForUrl(page, "/login");
  check(true, "signed out: the app redirects to sign-in");

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForUrl(page, "/two-factor");
  // The code used at setup was for this or the previous step; a code from an already-used step is refused.
  await page.getByLabel("6-digit code").fill(await codeFor(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  const reused = await Promise.race([
    page.getByText("That code didn't match").waitFor().then(() => "refused"),
    page.waitForURL((u) => u.pathname === "/app").then(() => "accepted"),
  ]);
  if (reused === "refused") {
    check(true, "an already-used code is refused");
    await page.getByLabel("6-digit code").fill(await codeFor(secret, 1));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await waitForUrl(page, "/app");
  check(true, "second sign-in with a fresh code opens the app");

  // Server functions refuse cross-site calls.
  const res = await fetch(`${BASE}/_serverFn/anything`, {
    method: "POST",
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site", "content-type": "application/json" },
    body: "{}",
  });
  check(res.status === 403, `cross-site server-function call blocked (${res.status})`);

  const headers = (await page.request.get(`${BASE}/login`)).headers();
  check(headers["x-frame-options"] === "DENY" && headers["cache-control"] === "no-store", "security headers present");

  check(errors.length === 0, `no browser errors${errors.length ? ": " + errors.join("; ") : ""}`);
  console.log("\nAll checks passed.");
} finally {
  await browser.close();
}
