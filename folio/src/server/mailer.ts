/**
 * Outgoing email through Amazon SES (Mumbai). Without SES keys (local development), mail is printed to
 * the console and kept in memory for the dev outbox page (/dev/outbox), which only works locally.
 */
import { AwsClient } from "aws4fetch";
import { appEnv } from "./env";

export type Mail = { to: string; subject: string; text: string };

const devOutbox: (Mail & { at: string })[] = [];

export function readDevOutbox(): readonly (Mail & { at: string })[] {
  return devOutbox;
}

export function sesConfigured(): boolean {
  const e = appEnv();
  return Boolean(e.SES_ACCESS_KEY_ID && e.SES_SECRET_ACCESS_KEY);
}

export async function sendMail(mail: Mail): Promise<void> {
  const e = appEnv();
  if (!sesConfigured()) {
    devOutbox.unshift({ ...mail, at: new Date().toISOString() });
    devOutbox.length = Math.min(devOutbox.length, 50);
    console.log(`[mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return;
  }
  const aws = new AwsClient({
    accessKeyId: e.SES_ACCESS_KEY_ID!,
    secretAccessKey: e.SES_SECRET_ACCESS_KEY!,
    region: e.SES_REGION,
    service: "ses",
  });
  const res = await aws.fetch(`https://email.${e.SES_REGION}.amazonaws.com/v2/email/outbound-emails`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      FromEmailAddress: e.MAIL_FROM,
      Destination: { ToAddresses: [mail.to] },
      Content: {
        Simple: {
          Subject: { Data: mail.subject, Charset: "UTF-8" },
          Body: { Text: { Data: mail.text, Charset: "UTF-8" } },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`SES send failed: ${res.status} ${await res.text()}`);
}
