import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { confirmTotpSetup, getMe, startTotpSetup } from "@/functions/auth";
import { AuthFrame, Button, Field, Notice } from "@/components/ui";
import { SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/two-factor/setup")({
  beforeLoad: async () => {
    const me = await getMe();
    if (!me) throw redirect({ to: "/login" });
    if (me.totpEnabled) throw redirect({ to: me.mfaPassed ? "/app" : "/two-factor" });
  },
  head: () => ({ meta: [{ title: "Set up your authenticator · Anqulas Folio" }] }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [qr, setQr] = useState<{ qrSvg: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    startTotpSetup().then((res) => (res.ok ? setQr(res) : setError(res.error)), () => setError(SOMETHING_WRONG));
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    setBusy(true);
    setError(null);
    const res = await confirmTotpSetup({ data: { code } }).catch(() => ({ ok: false as const, error: SOMETHING_WRONG }));
    setBusy(false);
    if (res.ok) await navigate({ to: "/app" });
    else setError(res.error);
  }

  return (
    <AuthFrame
      title="Protect your account"
      subtitle="Your clients' data needs a code from your phone as well as your password."
    >
      <ol className="mb-5 list-decimal space-y-2 pl-5 text-[15px]">
        <li>
          Install <b>Google Authenticator</b> or <b>Microsoft Authenticator</b> on your phone.
        </li>
        <li>In the app, tap “+” and scan this code.</li>
        <li>Type the 6-digit code it shows.</li>
      </ol>
      {qr ? (
        <div className="mb-5 text-center">
          <div
            className="mx-auto w-[200px] rounded-lg bg-white p-2"
            // The SVG is generated on our server from our own data.
            dangerouslySetInnerHTML={{ __html: qr.qrSvg }}
          />
          <p className="mt-3 text-sm text-muted">Can't scan? Enter this key in the app:</p>
          <p className="mt-1 font-mono text-sm font-semibold tracking-wider" data-testid="totp-secret">
            {qr.secret}
          </p>
        </div>
      ) : (
        !error && <p className="mb-5 text-center text-muted">Preparing your code…</p>
      )}
      <form method="post" onSubmit={onSubmit} className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
        <Button type="submit" disabled={busy || !qr} className="w-full">
          {busy ? "Checking…" : "Turn on and continue"}
        </Button>
      </form>
    </AuthFrame>
  );
}
