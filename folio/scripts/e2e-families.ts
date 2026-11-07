/**
 * Browser test of families: create from the list and from a client's page, values on the Families view, move and
 * take out, a phone in dark mode, and a sub-broker seeing only families with their own clients.
 * Needs the dev server and NAVs loaded locally (see README, phase 2).
 *   npx tsx scripts/e2e-families.ts          (SHOTS=<folder> saves screenshots)
 */
import { chromium } from "playwright";
import { addSampleData, check, cleanUp, go, makeSubbroker, phoneDarkCheck, signIn, signUpAndIn, sql } from "./e2e-helpers";

const RUN = Date.now();
const OWNER = `e2e.fam+${RUN}@example.com`;
const SUB = `e2e.famsub+${RUN}@example.com`;
const shots = process.env["SHOTS"];

await cleanUp("e2e.fam");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  const practiceId = await signUpAndIn(p, OWNER, "Family Wealth");
  await addSampleData(p);

  // Clients ↔ Families switch, and the empty state.
  await go(p, "/app/clients");
  await p.getByRole("navigation", { name: "Clients or families" }).getByRole("link", { name: "Families" }).click();
  await p.getByRole("heading", { name: "No families yet" }).waitFor();
  check(true, "Families view is one tap from Clients, with an empty state that names the next step");

  // A new family from the list: two members, the second made head.
  await p.getByRole("link", { name: "New family" }).first().click();
  await p.getByLabel("Family name").fill("Kumar family");
  await p.getByLabel("Find a client").fill("Ramesh");
  await p.getByRole("checkbox").first().check();
  await p.getByLabel("Find a client").fill("Sunita");
  await p.getByRole("checkbox").first().check();
  await p.getByRole("button", { name: "Make Sunita Sharma the head" }).click();
  await p.getByRole("button", { name: "Save family" }).click();
  await p.getByRole("heading", { name: "Kumar family" }).waitFor();
  const header = await p.locator("main header").first().textContent();
  check(header?.includes("Head: Sunita Sharma") && header.includes("2 members"), `family page shows the head and members (${header?.replace(/\s+/g, " ")})`);
  const tiles = await p.locator("main").textContent();
  check(/Current value₹[\d,]+/.test(tiles ?? ""), `family page shows the family's current value (${tiles?.slice(0, 160)})`);
  check((await p.locator("table tbody tr").allTextContents()).some((r) => r.includes("Ramesh Kumar ·")), "holdings name whose each one is");
  if (shots) await p.screenshot({ path: `${shots}/family.png`, fullPage: true });

  // From a client's page: start a family, then add another client to it.
  await go(p, "/app/clients");
  await p.getByRole("link", { name: "Mohammed Irfan" }).click();
  await p.getByText("Mohammed Irfan isn't in a family yet.").waitFor();
  await p.getByRole("link", { name: "Start a family" }).click();
  check((await p.getByLabel("Family name").inputValue()) === "Irfan family", "a family started from a client's page is named after them");
  await p.getByRole("button", { name: "Save family" }).click();
  await p.getByRole("heading", { name: "Irfan family" }).waitFor();
  check((await p.locator("main").textContent())?.includes("Head of family"), "the client it was started from is the head");

  await go(p, "/app/clients");
  await p.getByRole("link", { name: "Priya Menon" }).click();
  await p.getByLabel("Add to a family").selectOption({ label: "Irfan family" });
  await p.getByRole("link", { name: "Irfan family" }).waitFor();
  check((await p.locator("main").textContent())?.includes("With Mohammed Irfan"), "a client joins a family from their page");
  await p.getByLabel("Move to another family").selectOption({ label: "Kumar family" });
  await p.getByRole("link", { name: "Kumar family" }).waitFor();
  check(true, "a client moves to another family");
  await p.getByRole("button", { name: "Take out of family" }).click();
  await p.getByText("Priya Menon isn't in a family yet.").waitFor();
  check(true, "a client is taken out of a family");

  // The Families view: value, invested, gain and return per family, members listed.
  await go(p, "/app/families");
  const rows = await p.locator("main li").allTextContents();
  check(rows.length === 2, `two families listed (${rows.length})`);
  const kumar = rows.find((r) => r.startsWith("Kumar family")) ?? "";
  check(/Value₹[\d,]+Invested₹[\d,]+Gain-?₹[\d,]+(XIRR|Return)/.test(kumar), `a family row shows value, invested, gain and return (${kumar})`);
  check(kumar.includes("Sunita Sharma") && kumar.includes("Ramesh Kumar"), "the row lists the members");
  const clientRows = await (await go(p, "/app/clients"), p.locator("main li").filter({ hasText: "Ramesh Kumar" }).textContent());
  check(clientRows?.includes("Kumar family"), "the clients list shows each client's family");
  if (shots) {
    await go(p, "/app/families");
    await p.screenshot({ path: `${shots}/families.png`, fullPage: true });
  }

  // Edit: rename and take a member out.
  await go(p, "/app/families");
  await p.getByRole("link", { name: /^Kumar family/ }).click();
  await p.getByRole("link", { name: "Edit" }).click();
  await p.getByLabel("Family name").fill("Sharma–Kumar family");
  await p.getByRole("checkbox", { checked: true }).first().uncheck();
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.getByRole("heading", { name: "Sharma–Kumar family" }).waitFor();
  check((await p.locator("main header").first().textContent())?.includes("1 member"), "editing renames the family and removes a member");

  const storage = await ctx.storageState();
  await phoneDarkCheck(b, storage, "/app/families", shots);
  const [fam] = await sql`select id from families where practice_id = ${practiceId} and name = 'Irfan family'`;
  await phoneDarkCheck(b, storage, `/app/families/${fam!["id"]}`, shots);

  // A sub-broker sees only the family holding their own client, and only that client in it.
  const subCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const s = await subCtx.newPage();
  await signUpAndIn(s, SUB, "Sub's own practice", "Sub Broker");
  const subId = await makeSubbroker(SUB, practiceId);
  await sql`update investors set assigned_user_id = ${subId} where practice_id = ${practiceId} and name = 'Priya Menon'`;
  await sql`update investors set family_id = ${fam!["id"]} where practice_id = ${practiceId} and name = 'Priya Menon'`;
  await subCtx.clearCookies();
  await signIn(s, SUB);
  await go(s, "/app/families");
  const subRows = await s.locator("main li").allTextContents();
  check(subRows.length === 1 && subRows[0]!.startsWith("Irfan family"), `the sub-broker sees only the family with their client (${subRows.length})`);
  check(subRows[0]!.includes("Priya Menon") && !subRows[0]!.includes("Mohammed Irfan"), "inside it, only their own client");
  await go(s, `/app/families/${fam!["id"]}`);
  check(!(await s.getByRole("button", { name: "Delete" }).isVisible()), "a sub-broker can't delete a family");
  const [kumarFam] = await sql`select id from families where practice_id = ${practiceId} and name like 'Sharma%'`;
  const res = await s.goto(`${process.env["APP_URL"] ?? "http://localhost:3000"}/app/families/${kumarFam!["id"]}`);
  check((await s.locator("main").textContent())?.match(/not found/i) || res?.status() === 404, "another team member's family is not found for the sub-broker");
  await subCtx.close();

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  console.log("\nFamilies: all checks passed.");
} finally {
  await b.close();
  await cleanUp("e2e.fam");
  await sql.end();
}
