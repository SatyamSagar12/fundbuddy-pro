/**
 * Registrar mailbacks arriving by email.
 *
 * Each practice has a private forwarding address, <code>@<INBOUND_DOMAIN>. The distributor adds one Gmail filter
 * ("from CAMS or KFintech → forward to this address"). Cloudflare Email Routing hands each email to the small
 * folio-mail Worker (workers/folio-mail), which posts it here:
 *
 *   POST /__inbox   Authorization: Bearer <INBOX_TOKEN>   x-folio-to: <recipient address>   body: the raw email
 *
 * What is accepted:
 *  - Gmail's forwarding confirmation, so the code can be shown in the app (setup takes a minute).
 *  - Mail from the registrars' own domains whose ZIP attachments are password-protected and open with the
 *    practice's saved mailback password. Anything else is recorded as ignored and never imported: someone who
 *    learns the address still can't add transactions without that password.
 *
 * Attachments are kept (encrypted with the practice's key) until they import, so a missing or wrong password can
 * be fixed in Settings and the email retried.
 */
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import PostalMime from "postal-mime";
import { db } from "./db/client";
import { inboxMessages, memberships, practices } from "./db/schema";
import { practiceCrypto, toB64url, fromB64, randomBytes, type PracticeCrypto } from "./crypto";
import { appEnv } from "./env";
import type { Member } from "./member";
import { applyImport } from "./registrar-import";
import { refreshIfDue } from "./nav";
import { sendBriefingsIfDue } from "./briefing-mail";
import { deleteExpiredPortalRows } from "./portal";
import { readTables, TableError, ZipError } from "@/lib/imports/tables";
import { isZip, readZip } from "@/lib/imports/zip";
import { readFeed } from "@/lib/imports/feed";
import type { ImportSource, ImportTxn } from "@/lib/imports/normalise";

export const MAX_EMAIL_BYTES = 20 * 1024 * 1024;
const REGISTRAR_DOMAINS = /(^|\.)(camsonline\.com|kfintech\.com|karvy\.com|kfintech\.in|mfcentral\.com)$/i;
const GOOGLE_FORWARDING = /^forwarding-noreply@google\.com$/i;

export type InboxFile = { name: string; status: "imported" | "skipped" | "failed"; added?: number; alreadyIn?: number; newClients?: number; note?: string };
export type InboxDetail = {
  files?: InboxFile[];
  added?: number;
  note?: string;
  /** Gmail forwarding confirmation. */
  code?: string | null;
  link?: string | null;
  requester?: string | null;
};

type StoredFile = { name: string; data: string };

// ── Addresses ─────────────────────────────────────────────────────────────────

export function inboundDomain(): string | null {
  const d = appEnv().INBOUND_DOMAIN?.trim().toLowerCase();
  return d ? d.replace(/^@/, "") : null;
}

/** A fresh private address part: "mb-" and 12 letters/digits (no look-alikes). */
export function newInboxCode(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return `mb-${[...randomBytes(12)].map((b) => alphabet[b % alphabet.length]).join("")}`;
}

/** The practice's address, made on first use. */
export async function ensureInboxCode(practiceId: string, renew = false): Promise<string> {
  if (!renew) {
    const [p] = await db().select({ code: practices.inboxCode }).from(practices).where(eq(practices.id, practiceId));
    if (p?.code) return p.code;
  }
  for (;;) {
    const code = newInboxCode();
    const done = await db()
      .update(practices)
      .set({ inboxCode: code })
      .where(eq(practices.id, practiceId))
      .returning({ id: practices.id })
      .catch((e) => (String(e).includes("inbox_code") ? null : Promise.reject(e)));
    if (done) return code;
  }
}

// ── Receiving ─────────────────────────────────────────────────────────────────

const lower = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/** The sender's address: the From header (forwarded mail keeps the registrar's). */
function senderOf(email: { from?: { address?: string } }): string {
  return lower(email.from?.address);
}

/** DKIM result for the sender's domain, from the Authentication-Results header Cloudflare adds. */
function dkimFails(headers: { key: string; value: string }[], domain: string): boolean {
  const results = headers.filter((h) => h.key === "authentication-results" || h.key === "arc-authentication-results").map((h) => h.value.toLowerCase());
  return results.some((r) => new RegExp(`dkim=fail[^;]*header\\.d=([a-z0-9.-]*\\.)?${domain.replace(/\./g, "\\.")}`).test(r));
}

