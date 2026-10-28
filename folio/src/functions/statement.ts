/** The figures for a client's or a family's branded statement. The PDF is made in the browser. */
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPractice } from "@/server/db/scope";
import { families, investors } from "@/server/db/schema";
import { requireMember, scopeOf } from "@/server/member";
import { audit } from "@/server/security";
import { loadStatement, practiceBrand } from "@/server/statement";
import type { StatementData } from "@/lib/statement";

export const getStatement = createServerFn({ method: "GET" })
  .validator((data: unknown) =>
    z
      .object({ client: z.uuid().optional(), family: z.uuid().optional() })
      .refine((v) => Boolean(v.client) !== Boolean(v.family), "Choose a client or a family.")
      .parse(data),
  )
  .handler(async ({ data }): Promise<StatementData | null> => {
    const m = await requireMember();
    const body = await withPractice(scopeOf(m), async (tx) => {
      if (data.client) {
        const [c] = await tx.select({ id: investors.id, name: investors.name }).from(investors).where(eq(investors.id, data.client));
        return c ? loadStatement(tx, [c], c.name, false) : null;
      }
      const [f] = await tx.select({ id: families.id, name: families.name }).from(families).where(eq(families.id, data.family!));
      if (!f) return null;
      const people = await tx.select({ id: investors.id, name: investors.name }).from(investors).where(eq(investors.familyId, f.id)).orderBy(investors.name);
      return loadStatement(tx, people, f.name, true);
    });
    if (!body) return null;
    await audit(m.practiceId, m.userId, "statement.made", { target: data.client ?? data.family! });
    return { practice: await practiceBrand(m.practiceId), ...body };
  });
