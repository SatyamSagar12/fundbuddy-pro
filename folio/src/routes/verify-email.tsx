import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { verifyEmail } from "@/functions/auth";
import { AuthFrame, Button, Notice } from "@/components/ui";

export const Route = createFileRoute("/verify-email")({
  validateSearch: z.object({ token: z.string().optional() }),
  head: () => ({ meta: [{ title: "Confirm your email · Anqulas Folio" }] }),
  component: VerifyPage,
});

// Opening the link does nothing by itself (email scanners open links); the button confirms.
function VerifyPage() {
  const { token } = Route.useSearch();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!token) return;
    setState("busy");
    const res = await verifyEmail({ data: { token } });
    if (res.ok) setState("done");
    else {
      setError(res.error);
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <AuthFrame title="Email confirmed">
        <p className="text-muted">You can sign in now.</p>
        <Link to="/login" className="mt-6 inline-flex font-semibold text-bronze underline">
          Sign in
        </Link>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Confirm your email">
      <div className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        {!token ? (
          <Notice tone="error">This link is incomplete. Open the link from the email again.</Notice>
        ) : (
          <Button onClick={confirm} disabled={state === "busy"} className="w-full">
            {state === "busy" ? "Confirming…" : "Confirm my email"}
          </Button>
        )}
      </div>
    </AuthFrame>
  );
}
