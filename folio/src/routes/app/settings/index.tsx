import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getPractice, updatePractice } from "@/functions/practice";
import { Button, Card, Field, Notice } from "@/components/ui";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/settings/")({
  loader: () => getPractice(),
  component: SettingsPage,
});

function SettingsPage() {
  const p = Route.useLoaderData();
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setMsg(null);
    try {
      await updatePractice({
        data: { name: String(f.get("name") ?? ""), arn: String(f.get("arn") ?? ""), euin: String(f.get("euin") ?? "") },
      });
      setMsg({ tone: "good", text: "Saved." });
      await router.invalidate();
    } catch (err) {
      setMsg({ tone: "error", text: firstIssue(err) ?? SOMETHING_WRONG });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Practice details</h2>
        <p className="-mt-2 mb-4 text-[15px] text-muted">Shown on your clients' reports and statements.</p>
        <form method="post" onSubmit={onSubmit} className="space-y-4">
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <fieldset disabled={!p.canEdit} className="space-y-4">
            <Field label="Practice name" name="name" defaultValue={p.name} required />
            <Field label="ARN" name="arn" defaultValue={p.arn ?? ""} placeholder="ARN-123456" />
            <Field label="EUIN" name="euin" defaultValue={p.euin ?? ""} placeholder="E123456" />
          </fieldset>
          {p.canEdit ? (
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          ) : (
            <p className="text-sm text-muted">Only the practice owner can change these.</p>
          )}
        </form>
      </Card>
    </div>
  );
}
