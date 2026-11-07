/**
 * Browser test of the branded PDF statement: a client's and a family's, made in the browser; pdf-lib loaded only on
 * the press; downloaded on a computer, handed to the share sheet on a phone (for WhatsApp).
 * Needs the dev server and NAVs loaded locally.   npx tsx scripts/e2e-statement.ts   (SHOTS=<folder>: page images)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { addSampleData, check, cleanUp, go, signUpAndIn, sql } from "./e2e-helpers";

const RUN = Date.now();
const OWNER = `e2e.pdf+${RUN}@example.com`;
const DISCLAIMER = "Mutual Fund investments are subject to market risks, read all scheme related documents carefully.";
const shots = process.env["SHOTS"];

async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: bytes, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    pages.push(c.items.map((x) => ("str" in x ? x.str : "")).join(" ").replace(/\s+/g, " "));
  }
  return pages;
}

/** Watches for the PDF library being fetched (a separate chunk, or the dev server's pre-bundled module). */
function watchPdfLib(p: Page): () => boolean {
  let seen = false;
  p.on("request", (r) => {
    if (/pdf-lib|statement-pdf/.test(r.url())) seen = true;
  });
  return () => seen;
}

await cleanUp("e2e.pdf");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  const P = await signUpAndIn(p, OWNER, "Verma Investments");
  await sql`update practices set arn = 'ARN-123456', euin = 'E654321' where id = ${P}`;
  await addSampleData(p);
  const [fam] = await sql`insert into families (practice_id, name) values (${P}, 'Kumar family') returning id`;
  await sql`update investors set family_id = ${fam!["id"]} where practice_id = ${P} and name in ('Ramesh Kumar', 'Sunita Sharma')`;
  const [ramesh] = await sql`select id from investors where practice_id = ${P} and name = 'Ramesh Kumar'`;

  // A client's statement on a computer: downloads.
  const pdfLoaded = watchPdfLib(p);
  await go(p, `/app/clients/${ramesh!["id"]}`);
  check(!pdfLoaded(), "the PDF library isn't loaded with the page");
  const [download] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "PDF statement" }).click()]);
  check(pdfLoaded(), "the PDF library is loaded when the button is pressed");
  check(/^ramesh-kumar-statement-\d{4}-\d{2}-\d{2}\.pdf$/.test(download.suggestedFilename()), `the PDF is named for the client (${download.suggestedFilename()})`);
  const bytes = new Uint8Array(readFileSync((await download.path())!));
  check(new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-", "the download is a PDF");
  const pages = await pdfText(bytes);
  const first = pages[0]!;
  check(first.includes("Verma Investments") && first.includes("ARN-123456") && first.includes("EUIN E654321"), "it carries the practice's name, ARN and EUIN");
  check(pages.every((t) => t.includes(DISCLAIMER)), `the AMFI disclaimer is on every page (${pages.length})`);
  check(first.includes("Ramesh Kumar") && /CURRENT VALUE Rs [\d,]+/.test(first), "it has the client's name and current value");
  check(first.includes("HDFC Flexi Cap Fund") && /XIRR|RETURN/.test(first), "it lists holdings with their return");
  const all = pages.join(" ");
  check(all.includes("SIPs") && all.includes("Transactions in the last 12 months"), "it has the SIPs and the last 12 months' transactions");
  if (shots) writeFileSync(`${shots}/statement-client.pdf`, bytes);

  // The family's statement: every member.
  await go(p, `/app/families/${fam!["id"]}`);
  const [famDownload] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "PDF statement" }).click()]);
  const famPages = await pdfText(new Uint8Array(readFileSync((await famDownload.path())!)));
  check(famPages[0]!.includes("Kumar family") && famPages[0]!.includes("Family of 2: Ramesh Kumar, Sunita Sharma"), "the family statement names every member");
  check(famPages.join(" ").includes("MEMBER"), "family tables say whose each row is");
  if (shots) writeFileSync(`${shots}/statement-family.pdf`, new Uint8Array(readFileSync((await famDownload.path())!)));

  // A phone: the PDF goes to the share sheet (WhatsApp) instead of downloading.
  const phone = await b.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  // A plain script (not a function): tsx would rewrite a function with helpers the page doesn't have.
  await phone.addInitScript({
    content: `Object.assign(navigator, {
      canShare: (d) => Boolean(d && d.files && d.files.length),
      share: async (d) => { window.__shared = { name: d.files[0].name, type: d.files[0].type, size: d.files[0].size, title: d.title }; },
    });`,
  });
  const m = await phone.newPage();
  await go(m, `/app/families/${fam!["id"]}`);
  await m.getByRole("button", { name: "Share PDF" }).click();
  await m.waitForFunction(() => Boolean((window as unknown as { __shared?: unknown }).__shared));
  const shared = await m.evaluate(() => (window as unknown as { __shared: { name: string; type: string; size: number; title: string } }).__shared);
  check(shared.type === "application/pdf" && shared.size > 2000 && shared.name.startsWith("kumar-family-statement"), `on a phone the PDF goes to the share sheet (${shared.name}, ${shared.size} bytes)`);
  const wide = await m.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 376, `the family page with its buttons fits a 375px phone (${wide})`);
  if (shots) {
    await m.waitForTimeout(1500);
    await m.screenshot({ path: `${shots}/family-phone-buttons.png` });
  }
  await phone.close();

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  console.log("\nStatement PDF: all checks passed.");
} finally {
  await b.close();
  await cleanUp("e2e.pdf");
  await sql.end();
}
