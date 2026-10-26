/** The signed-in person's own sign-in security: recovery codes. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/server/member";
import { audit, newRecoveryCodes, recoveryCodesLeft, securityEmail } from "@/server/security";
import { checkCode } from "@/server/two-factor";

export const getSecurity = createServerFn({ method: "GET" }).handler(async () => {
  const m = await requireMember(undefined, { allowLocked: true });
  return { recoveryCodesLeft: await recoveryCodesLeft(m.userId) };
});

/** New recovery codes replace the old ones. Needs a current authenticator code. */
export const regenerateRecoveryCodes = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ code: z.string().trim().max(10) }).parse(input))
  .handler(async ({ data }) => {
    const m = await requireMember(undefined, { allowLocked: true });
    if (!(await checkCode(m.userId, data.code))) {
      return { ok: false as const, error: "That code didn't match. Try the newest code in your app." };
    }
    const codes = await newRecoveryCodes(m.userId);
    await audit(m.practiceId, m.userId, "user.recovery_codes_replaced");
    await securityEmail(m.email, m.name, "New recovery codes were made and the old ones stopped working");
    return { ok: true as const, recoveryCodes: codes };
  });