export async function receiveEmail(to: string, raw: ArrayBuffer | Uint8Array): Promise<{ status: number; message: string }> {
  const local = lower(to).split("@")[0] ?? "";
  if (!/^mb-[a-z0-9]{12}$/.test(local)) return { status: 404, message: "Unknown address" };
  const [practice] = await db().select({ id: practices.id }).from(practices).where(eq(practices.inboxCode, local));
  if (!practice) return { status: 404, message: "Unknown address" };

  const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  const from = senderOf(email);
  const subject = (email.subject ?? "").slice(0, 300);

  if (GOOGLE_FORWARDING.test(from) && /forwarding confirmation/i.test(subject)) {
    const body = `${email.text ?? ""}\n${email.html ?? ""}`;
    const code = /confirmation code:\s*(\d{6,12})/i.exec(body)?.[1] ?? /\(#(\d{6,12})\)/.exec(subject)?.[1] ?? null;
    const link = /https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s"'<>]+/i.exec(body)?.[0]?.replace(/&amp;/g, "&") ?? null;
    const requester = /^\s*([^\s@]+@[^\s@]+)\s+has requested/im.exec(email.text ?? "")?.[1] ?? null;
    await db().insert(inboxMessages).values({
      practiceId: practice.id,
      fromAddress: from,
      subject,
      kind: "forward_confirm",
      status: "waiting",
      detail: { code, link, requester } satisfies InboxDetail,
    });
    return { status: 200, message: "Forwarding confirmation saved" };
  }

  const domain = from.split("@")[1] ?? "";
  if (!REGISTRAR_DOMAINS.test(domain)) {
    await record(practice.id, from, subject, "other", "ignored", { note: "Not from CAMS or KFintech, so it was not read." });
    return { status: 200, message: "Ignored: not from a registrar" };
  }
  if (dkimFails(email.headers, domain.split(".").slice(-2).join("."))) {
    await record(practice.id, from, subject, "mailback", "ignored", { note: "The email's signature didn't check out, so it was not trusted." });
    return { status: 200, message: "Ignored: signature check failed" };
  }
  const files: StoredFile[] = [];
  for (const a of email.attachments) {
    const bytes = a.content instanceof ArrayBuffer ? new Uint8Array(a.content) : typeof a.content === "string" ? new TextEncoder().encode(a.content) : a.content;
    const name = a.filename ?? "attachment";
    if (!/\.(zip|dbf|csv|txt|xls|xlsx)$/i.test(name) && !isZip(bytes)) continue;
    files.push({ name, data: toB64url(bytes) });
  }
  if (!files.length) {
    await record(practice.id, from, subject, "mailback", "ignored", { note: "No report file attached." });
    return { status: 200, message: "Ignored: no attachment" };
  }
  const pc = await cryptoOf(practice.id);
  const [row] = await db()
    .insert(inboxMessages)
    .values({ practiceId: practice.id, fromAddress: from, subject, kind: "mailback", status: "waiting", detail: {} })
    .returning({ id: inboxMessages.id });
  await db()
    .update(inboxMessages)
    .set({ payloadEnc: await pc.encrypt("inbox_payload", row!.id, JSON.stringify(files)) })
    .where(eq(inboxMessages.id, row!.id));
  const result = await processMessage(practice.id, row!.id, pc);
  return { status: 200, message: `Mailback ${result}` };
}

async function record(practiceId: string, from: string, subject: string, kind: string, status: string, detail: InboxDetail) {
  await db().insert(inboxMessages).values({ practiceId, fromAddress: from, subject, kind, status, detail });
}

async function cryptoOf(practiceId: string): Promise<PracticeCrypto> {
  const [p] = await db().select({ key: practices.dataKeyWrapped }).from(practices).where(eq(practices.id, practiceId));
  if (!p) throw new Error("Practice not found");
  return practiceCrypto(appEnv().MASTER_KEY, practiceId, p.key);
}

/** The practice's owner, as whom automatic imports are recorded (audit log, new clients). */
async function ownerMember(practiceId: string): Promise<Member | null> {
  const [o] = await db()
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.practiceId, practiceId), eq(memberships.role, "owner"), eq(memberships.active, true)))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  return o ? { userId: o.userId, practiceId, role: "owner", name: "Automatic import", email: "" } : null;
}

export async function mailbackPassword(practiceId: string, pc: PracticeCrypto): Promise<string | null> {
  const [p] = await db().select({ enc: practices.mailbackPasswordEnc }).from(practices).where(eq(practices.id, practiceId));
  return p?.enc ? pc.decrypt("mailback_password", practiceId, p.enc) : null;
}

