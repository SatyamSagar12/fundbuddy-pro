import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { acceptInvite, getInvite } from "@/functions/team";
import { AuthFrame, Button, Field, Notice } from "@/components/ui";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/invite")({
  validateSearch: z.object({ token: z.string().optional() }),
  head: () => ({ meta: [{ title: "Join your team · Anqulas Folio" }] }),
  component: InvitePage,
});

type Invite = Awaited<ReturnType<typeof getInvite>>;

function InvitePage() {
  const { token } = Route.useSearch();
  const [invite, setInvite] = useState<Invite | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return setInvite(null);
    getInvite({ data: { token } }).then(setInvite, () => setInvite(null));
  }, [token]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await acceptInvite({
        data: { token: token ?? "", name: String(f.get("name") ?? "") || undefined, password: String(f.get("password") ?? "") },
      });
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
      <AuthFrame title="You've joined">
        <p className="text-muted">You can sign in now.</p>
        <Link to="/login" className="mt-6 inline-flex font-semibold text-bronze underline">
          Sign in
        </Link>
      </AuthFrame>
    );
  }
  if (invite === undefined) return <AuthFrame title="Opening your invitation…">{null}</AuthFrame>;
  if (invite === null) {
    return (
      <AuthFrame title="Invitation not valid">
        <p className="text-muted">This invitation has expired, was withdrawn or was already used. Ask for a new one.</p>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame
      title={`Join ${invite.practiceName}`}
      subtitle={<>as {invite.role === "subbroker" ? "a sub-broker" : "staff"}, with <b>{invite.email}</b></>}
    >
      <form method="post" onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        {invite.hasAccount ? (
          <Field label="Your Anqulas Folio password" name="password" type="password" autoComplete="current-password" required />
        ) : (
          <>
            <Field label="Your name" name="name" autoComplete="name" required />
            <Field label="Choose a password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters." required />
          </>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Joining…" : "Join"}
        </Button>
      </form>
    </AuthFrame>
  );
}
