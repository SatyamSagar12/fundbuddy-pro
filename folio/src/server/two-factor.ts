/** Checks an authenticator code for a user and claims its time step, so it can never be used again. */
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "./db/client";
import { users } from "./db/schema";
import { openWithMaster } from "./crypto";
import { appEnv } from "./env";
import { verifyTotp } from "./totp";
import { underLimit } from "./rate-limit";

export async function checkCode(userId: string, code: string): Promise<boolean> {
  if (!(await underLimit(`totp:${userId}`, 6, 300))) return false;
  const [user] = await db().select().from(users).where(eq(users.id, userId));
  if (!user?.totpSecretEnc) return false;
  const secret = await openWithMaster(appEnv().MASTER_KEY, user.totpSecretEnc, `totp:${userId}`);
  const step = await verifyTotp(secret, code, user.totpLastStep ?? null);
  if (step === null) return false;
  // Only one request can claim a step: the update matches nothing if another request already stored this
  // step or a later one, so two simultaneous requests with the same code cannot both succeed.
  const claimed = await db()
    .update(users)
    .set({ totpLastStep: step })
    .where(
      and(
        eq(users.id, userId),
        eq(users.totpSecretEnc, user.totpSecretEnc),
        or(isNull(users.totpLastStep), lt(users.totpLastStep, step)),
      ),
    )
    .returning({ id: users.id });
  return claimed.length === 1;
}
