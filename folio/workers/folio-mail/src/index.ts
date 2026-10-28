/**
 * folio-mail: receives the practices' forwarded mailback emails and wakes Folio on a schedule.
 *
 *  - email:     Cloudflare Email Routing (catch-all on the inbound domain) hands every email here. It is passed,
 *               unread, to Folio's /__inbox, which knows the addresses and does all the checking. Unknown
 *               addresses and oversized emails are bounced.
 *  - scheduled: every 30 minutes, POST /__inbox/tick (NAV import and the 8 am briefing when due). Cloudflare
 *               Pages has no cron of its own.
 *
 * Settings (wrangler.jsonc vars and `wrangler secret put`): FOLIO_URL, INBOX_TOKEN (the same value as Folio's).
 */
type Env = { FOLIO_URL: string; INBOX_TOKEN: string };

const MAX_BYTES = 20 * 1024 * 1024;

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    if (message.rawSize > MAX_BYTES) {
      message.setReject("Email too large for Anqulas Folio (20 MB limit).");
      return;
    }
    const raw = await new Response(message.raw).arrayBuffer();
    const res = await fetch(`${env.FOLIO_URL.replace(/\/+$/, "")}/__inbox`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.INBOX_TOKEN}`,
        "content-type": "message/rfc822",
        "x-folio-to": message.to,
        "x-folio-envelope-from": message.from,
      },
      body: raw,
    });
    if (res.status === 404) message.setReject("No such Anqulas Folio address.");
    else if (res.status === 413) message.setReject("Email too large for Anqulas Folio.");
    // A server error throws, so the sending server keeps the email and tries again later.
    else if (!res.ok) throw new Error(`Folio answered ${res.status}`);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      fetch(`${env.FOLIO_URL.replace(/\/+$/, "")}/__inbox/tick`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.INBOX_TOKEN}` },
      }).then(async (r) => console.log(`tick: ${r.status} ${(await r.text()).slice(0, 300)}`)),
    );
  },
} satisfies ExportedHandler<Env>;
