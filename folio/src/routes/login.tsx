import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { getAuthOptions, login, resendVerification } from "@/functions/auth";
import { z } from "zod";
import { GoogleButton } from "@/components/google-button";
import { AuthFrame, Button, Field, Notice } from "@/components/ui";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

const GOOGLE_ERRORS: Record<string, string> = {
  google_expired: "Google sign-in took too long or was interrupted. Please try again.",
  google_failed: "Google sign-in didn't work. Please try again, or use your email and password.",
  google_unverified: "That Google account's email isn't verified by Google.",
  google_off: "Google sign-in isn't available.",
  too_many: "Too many attempts. Wait 15 minutes.",
};

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ error: z.string().optional() }),
  loader: () => getAuthOptions(),
  head: () => ({ meta: [{ title: "Sign in · Anqulas Folio" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const auth = Route.useLoaderData();
  const { error: errorCode } = Route.useSearch();
  const [error, setError] = useState<string | null>(errorCode ? (GOOGLE_ERRORS[errorCode] ?? SOMETHING_WRONG) : null);
  const [info, setInfo] = useState<string | null>(null);
  // Uncontrolled: text typed before the page finishes loading must not be wiped.
  const emailRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await login({ data: { email: String(f.get("email") ?? ""), password: String(f.get("password") ?? "") } });
      if (res.ok) await navigate({ to: res.next });
      else setError(res.error);
    } catch (err) {
      setError(firstIssue(err) ?? SOMETHING_WRONG);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    await resendVerification({ data: { email: emailRef.current?.value ?? "" } });
    setError(null);
    setInfo("If that account is waiting for confirmation, a new link is on its way.");
  }

  return (
    <AuthFrame title="Sign in">
      <form method="post" onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        {info && <Notice tone="good">{info}</Notice>}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          ref={emailRef}
          required
        />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        {auth.google && <GoogleButton />}
        <p className="text-center text-[15px]">
          <Link to="/forgot-password" className="font-semibold text-bronze underline">
            Forgot password?
          </Link>
        </p>
        {error?.startsWith("Confirm your email") && (
          <Button type="button" variant="secondary" className="w-full" onClick={resend}>
            Send the confirmation link again
          </Button>
        )}
        <p className="text-center text-[15px] text-muted">
          New to Anqulas Folio?{" "}
          <Link to="/signup" className="font-semibold text-bronze underline">
            Start a free trial
          </Link>
        </p>
      </form>
    </AuthFrame>
  );
}

