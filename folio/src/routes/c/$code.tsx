import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { askPortalCode, enterPortalCode, portalLink, portalSignedIn } from "@/functions/portal";
import { PortalFrame } from "@/components/portal-frame";
import { Button, Card, Field, Notice, order } from "@/components/ui";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

/** A client's sign-in to their distributor's portal: the email on their record, then a code sent to it. */
export const Route = createFileRoute("/c/$code")({
  beforeLoad: async ({ params }) => {
    const s = await portalSignedIn();
    if (s && s.code === params.code.toLowerCase()) throw redirect({ to: "/portal" });
  },
  loader: ({ params }) => portalLink({ data: { code: params.code } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.name} · Your portfolio` : "Your portfolio" }] }),
  component: PortalSignIn,
});

function PortalSignIn() {
  const practice = Route.useLoaderData();
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!practice) {
    return (
      <PortalFrame practice={null}>
        <Card className="mx-auto max-w-md">
          <h1 className="text-[2rem]">This link isn't working</h1>
          <p className="mt-3 text-muted">Ask your mutual fund distributor for the right link to your portfolio.</p>
        </Card>
      </PortalFrame>
    );
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, onOk: () => Promise<void> | void) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fn();
      if (res.ok) await onOk();
      else setError(res.error ?? SOMETHING_WRONG);
    } catch (err) {
      setError(firstIssue(err) ?? SOMETHING_WRONG);
    } finally {
      setBusy(false);
    }
  }

  const ask = (to: string) =>
    run(
      () => askPortalCode({ data: { code, email: to } }),
      () => {
        setEmail(to);
        setInfo(`If ${to} is on ${practice.name}'s records, a 6-digit code is on its way. It works for 10 minutes.`);
      },
    );

  return (
    <PortalFrame practice={practice}>
      <div className="mx-auto max-w-md">
        <p className="eyebrow reveal text-bronze">Your portfolio</p>
        <h1 className="mt-3 text-[2.25rem] sm:text-[2.75rem]">
          <span className="line-mask" style={order(1)}>
            <span>{email ? "Enter your code" : "Sign in"}</span>
          </span>
        </h1>
        <p className="reveal mt-3 text-[15px] leading-relaxed text-muted" style={order(2)}>
          {email
            ? "Check your email for the code. It may take a minute; look in spam too."
            : `See your mutual funds with ${practice.name}: today's value, gains, SIPs and statements.`}
        </p>
        <Card className="mt-7" style={order(3)}>
          {email ? (
            <form
              key="code"
              method="post"
              noValidate
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const otp = String(new FormData(e.currentTarget).get("otp") ?? "");
                void run(
                  () => enterPortalCode({ data: { code, email, otp } }),
                  () => navigate({ to: "/portal" }),
                );
              }}
            >
              {error && <Notice tone="error">{error}</Notice>}
              {info && <Notice tone="good">{info}</Notice>}
              <Field label="6-digit code" name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" required />
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Checking…" : "See my portfolio"}
              </Button>
              <div className="flex flex-wrap justify-between gap-2 text-[15px]">
                <button type="button" className="link-draw font-medium text-bronze" disabled={busy} onClick={() => void ask(email)}>
                  Send a new code
                </button>
                <button
                  type="button"
                  className="link-draw font-medium text-muted"
                  onClick={() => {
                    setEmail(null);
                    setError(null);
                    setInfo(null);
                  }}
                >
                  Use a different email
                </button>
              </div>
            </form>
          ) : (
            <form
              key="email"
              method="post"
              noValidate
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(String(new FormData(e.currentTarget).get("email") ?? "").trim());
              }}
            >
              {error && <Notice tone="error">{error}</Notice>}
              <Field label="Your email" name="email" type="email" autoComplete="email" hint="The one your distributor has for you." required />
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Sending…" : "Send me a code"}
              </Button>
            </form>
          )}
        </Card>
        <p className="reveal mt-6 text-[13px] leading-relaxed text-muted" style={order(4)}>
          Only you and your family see this, and nothing can be changed here. To buy, sell or change a SIP, talk to{" "}
          {practice.name}.
        </p>
      </div>
    </PortalFrame>
  );
}
