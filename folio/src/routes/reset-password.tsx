import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { resetPassword } from "@/functions/auth";
import { AuthFrame, Button, Field, Notice } from "@/components/ui";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/reset-password")({
  validateSearch: z.object({ token: z.string().optional() }),
  head: () => ({ meta: [{ title: "Choose a new password · Anqulas Folio" }] }),
  component: ResetPage,
});

function ResetPage() {
  const { token } = Route.useSearch();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password") ?? "");
    if (password !== String(f.get("confirm") ?? "")) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await resetPassword({ data: { token: token ?? "", password } });
      if (res.ok) setDone(true);
      else setError(res.error);
    } catch (err) {
      setError(firstIssue(err) ?? SOMETHING_WRONG);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthFrame title="Password changed">
        <p className="text-muted">You've been signed out everywhere. Sign in with your new password (and your authenticator code, if you use one).</p>
        <Link to="/login" className="mt-6 inline-flex link-draw font-medium text-bronze">
          Sign in
        </Link>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Choose a new password">
      {!token ? (
        <Notice tone="error">This link is incomplete. Open the link from the email again.</Notice>
      ) : (
        <form method="post" onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="New password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters." required />
          <Field label="Type it again" name="confirm" type="password" autoComplete="new-password" required />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Saving…" : "Save new password"}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
