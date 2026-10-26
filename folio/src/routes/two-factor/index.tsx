import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { getMe, logout, verifyTotpCode } from "@/functions/auth";
import { AuthFrame, Button, Field, Notice } from "@/components/ui";
import { SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/two-factor/")({
  beforeLoad: async () => {
    const me = await getMe();
    if (!me) throw redirect({ to: "/login" });
    if (!me.totpEnabled) throw redirect({ to: "/two-factor/setup" });
    if (me.mfaPassed) throw redirect({ to: "/app" });
  },
  head: () => ({ meta: [{ title: "Enter your code · Anqulas Folio" }] }),
  component: VerifyCodePage,
});

function VerifyCodePage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    setBusy(true);
    setError(null);
    const res = await verifyTotpCode({ data: { code } }).catch(() => ({ ok: false as const, error: SOMETHING_WRONG }));
    setBusy(false);
    if (res.ok) await navigate({ to: "/app" });
    else setError(res.error);
  }

  return (
    <AuthFrame title="Enter your code" subtitle="Open your authenticator app and type the 6-digit code for Anqulas Folio.">
      <form method="post" onSubmit={onSubmit} className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus required />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Checking…" : "Continue"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={async () => {
            await logout();
            await navigate({ to: "/login" });
          }}
        >
          Use a different account
        </Button>
      </form>
    </AuthFrame>
  );
}
