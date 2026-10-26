import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getSecurity, regenerateRecoveryCodes } from "@/functions/security";
import { Button, Card, Field, Notice } from "@/components/ui";
import { RecoveryCodes } from "@/components/recovery-codes";
import { SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/settings/security")({
  loader: () => getSecurity(),
  component: SecurityPage,
});

function SecurityPage() {
  const s = Route.useLoaderData();
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    setBusy(true);
    setError(null);
    const res = await regenerateRecoveryCodes({ data: { code } }).catch(() => ({ ok: false as const, error: SOMETHING_WRONG }));
    setBusy(false);
    if (res.ok) setCodes(res.recoveryCodes);
    else setError(res.error);
  }

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-lg font-semibold">Sign-in</h2>
        <p className="mt-1 text-[15px] text-muted">
          Your password and a code from your authenticator app are needed every time you sign in. To change your
          password, sign out and use "Forgot password?".
        </p>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Recovery codes</h2>
        {codes ? (
          <div className="mt-3">
            <RecoveryCodes
              codes={codes}
              doneLabel="Done"
              onDone={() => {
                setCodes(null);
                void router.invalidate();
              }}
            />
          </div>
        ) : (
          <>
            <p className="mt-1 mb-4 text-[15px] text-muted">
              {s.recoveryCodesLeft > 0
                ? `You have ${s.recoveryCodesLeft} unused code${s.recoveryCodesLeft > 1 ? "s" : ""}. Each one gets you back in once if you lose your phone.`
                : "You have no unused recovery codes. Make new ones now."}{" "}
              Making new codes stops the old ones from working.
            </p>
            <form method="post" onSubmit={onSubmit} className="space-y-4">
              {error && <Notice tone="error">{error}</Notice>}
              <Field label="Code from your authenticator app" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
              <Button type="submit" disabled={busy}>
                {busy ? "Checking…" : "Make new recovery codes"}
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
