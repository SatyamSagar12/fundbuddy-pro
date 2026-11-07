/** Shared steps for the phase 4 browser tests (scripts/e2e-families.ts, e2e-gains.ts, e2e-statement.ts, e2e-portal.ts). */
import type { Browser, BrowserContextOptions, Page } from "playwright";
import postgres from "postgres";

export const BASE = process.env["APP_URL"] ?? "http://localhost:3000";
export const sql = postgres(process.env["DATABASE_URL"] ?? "postgres://folio_owner:folio_owner@127.0.0.1:5432/folio", { onnotice: () => {} });
export const PASSWORD = "a-long-test-password";

export function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

export const go = (p: Page, path: string) => p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });

/** Signs up a new practice owner (email confirmed straight in the database) and signs in. */
export async function signUpAndIn(p: Page, email: string, practice: string, name = "Test Advisor"): Promise<string> {
  await go(p, "/signup");
  await p.getByLabel("Your practice or business name").fill(practice);
  await p.getByLabel("Your name").fill(name);
  await p.getByLabel("Work email").fill(email);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Create account" }).click();
  await p.getByRole("heading", { name: "Check your email" }).waitFor();
  await sql`update users set email_verified_at = now() where email = ${email}`;
  await signIn(p, email);
  const [row] = await sql`select m.practice_id from memberships m join users u on u.id = m.user_id where u.email = ${email}`;
  return row!["practice_id"] as string;
}

export async function signIn(p: Page, email: string): Promise<void> {
  await go(p, "/login");
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL((u) => u.pathname === "/app");
}

/** Makes `email` (already signed up) a sub-broker of `practiceId`, dropping the practice they created themselves. */
export async function makeSubbroker(email: string, practiceId: string): Promise<string> {
  const [u] = await sql`select id from users where email = ${email}`;
  const userId = u!["id"] as string;
  await sql`delete from practices where id in (select practice_id from memberships where user_id = ${userId})`;
  await sql`insert into memberships (practice_id, user_id, role) values (${practiceId}, ${userId}, 'subbroker')`;
  return userId;
}

export async function addSampleData(p: Page): Promise<void> {
  await go(p, "/app");
  await p.getByRole("button", { name: "Add sample data" }).click();
  await p.getByText("Sample data is in your account").waitFor();
}

/** Opens a page at phone width in dark mode and checks nothing is wider than the screen. */
export async function phoneDarkCheck(browser: Browser, storage: BrowserContextOptions["storageState"], path: string, shots?: string): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, storageState: storage, colorScheme: "dark", isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  await go(m, path);
  await m.waitForTimeout(1200);
  const wide = await m.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 376, `${path} fits a 375px phone (page width ${wide})`);
  check(await m.evaluate(() => document.documentElement.classList.contains("dark")), `${path} follows the phone's dark mode`);
  if (shots) await m.screenshot({ path: `${shots}/${path.replace(/[^a-z0-9]+/gi, "_")}-phone-dark.png`, fullPage: true });
  await ctx.close();
}

/** Removes earlier runs' accounts with this email prefix (and their practices). */
export async function cleanUp(prefix: string): Promise<void> {
  const like = `${prefix}%@example.com`;
  await sql`delete from practices where id in (select m.practice_id from memberships m join users u on u.id = m.user_id where u.email like ${like})`;
  await sql`delete from users where email like ${like}`;
  await sql`delete from rate_limits`;
}
