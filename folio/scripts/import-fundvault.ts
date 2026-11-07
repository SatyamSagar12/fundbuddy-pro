/**
 * Imports the old FundVault Lite data (CSV exports of `clients`, `investments`, `sips`) into the practice
 * owned by --owner. That person signs up on Anqulas Folio first; this marks the practice billing-exempt.
 *
 *   DATABASE_URL=<session pooler URL> MASTER_KEY=<production master key> \
 *     npx tsx scripts/import-fundvault.ts --dir ./export --owner father@example.com [--dry-run]
 *
 * Re-running is safe. With --dry-run nothing is saved (the whole import is rolled back after the report).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { db, runWithDb } from "../src/server/db/client";
import { memberships, practices, users } from "../src/server/db/schema";
import { practiceCrypto } from "../src/server/crypto";
import { importFundVault, parseCsv } from "../src/server/import-fundvault";

const { values } = parseArgs({
  options: { dir: { type: "string" }, owner: { type: "string" }, "dry-run": { type: "boolean" } },
});
const dir = values.dir;
const owner = values.owner?.toLowerCase();
const url = process.env["DATABASE_URL"];
const masterKey = process.env["MASTER_KEY"];
if (!dir || !owner || !url || !masterKey) {
  console.error("Usage: DATABASE_URL=… MASTER_KEY=… npx tsx scripts/import-fundvault.ts --dir <folder> --owner <email> [--dry-run]");
  process.exit(1);
}
const read = (name: string) => parseCsv(readFileSync(join(dir, `${name}.csv`), "utf8"));
const data = { clients: read("clients"), investments: read("investments"), sips: read("sips") };
console.log(`Read ${data.clients.length} clients, ${data.investments.length} investments, ${data.sips.length} SIPs`);

const { close } = await runWithDb(url, async () => {
  const [p] = await db()
    .select({ id: practices.id, name: practices.name, key: practices.dataKeyWrapped })
    .from(practices)
    .innerJoin(memberships, and(eq(memberships.practiceId, practices.id), eq(memberships.role, "owner")))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(users.email, owner));
  if (!p) throw new Error(`No practice owned by ${owner}. They need to sign up first.`);
  console.log(`Importing into "${p.name}" (${p.id})${values["dry-run"] ? " — DRY RUN" : ""}`);
  const pc = await practiceCrypto(masterKey, p.id, p.key);

  const dryRun = values["dry-run"] ?? false;
  const report = await importFundVault(p.id, pc, data, { dryRun });
  console.log(JSON.stringify(report, null, 2));
  const t = report.totals;
  const match = Math.abs(t.oldInvested - t.newInvested) < 0.01 && t.oldActiveSips === t.newActiveSips;
  console.log(match ? "Totals match the old app." : "TOTALS DIFFER: check the report above before using the data.");
  if (dryRun) {
    console.log("Dry run: nothing was saved.");
    return;
  }
  await db().update(practices).set({ billingExempt: true }).where(eq(practices.id, p.id));
  console.log("Done. The practice is marked billing-exempt.");
});
await close();
