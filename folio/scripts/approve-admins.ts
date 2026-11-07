/**
 * Confirms the sign-ups of the platform admin email(s), so the first admin can sign in before any email service
 * is set up. Used by the publish workflow when "approve_admins" is ticked. Prints when each account was made:
 * if one was made before you signed up yourself, someone else may have used your address. Delete that account
 * instead of approving it.
 *
 *   DATABASE_URL=… PLATFORM_ADMIN_EMAILS=you@example.com npx tsx scripts/approve-admins.ts
 *
 * With --build (Cloudflare's builder runs it on every build): does nothing when PLATFORM_ADMIN_EMAILS isn't a build
 * variable, and only approves accounts made in the last 24 hours, so an old unconfirmed sign-up with your address
 * (possibly not yours) is never approved by a later build.
 */
import { and, gt, inArray, isNull } from "drizzle-orm";
import { db, runWithDb } from "../src/server/db/client";
import { users } from "../src/server/db/schema";

const url = process.env["DATABASE_URL"];
const emails = (process.env["PLATFORM_ADMIN_EMAILS"] ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const build = process.argv.includes("--build");
if (build && emails.length === 0) {
  console.log("PLATFORM_ADMIN_EMAILS isn't a build variable: no admin sign-up to approve.");
  process.exit(0);
}
if (!url || emails.length === 0) {
  console.error("Needs DATABASE_URL and PLATFORM_ADMIN_EMAILS");
  process.exit(1);
}

const { close } = await runWithDb(url, async () => {
  const approved = await db()
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(
      and(
        inArray(users.email, emails),
        isNull(users.emailVerifiedAt),
        build ? gt(users.createdAt, new Date(Date.now() - 24 * 3600 * 1000)) : undefined,
      ),
    )
    .returning({ email: users.email, createdAt: users.createdAt });
  if (!approved.length) console.log("No unconfirmed admin accounts. Sign up first, then run this again.");
  for (const a of approved) console.log(`Approved ${a.email} (account created ${a.createdAt.toISOString()})`);
});
await close();
