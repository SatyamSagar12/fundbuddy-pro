import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { getAuthOptions, signup } from "@/functions/auth";
import { GoogleButton } from "@/components/google-button";
import { AuthFrame, Button, Field, Notice } from "@/components/ui";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/signup")({
  loader: () => getAuthOptions(),
  head: () => ({ meta: [{ title: "Start your free trial · Anqulas Folio" }] }),
  component: SignupPage,
});

function SignupPage() {
  const auth = Route.useLoaderData();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data = {
      practiceName: String(f.get("practiceName") ?? ""),
      name: String(f.get("name") ?? ""),
      email: String(f.get("email") ?? ""),
      password: String(f.get("password") ?? ""),
      arn: String(f.get("arn") ?? ""),
    };
    setBusy(true);
    setError(null);
    try {
      const res = await signup({ data });
      if (res.ok) {
        setSentTo(data.email);
        setAwaitingApproval(!res.emailSent);
        setApproved(res.approved === true);
      }
      else setError(res.error);
    } catch (err) {
      setError(firstIssue(err) ?? SOMETHING_WRONG);
    } finally {
      setBusy(false);
    }
  }

  if (sentTo && approved) {
    return (
      <AuthFrame title="Account created" subtitle={<>for <b>{sentTo}</b></>}>
        <p className="text-muted">You're the platform admin. You can sign in now.</p>
        <p className="mt-6">
          <Link to="/login" className="font-semibold text-bronze underline">
            Sign in
          </Link>
        </p>
      </AuthFrame>
    );
  }

  if (sentTo && awaitingApproval) {
    return (
      <AuthFrame title="Account created" subtitle={<>for <b>{sentTo}</b></>}>
        <p className="text-muted">
          Anqulas Folio is in early access. We'll approve your account shortly; you can then sign in with this email and
          password.
        </p>
        <p className="mt-6">
          <Link to="/login" className="font-semibold text-bronze underline">
            Go to sign in
          </Link>
        </p>
      </AuthFrame>
    );
  }

  if (sentTo) {
    return (
      <AuthFrame title="Check your email" subtitle={<>We sent a confirmation link to <b>{sentTo}</b>.</>}>
        <p className="text-muted">Open it to finish setting up. It can take a minute; check spam if you don't see it.</p>
        <p className="mt-6">
          <Link to="/login" className="font-semibold text-bronze underline">
            Back to sign in
          </Link>
        </p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Start your free trial" subtitle="30 days free. No card needed.">
      <form method="post" onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Your practice or business name" name="practiceName" autoComplete="organization" required />
        <Field label="Your name" name="name" autoComplete="name" required />
        <Field label="Work email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters."
          required
        />
        <Field label="ARN (optional)" name="arn" placeholder="ARN-123456" hint="Shown on your clients' reports." />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Creating…" : "Create account"}
        </Button>
        {auth.google && <GoogleButton />}
        <p className="text-center text-[15px] text-muted">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-bronze underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthFrame>
  );
}

