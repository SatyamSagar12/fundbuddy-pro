/**
 * Imports AMFI NAVs and fills units, the same job the app runs by itself each day.
 *
 *   DATABASE_URL=… npx tsx scripts/nav-import.ts                       # from amfiindia.com and mfapi.in
 *   DATABASE_URL=… npx tsx scripts/nav-import.ts --file NAVAll.txt     # from a downloaded file
 *
 * Local testing without internet: --synthetic-history makes up a NAV history for each scheme in use (a smooth path
 * ending at its latest NAV) for every scheme. It refuses to run against anything but a local database.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runWithDb } from "../src/server/db/client";
import { fillUnits, httpFetcher, importNavAll, loadHistory, NAVALL_URLS, type Fetcher } from "../src/server/nav";
import { db } from "../src/server/db/client";
import { instruments } from "../src/server/db/schema";
import { eq } from "drizzle-orm";

const { values } = parseArgs({
  options: { file: { type: "string" }, "synthetic-history": { type: "boolean" }, "min-schemes": { type: "string" } },
});
const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("Set DATABASE_URL.");
  process.exit(1);
}
const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
if (values["synthetic-history"] && !local) {
  console.error("--synthetic-history is only for a local database.");
  process.exit(1);
}

function syntheticHistory(latest: number, latestDate: string): string {
  const rows: { date: string; nav: string }[] = [];
  const end = Date.parse(`${latestDate}T00:00:00Z`);
  for (let d = 0; d <= 3 * 365; d++) {
    const day = new Date(end - d * 86400000);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    // About 12% a year, with a gentle wave.
    const nav = latest / Math.pow(1.12, d / 365) * (1 + 0.04 * Math.sin(d / 40));
    const iso = day.toISOString().slice(0, 10);
    rows.push({ date: `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`, nav: nav.toFixed(4) });
  }
  return JSON.stringify({ data: rows });
}

const fetcher: Fetcher = async (u) => {
  if (values.file && NAVALL_URLS.includes(u)) return readFileSync(values.file, "utf8");
  if (values["synthetic-history"] && u.startsWith("https://api.mfapi.in/mf/")) {
    const code = decodeURIComponent(u.split("/").pop()!);
    const [i] = await db().select().from(instruments).where(eq(instruments.amfiCode, code));
    if (!i?.latestNav || !i.latestNavDate) throw new Error(`No NAV for ${code}`);
    return syntheticHistory(Number(i.latestNav), i.latestNavDate);
  }
  return httpFetcher(u);
};

const { result, close } = await runWithDb(url, async () => {
  const imported = await importNavAll(fetcher, Number(values["min-schemes"] ?? (values.file && local ? 1 : 1000)));
  if (values["synthetic-history"]) {
    // Every scheme gets 3 years of made-up history, so the local app never needs to download any.
    const from = new Date(Date.now() - 3 * 365 * 86400000).toISOString().slice(0, 10);
    for (const i of await db().select().from(instruments)) {
      if (i.amfiCode && i.latestNav && !i.historyFrom) await loadHistory(i.id, i.amfiCode, from, fetcher);
    }
  }
  const filled = await fillUnits({ fetcher, maxFetches: 500 });
  return { ...imported, ...filled };
});
await close();
console.log(result);
