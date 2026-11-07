import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Copy, MessageCircle } from "lucide-react";
import { useState } from "react";
import { getPortalSettings, setPortalEnabled } from "@/functions/portal";
import { Button, Card, Notice, PageHeader } from "@/components/ui";
import { SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/portal")({
  loader: () => getPortalSettings(),
  head: () => ({ meta: [{ title: "Client portal · Anqulas Folio" }] }),
  component: PortalSettingsPage,
});

function PortalSettingsPage() {
  const s = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function toggle(enabled: boolean) {
    if (!enabled && !confirm("Turn off the client portal? Clients who are signed in are signed out at once.")) return;
    setBusy(true);
    setError(null);
    const res = await setPortalEnabled({ data: { enabled } }).catch(() => ({ ok: false as const }));
    setBusy(false);
    if (!res.ok) return setError(SOMETHING_WRONG);
    await router.invalidate();
  }

  const whatsapp = s.link
    ? `https://wa.me/?text=${encodeURIComponent(`See your mutual fund portfolio with me at any time: ${s.link}\nSign in with the email I have for you; you'll get a code each time.`)}`
    : "";

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="Client portal"
        subtitle="Your clients see their own and their family's portfolio on their phone, with your name, ARN and EUIN. They can't change anything."
      />
      {error && <Notice tone="error">{error}</Notice>}
      {!s.emailWorks && (
        <Notice tone="warn">Email isn't set up yet, so clients can't get their sign-in code. Ask Anqulas to switch on email for your account.</Notice>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{s.enabled ? "The portal is on" : "The portal is off"}</h2>
            <p className="mt-1 text-[15px] text-muted">
              {s.enabled
                ? "Clients sign in with the email on their record and a code we send to it."
                : s.canEdit
                  ? "Turn it on to get your portal link."
                  : "Only the practice owner can turn it on."}
            </p>
          </div>
          {s.canEdit && (
            <Button variant={s.enabled ? "secondary" : "primary"} disabled={busy} onClick={() => void toggle(!s.enabled)}>
              {s.enabled ? "Turn off" : "Turn on the portal"}
            </Button>
          )}
        </div>
        {s.enabled && s.link && (
          <div className="mt-5 space-y-3 border-t border-line pt-5">
            <p className="eyebrow text-muted">Your portal link</p>
            <p className="font-mono text-[15px] break-all" data-testid="portal-link">
              {s.link}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(s.link!).then(() => setCopied(true));
                }}
              >
                <Copy size={16} /> {copied ? "Copied" : "Copy link"}
              </Button>
              <a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-card px-5 text-[15px] font-medium hover:bg-soft">
                <MessageCircle size={16} /> Share on WhatsApp
              </a>
            </div>
            <p className="text-[13px] text-muted">You can also email the link to one client from their page.</p>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Who can sign in</h2>
        <ul className="mt-3 space-y-2 text-[15px]">
          <li>
            <strong>
              {s.withEmail} of {s.all}
            </strong>{" "}
            clients have an email. Each sees their own money and their family's (Clients → Families).
          </li>
          <li>Clients without an email can't sign in yet. Add it on their page.</li>
        </ul>
        {s.shared.length > 0 && (
          <div className="mt-4">
            <Notice tone="warn">
              <p className="font-semibold">These emails are on clients of different families, so nobody can sign in with them:</p>
              <ul className="mt-2 space-y-1">
                {s.shared.map((x) => (
                  <li key={x.email}>
                    {x.email}: {x.names}
                  </li>
                ))}
              </ul>
              <p className="mt-2">Put each person's own email on their record, or put them in one family.</p>
            </Notice>
          </div>
        )}
      </Card>
    </div>
  );
}
