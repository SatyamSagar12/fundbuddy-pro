/**
 * Browser test of the client portal: the distributor turns it on and sends the link; a client signs in with an
 * emailed code on a phone and sees only their own family, branded as the distributor's; no team pages; a shared
 * email can't sign in; changes to the family apply at once; sign-out; turning the portal off.
 * Needs the dev server (mail goes to /dev/outbox) and NAVs loaded locally.   npx tsx scripts/e2e-portal.ts
 */
import { readFileSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { addSampleData, BASE, check, cleanUp, go, signUpAndIn, sql } from "./e2e-helpers";

const RUN = Date.now();
const OWNER = `e2e.portal+${RUN}@example.com`;
const RAMESH = "ramesh.sample@example.com";
const shots = process.env["SHOTS"];

/** The newest sign-in code mailed to `to` (local dev outbox). */
async function latestCode(ctx: BrowserContext, to: string): Promise<string | null> {
  const o = await ctx.newPage();
  await go(o, "/dev/outbox");
  const mails = await o.locator("article").allTextContents();
  await o.close();
  for (const m of mails) {
    const hit = new RegExp(`to ${to.replace(/[.+]/g, "\\$&")}(\\d{6}) is your code`, "i").exec(m);
    if (hit) return hit[1]!;
  }
  return null;
}

async function mailsTo(ctx: BrowserContext, to: string): Promise<number> {
  const o = await ctx.newPage();
  await go(o, "/dev/outbox");
  const n = (await o.locator("article").allTextContents()).filter((m) => m.toLowerCase().includes(`to ${to.toLowerCase()}`)).length;
  await o.close();
  return n;
}

async function askCode(p: Page, link: string, email: string) {
  await p.goto(link, { waitUntil: "networkidle" });
  await p.getByLabel("Your email").fill(email);
  await p.getByRole("button", { name: "Send me a code" }).click();
  await p.getByLabel("6-digit code").waitFor();
}

await cleanUp("e2e.portal");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  const P = await signUpAndIn(p, OWNER, "Mehta Wealth");
  await sql`update practices set arn = 'ARN-778899', euin = 'E112233' where id = ${P}`;
  await addSampleData(p);
  const [fam] = await sql`insert into families (practice_id, name) values (${P}, 'Kumar family') returning id`;
  await sql`update investors set family_id = ${fam!["id"]} where practice_id = ${P} and name in ('Ramesh Kumar', 'Sunita Sharma')`;
  const [ramesh] = await sql`select id from investors where practice_id = ${P} and name = 'Ramesh Kumar'`;

  // The distributor turns the portal on and emails Ramesh the link.
  await go(p, "/app/families");
  await p.getByRole("link", { name: "Client portal" }).click();
  await p.getByRole("button", { name: "Turn on the portal" }).click();
  const link = (await p.getByTestId("portal-link").textContent())!.trim();
  check(new RegExp(`^${BASE}/c/[a-z0-9]{8}$`).test(link), `turning the portal on gives a link (${link})`);
  if (shots) await p.screenshot({ path: `${shots}/portal-settings.png`, fullPage: true });
  await go(p, `/app/clients/${ramesh!["id"]}`);
  await p.getByRole("button", { name: "Email them the link" }).click();
  await p.getByText(`Sent to ${RAMESH}.`).waitFor();
  check(true, "a client is emailed the portal link from their page");

  // Ramesh, on his phone.
  const phone = await b.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true, colorScheme: "dark", acceptDownloads: true });
  const c = await phone.newPage();
  c.on("pageerror", (e) => errors.push(e.message));
  await c.goto(link, { waitUntil: "networkidle" });
  const signIn = (await c.locator("body").textContent()) ?? "";
  check(signIn.includes("Mehta Wealth") && signIn.includes("ARN-778899") && signIn.includes("EUIN E112233"), "the sign-in page is branded with the distributor's name, ARN and EUIN");
  check(signIn.includes("Mutual Fund investments are subject to market risks"), "it carries the AMFI disclaimer");
  await askCode(c, link, RAMESH.toUpperCase());
  const code = await latestCode(phone, RAMESH);
  check(code !== null, "a 6-digit code is emailed (the email's case doesn't matter)");
  await c.getByLabel("6-digit code").fill(code === "000000" ? "111111" : "000000");
  await c.getByRole("button", { name: "See my portfolio" }).click();
  await c.getByText("That code isn't right").waitFor();
  check(true, "a wrong code is refused");
  await c.getByLabel("6-digit code").fill(code!);
  await c.getByRole("button", { name: "See my portfolio" }).click();
  await c.waitForURL((u) => u.pathname === "/portal");
  await c.getByRole("heading", { name: "Holdings" }).waitFor();
  const home = (await c.locator("body").textContent()) ?? "";
  check(home.includes("Kumar family") && home.includes("Ramesh Kumar") && home.includes("Sunita Sharma"), "Ramesh sees his family's portfolio");
  check(!home.includes("Mohammed Irfan") && !home.includes("Priya Menon") && !home.includes("Vikram Rao"), "and nobody else's");
  check(/Current value₹[\d,]+/.test(home) && home.includes("Mehta Wealth"), "with the current value, branded as the distributor's");
  check(!/ZZRPK|XXXXXX|PAN/.test(home), "no PAN anywhere on the page");
  const wide = await c.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 376, `the portal fits a 375px phone (${wide})`);
  check(await c.evaluate(() => document.documentElement.classList.contains("dark")), "and follows the phone's dark mode");
  if (shots) {
    await c.waitForTimeout(1200);
    await c.screenshot({ path: `${shots}/portal-phone-dark.png`, fullPage: true });
  }

  // The statement PDF from the portal.
  const [download] = await Promise.all([c.waitForEvent("download"), c.getByRole("button", { name: /PDF statement|Share PDF/ }).click()]);
  const doc = await getDocument({ data: new Uint8Array(readFileSync((await download.path())!)), verbosity: 0 }).promise;
  const text = (await (await doc.getPage(1)).getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join(" ");
  check(text.includes("Mehta Wealth") && text.includes("Kumar family") && !text.includes("Mohammed Irfan"), "the client can download their family's branded statement");

  // A portal session is not a team session.
  await c.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  check(new URL(c.url()).pathname === "/login", `team pages need a team sign-in (${new URL(c.url()).pathname})`);
  await c.goto(`${BASE}/app/clients/${ramesh!["id"]}`, { waitUntil: "networkidle" });
  check(new URL(c.url()).pathname === "/login", "even a client's own team page");

  // The distributor takes Ramesh out of the family: he sees only himself at once.
  await sql`update investors set family_id = null where id = ${ramesh!["id"]}`;
  await c.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  const alone = (await c.locator("body").textContent()) ?? "";
  check(alone.includes("Your portfolio") && !alone.includes("Sunita Sharma"), "family changes apply on the next page load");
  await sql`update investors set family_id = ${fam!["id"]} where id = ${ramesh!["id"]}`;

  // An email on clients of different families can't sign in, and the distributor is told.
  await sql`update investors set email = 'sunita.sample@example.com' where practice_id = ${P} and name = 'Mohammed Irfan'`;
  const other = await (await b.newContext()).newPage();
  const before = await mailsTo(phone, "sunita.sample@example.com");
  await askCode(other, link, "sunita.sample@example.com");
  check((await other.locator("body").textContent())?.includes("If sunita.sample@example.com is on Mehta Wealth's records"), "the answer is the same whether or not the email can sign in");
  check((await mailsTo(phone, "sunita.sample@example.com")) === before, "no code is sent for an email shared by two families");
  await go(p, "/app/portal");
  check((await p.locator("main").textContent())?.includes("sunita.sample@example.com: Mohammed Irfan, Sunita Sharma"), "the portal page lists the shared email to fix");
  const nobody = `nobody.${RUN}@example.com`;
  await askCode(other, link, nobody);
  check((await mailsTo(phone, nobody)) === 0, "no code is sent to an email that isn't on the records");

  // Signing out, then turning the portal off.
  await c.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  await c.getByRole("button", { name: "Sign out" }).click();
  await c.waitForURL((u) => u.pathname.startsWith("/c/"));
  await c.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  check((await c.locator("main").textContent())?.includes("You're signed out"), "after signing out the portfolio is gone");

  // Sign in again, then the distributor turns the portal off: signed out at once, link stops working.
  await askCode(c, link, RAMESH);
  await c.getByLabel("6-digit code").fill((await latestCode(phone, RAMESH))!);
  await c.getByRole("button", { name: "See my portfolio" }).click();
  await c.waitForURL((u) => u.pathname === "/portal");
  p.once("dialog", (d) => void d.accept());
  await go(p, "/app/portal");
  await p.getByRole("button", { name: "Turn off" }).click();
  await p.getByRole("button", { name: "Turn on the portal" }).waitFor();
  await c.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  check((await c.locator("main").textContent())?.includes("You're signed out"), "turning the portal off signs clients out at once");
  await c.goto(link, { waitUntil: "networkidle" });
  check((await c.locator("main").textContent())?.includes("This link isn't working"), "and the link stops working");
  await phone.close();

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  console.log("\nClient portal: all checks passed.");
} finally {
  await b.close();
  await cleanUp("e2e.portal");
  await sql.end();
}
