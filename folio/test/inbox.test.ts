/** Mailbacks arriving by email: who is trusted, the ZIP password, retries, Gmail's confirmation, the endpoint. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withPractice } from "@/server/db/scope";
import { inboxMessages, memberships, practices, transactions, users } from "@/server/db/schema";
import { newWrappedDataKey, practiceCrypto, randomBytes, toB64url } from "@/server/crypto";
import { ensureInboxCode, inboxEndpoint, receiveEmail, retryWaiting } from "@/server/inbox";
import { withTestDb } from "./helpers";

const MASTER = toB64url(randomBytes(32));
process.env["MASTER_KEY"] = MASTER;
process.env["SESSION_SECRET"] ??= toB64url(randomBytes(32));
process.env["INBOUND_DOMAIN"] = "in.example.test";
const TOKEN = toB64url(randomBytes(32));

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/imports/${name}`, import.meta.url)));
let P = "";
let U = "";
let address = "";

/** A minimal MIME email with optional attachments. */
function mime(opts: { from: string; subject: string; text?: string; files?: { name: string; bytes: Uint8Array }[]; headers?: string[] }): Uint8Array {
  const b = "XXBOUNDARYXX";
  const lines = [`From: ${opts.from}`, `To: ${address}`, `Subject: ${opts.subject}`, ...(opts.headers ?? []), "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${b}"`, "", `--${b}`, "Content-Type: text/plain; charset=utf-8", "", opts.text ?? "Please find attached.", ""];
  for (const f of opts.files ?? []) {
    const b64 = Buffer.from(f.bytes).toString("base64").replace(/(.{76})/g, "$1\r\n");
    lines.push(`--${b}`, `Content-Type: application/zip; name="${f.name}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${f.name}"`, "", b64, "");
  }
  lines.push(`--${b}--`, "");
  return new TextEncoder().encode(lines.join("\r\n"));
}

const camsMail = (file = "cams-feed-aes256.zip") =>
  mime({ from: "CAMS Mailback <donotreply@camsonline.com>", subject: "WBR2 - Transaction report", files: [{ name: file, bytes: fixture(file) }] });

async function messages() {
  return db().select().from(inboxMessages).where(eq(inboxMessages.practiceId, P)).orderBy(inboxMessages.receivedAt);
}
async function txnCount() {
  return (await withPractice(P, (tx) => tx.select({ id: transactions.id }).from(transactions))).length;
}

beforeAll(() =>
  withTestDb(async () => {
    P = crypto.randomUUID();
    U = crypto.randomUUID();
    await db().insert(practices).values({ id: P, name: "Inbox test", arn: "ARN-12345", billingExempt: true, dataKeyWrapped: await newWrappedDataKey(MASTER, P) });
    await db().insert(users).values({ id: U, email: `owner-${U}@example.com`, name: "Owner", passwordHash: "x" });
    await db().insert(memberships).values({ practiceId: P, userId: U, role: "owner" });
    address = `${await ensureInboxCode(P)}@in.example.test`;
  }),
);

afterAll(() =>
  withTestDb(async () => {
    await db().delete(practices).where(eq(practices.id, P));
    await db().delete(users).where(eq(users.id, U));
  }),
);

describe("email import", () => {
  it("gives each practice one private address", async () => {
    expect(address).toMatch(/^mb-[a-z0-9]{12}@in\.example\.test$/);
    expect(await withTestDb(() => ensureInboxCode(P))).toBe(address.split("@")[0]);
  });

  it("refuses unknown addresses", async () => {
    const res = await withTestDb(() => receiveEmail("mb-aaaaaaaaaaaa@in.example.test", camsMail()));
    expect(res.status).toBe(404);
  });

  it("shows Gmail's forwarding confirmation code", async () => {
    await withTestDb(() =>
      receiveEmail(
        address,
        mime({
          from: "Gmail Team <forwarding-noreply@google.com>",
          subject: "(#382910445) Gmail Forwarding Confirmation - Receive Mail from father@gmail.com",
          text: "father@gmail.com has requested to automatically forward mail to your email address.\nConfirmation code: 382910445\n\nTo allow, click https://mail-settings.google.com/mail/vf-%5BANGjdJ%5D-abc",
        }),
      ),
    );
    const [m] = (await withTestDb(messages)).filter((x) => x.kind === "forward_confirm");
    expect(m?.detail).toMatchObject({ code: "382910445", requester: "father@gmail.com" });
    expect((m?.detail as { link: string }).link).toMatch(/^https:\/\/mail-settings\.google\.com\/mail\/vf-/);
  });

  it("ignores mail that isn't from CAMS or KFintech", async () => {
    await withTestDb(() => receiveEmail(address, mime({ from: "someone@evil.test", subject: "WBR2", files: [{ name: "cams-feed-aes256.zip", bytes: fixture("cams-feed-aes256.zip") }] })));
    const last = (await withTestDb(messages)).at(-1)!;
    expect(last).toMatchObject({ kind: "other", status: "ignored", payloadEnc: null });
    expect(await withTestDb(txnCount)).toBe(0);
  });

  it("doesn't trust a registrar email whose signature fails", async () => {
    const bad = mime({ from: "donotreply@camsonline.com", subject: "WBR2", headers: ["Authentication-Results: mx.cloudflare.net; dkim=fail header.d=camsonline.com"], files: [{ name: "x.zip", bytes: fixture("cams-feed-aes256.zip") }] });
    await withTestDb(() => receiveEmail(address, bad));
    expect((await withTestDb(messages)).at(-1)).toMatchObject({ status: "ignored" });
  });

  it("keeps a mailback until the ZIP password is saved, then imports it", async () => {
    await withTestDb(() => receiveEmail(address, camsMail()));
    let last = (await withTestDb(messages)).at(-1)!;
    expect(last).toMatchObject({ kind: "mailback", status: "needs_password" });
    expect(last.payloadEnc).toBeTruthy();
    expect(await withTestDb(txnCount)).toBe(0);

    // A wrong password: still waiting.
    const pc = await withTestDb(async () => {
      const [p] = await db().select().from(practices).where(eq(practices.id, P));
      return practiceCrypto(MASTER, P, p!.dataKeyWrapped);
    });
    await withTestDb(async () => {
      await db().update(practices).set({ mailbackPasswordEnc: await pc.encrypt("mailback_password", P, "wrong") }).where(eq(practices.id, P));
      expect(await retryWaiting(P)).toBe(0);
    });
    expect((await withTestDb(messages)).at(-1)!.status).toBe("needs_password");

    await withTestDb(async () => {
      await db().update(practices).set({ mailbackPasswordEnc: await pc.encrypt("mailback_password", P, "folio123") }).where(eq(practices.id, P));
      expect(await retryWaiting(P)).toBe(1);
    });
    last = (await withTestDb(messages)).at(-1)!;
    expect(last).toMatchObject({ status: "imported", payloadEnc: null });
    expect((last.detail as { added: number }).added).toBe(5);
    expect(await withTestDb(txnCount)).toBe(5);
  });

  it("imports straight away once the password is known, and never twice", async () => {
    await withTestDb(() => receiveEmail(address, camsMail()));
    const last = (await withTestDb(messages)).at(-1)!;
    expect(last.status).toBe("imported");
    expect(last.detail).toMatchObject({ added: 0 });
    expect(await withTestDb(txnCount)).toBe(5);
  });

  it("only trusts password-protected files", async () => {
    const plain = mime({ from: "donotreply@camsonline.com", subject: "WBR2", files: [{ name: "report.csv", bytes: fixture("cams-feed.csv") }] });
    await withTestDb(() => receiveEmail(address, plain));
    const last = (await withTestDb(messages)).at(-1)!;
    expect(last.status).toBe("ignored");
    expect(JSON.stringify(last.detail)).toMatch(/Not password-protected/);
  });

  it("answers the mail Worker only with the right token", async () => {
    process.env["INBOX_TOKEN"] = TOKEN;
    const req = (auth: string) =>
      new Request("https://folio.test/__inbox", { method: "POST", headers: { authorization: `Bearer ${auth}`, "x-folio-to": "mb-aaaaaaaaaaaa@in.example.test" }, body: camsMail() as BodyInit });
    const wrong = await withTestDb(() => inboxEndpoint(req("nope"), { INBOX_TOKEN: TOKEN }));
    expect(wrong?.status).toBe(404);
    const right = await withTestDb(() => inboxEndpoint(req(TOKEN), { INBOX_TOKEN: TOKEN }));
    expect(right?.status).toBe(404); // the token is fine; that address doesn't exist
    expect(await withTestDb(() => inboxEndpoint(new Request("https://folio.test/app"), { INBOX_TOKEN: TOKEN }))).toBeNull();
  });

  it("is invisible to sub-brokers", async () => {
    const seen = await withTestDb(() => withPractice({ practiceId: P, userId: U, limited: true }, (tx) => tx.select().from(inboxMessages).where(and(eq(inboxMessages.practiceId, P)))));
    expect(seen).toHaveLength(0);
    const owner = await withTestDb(() => withPractice({ practiceId: P, userId: U, limited: false }, (tx) => tx.select().from(inboxMessages)));
    expect(owner.length).toBeGreaterThan(3);
  });
});
