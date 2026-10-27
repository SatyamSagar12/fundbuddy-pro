import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getSecurity, regenerateRecoveryCodes } from "@/functions/security";
import { disableTotp } from "@/functions/auth";
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
  const [msg, setMsg] = useState<{ tone: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [turningOff, setTurningOff] = useState(false);

  async function codeAction(e: React.FormEvent<HTMLFormElement>, kind: "codes" | "off") {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    setBusy(true);
    setMsg(null);
    const fail = { ok: false as const, error: SOMETHING_WRONG };
    if (kind === "codes") {
      const res = await regenerateRecoveryCodes({ data: { code } }).catch(() => fail);
      if (res.ok) setCodes(res.recoveryCodes);
      else setMsg({ tone: "error", text: res.error });
    } else {
      const res = await disableTotp({ data: { code } }).catch(() => fail);
      if (res.ok) {
        setTurningOff(false);
        setMsg({ tone: "good", text: "Authenticator turned off. You'll sign in with your password only." });
        await router.invalidate();
      } else setMsg({ tone: "error", text: res.error });
    }
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Card>
        <h2 className="text-lg font-semibold">Authenticator app</h2>
        {s.totpEnabled ? (
          <>
            <p className="mt-1 text-[15px]" data-testid="totp-status">
              <b className="text-good">On.</b> Signing in needs your password and a code from your phone.
            </p>
            {s.totpRequired ? (
              <p className="mt-2 text-sm text-muted">Your practice requires it, so it can't be turned off.</p>
            ) : turningOff ? (
              <form method="post" onSubmit={(e) => void codeAction(e, "off")} className="mt-4 space-y-4">
                <Field label="Code from your authenticator app" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
                <div className="flex gap-2">
                  <Button type="submit" variant="secondary" disabled={busy}>
                    Turn off
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setTurningOff(false)}>
                    Keep it on
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="ghost" className="mt-2 !px-0" onClick={() => setTurningOff(true)}>
                Turn off…
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="mt-1 text-[15px]" data-testid="totp-status">
              <b>Off.</b> You sign in with your password only. Turning it on means someone who learns your password still
              can't see your clients' data without your phone.
            </p>
            <Link
              to="/two-factor/setup"
              className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-ink px-5 text-[15px] font-semibold text-paper"
            >
              Turn on
            </Link>
          </>
        )}
      </Card>

      {s.totpEnabled && (
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
              <form method="post" onSubmit={(e) => void codeAction(e, "codes")} className="space-y-4">
                <Field label="Code from your authenticator app" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
                <Button type="submit" disabled={busy}>
                  {busy ? "Checking…" : "Make new recovery codes"}
                </Button>
              </form>
            </>
          )}
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold">Password</h2>
        <p className="mt-1 text-[15px] text-muted">To change your password, sign out and use "Forgot password?" on the sign-in page.</p>
      </Card>
    </div>
  );
}