/** Opens and imports one stored email. Returns its new status. */
export async function processMessage(practiceId: string, messageId: string, pc?: PracticeCrypto): Promise<string> {
  pc ??= await cryptoOf(practiceId);
  const [msg] = await db()
    .select()
    .from(inboxMessages)
    .where(and(eq(inboxMessages.id, messageId), eq(inboxMessages.practiceId, practiceId)));
  if (!msg?.payloadEnc) return msg?.status ?? "missing";
  const files = JSON.parse(await pc.decrypt("inbox_payload", messageId, msg.payloadEnc)) as StoredFile[];
  const password = await mailbackPassword(practiceId, pc);
  const member = await ownerMember(practiceId);

  const out: InboxFile[] = [];
  let needsPassword = false;
  let failed = false;
  let added = 0;
  for (const f of files) {
    const bytes = fromB64(f.data);
    if (!isZip(bytes) || !readZip(bytes).some((e) => e.encrypted)) {
      out.push({ name: f.name, status: "skipped", note: "Not password-protected, so not trusted. Upload it on the Import page if you expected it." });
      continue;
    }
    if (!password) {
      needsPassword = true;
      out.push({ name: f.name, status: "failed", note: "Save the mailback ZIP password in Settings to open it." });
      continue;
    }
    try {
      const tables = await readTables(f.name, bytes, password);
      const bySource = new Map<ImportSource, ImportTxn[]>();
      const notReports: string[] = [];
      for (const t of tables) {
        if (!t.rows.length) continue;
        const feed = readFeed(t.rows);
        if (feed.missing.length) {
          notReports.push(t.name);
          continue;
        }
        bySource.set(feed.source, [...(bySource.get(feed.source) ?? []), ...feed.txns]);
      }
      if (!bySource.size) {
        out.push({ name: f.name, status: "skipped", note: `Not a transaction report${notReports.length ? ` (${notReports.join(", ")})` : ""}. Only transaction reports are imported for now.` });
        continue;
      }
      if (!member) throw new Error("This practice has no active owner.");
      for (const [source, txns] of bySource) {
        if (!txns.length) continue;
        const res = await applyImport(member, pc, { source, txns, fileName: `Email: ${f.name}` });
        if (res.plan.error) {
          failed = true;
          out.push({ name: f.name, status: "failed", note: res.plan.error });
          continue;
        }
        added += res.added;
        out.push({ name: f.name, status: "imported", added: res.added, alreadyIn: res.plan.alreadyIn, newClients: res.plan.newClients });
      }
    } catch (e) {
      if (e instanceof ZipError && (e.code === "wrong_password" || e.code === "password_needed")) {
        needsPassword = true;
        out.push({ name: f.name, status: "failed", note: "The saved password didn't open this ZIP. Check it in Settings." });
      } else {
        failed = true;
        out.push({ name: f.name, status: "failed", note: e instanceof ZipError || e instanceof TableError ? e.message : "Couldn't read this file." });
        if (!(e instanceof ZipError || e instanceof TableError)) console.error("Mailback import failed:", e);
      }
    }
  }
  const status = needsPassword ? "needs_password" : failed ? "failed" : out.some((f) => f.status === "imported") ? "imported" : "ignored";
  await db()
    .update(inboxMessages)
    .set({
      status,
      detail: { files: out, added } satisfies InboxDetail,
      // Keep the files only while they can still be retried.
      payloadEnc: status === "needs_password" || status === "failed" ? msg.payloadEnc : null,
    })
    .where(eq(inboxMessages.id, messageId));
  return status;
}

/** After the password is saved: retry every email that was waiting for it. */
export async function retryWaiting(practiceId: string): Promise<number> {
  const waiting = await db()
    .select({ id: inboxMessages.id })
    .from(inboxMessages)
    .where(and(eq(inboxMessages.practiceId, practiceId), inArray(inboxMessages.status, ["needs_password", "failed"])))
    .orderBy(asc(inboxMessages.receivedAt))
    .limit(50);
  const pc = await cryptoOf(practiceId);
  let imported = 0;
  for (const w of waiting) if ((await processMessage(practiceId, w.id, pc)) === "imported") imported++;
  return imported;
}

/** Housekeeping: ignored and confirmation emails go after 30 days, everything else after a year. */
export async function deleteOldInbox(): Promise<void> {
  await db()
    .delete(inboxMessages)
    .where(and(inArray(inboxMessages.status, ["ignored", "waiting"]), lt(inboxMessages.receivedAt, sql`now() - interval '30 days'`)));
  await db().delete(inboxMessages).where(lt(inboxMessages.receivedAt, sql`now() - interval '365 days'`));
}

// ── HTTP entry ────────────────────────────────────────────────────────────────

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Requests from the folio-mail Worker; null for any other path.
 *   POST /__inbox        a received email (raw), recipient in x-folio-to
 *   POST /__inbox/tick   every 30 minutes: NAV import and the morning briefing when due, housekeeping
 */
export async function inboxEndpoint(request: Request, env: { INBOX_TOKEN?: string }): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/__inbox" && url.pathname !== "/__inbox/tick") return null;
  const token = env.INBOX_TOKEN ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (token.length < 32 || request.method !== "POST" || !sameText(given, token)) return new Response("Not found", { status: 404 });
  if (url.pathname === "/__inbox/tick") {
    const nav = await refreshIfDue().catch((e) => ({ error: String(e) }));
    const briefings = await sendBriefingsIfDue().catch((e) => ({ error: String(e) }));
    await deleteOldInbox().catch((e) => console.error("Inbox housekeeping failed:", e));
    await deleteExpiredPortalRows().catch((e) => console.error("Portal housekeeping failed:", e));
    return new Response(JSON.stringify({ nav, briefings }), { headers: { "content-type": "application/json" } });
  }
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > MAX_EMAIL_BYTES) return new Response("Too large", { status: 413 });
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_EMAIL_BYTES) return new Response("Too large", { status: 413 });
  try {
    const res = await receiveEmail(request.headers.get("x-folio-to") ?? "", raw);
    return new Response(res.message, { status: res.status });
  } catch (e) {
    console.error("Inbound email failed:", e);
    return new Response("Failed", { status: 500 });
  }
}
