import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { forgotPassword } from "@/functions/auth";
import { AuthFrame, Button, Field, Notice } from "@/components/ui";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot password · Anqulas Folio" }] }),
  component: ForgotPage,
});

function ForgotPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setBusy(true);
    setError(null);
    try {
      await forgotPassword({ data: { email } });
      setSent(true);
    } catch (err) {
      setError(firstIssue(err) ?? SOMETHING_WRONG);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Forgot your password?">
      {sent ? (
        <div className="space-y-4">
          <Notice tone="good">If that email has an account, a link to choose a new password is on its way. It works for 60 minutes.</Notice>
          <Link to="/login" className="link-draw font-medium text-bronze">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form method="post" onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="Email" name="email" type="email" autoComplete="username" required />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Sending…" : "Send reset link"}
          </Button>
          <p className="text-center text-[15px]">
            <Link to="/login" className="link-draw font-medium text-bronze">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthFrame>
  );
}
