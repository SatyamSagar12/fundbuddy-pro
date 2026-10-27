import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getTeam, inviteMember, revokeInvite, updateMember } from "@/functions/team";
import { Button, Card, Field, Notice } from "@/components/ui";
import { day } from "@/lib/format";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/settings/team")({
  loader: () => getTeam(),
  component: TeamPage,
});

const ROLE: Record<string, string> = { owner: "Owner", staff: "Staff", subbroker: "Sub-broker" };

function TeamPage() {
  const t = Route.useLoaderData();
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await action();
      setMsg(res.ok ? { tone: "good", text: success } : { tone: "error", text: res.error ?? SOMETHING_WRONG });
      await router.invalidate();
    } catch (err) {
      setMsg({ tone: "error", text: firstIssue(err) ?? SOMETHING_WRONG });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Card className="!p-0">
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="text-lg font-semibold">Team</h2>
          <span className="text-sm text-muted">
            {t.seats.used} of {t.seats.max} places used
          </span>
        </div>
        <ul className="divide-y divide-line">
          {t.members.map((m) => (
            <li key={m.userId} className="ink-sweep flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {m.name} {m.isMe && <span className="font-normal text-muted">(you)</span>}
                </p>
                <p className="truncate text-sm text-muted">
                  {m.email} · {ROLE[m.role] ?? m.role}
                  {!m.active && " · switched off"}
                </p>
              </div>
              {t.canManage && m.role !== "owner" && (
                <div className="flex gap-2">
                  {m.active && (
                    <select
                      aria-label={`Role of ${m.name}`}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) =>
                        void run(() => updateMember({ data: { userId: m.userId, role: e.target.value as "staff" | "subbroker" } }), "Role changed.")
                      }
                      className="min-h-10 rounded-lg border border-line bg-field px-2 text-[15px]"
                    >
                      <option value="staff">Staff</option>
                      <option value="subbroker">Sub-broker</option>
                    </select>
                  )}
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => updateMember({ data: { userId: m.userId, active: !m.active } }),
                        m.active ? `${m.name} can no longer sign in to your practice.` : `${m.name} is back on.`,
                      )
                    }
                  >
                    {m.active ? "Switch off" : "Switch on"}
                  </Button>
                </div>
              )}
            </li>
          ))}
          {t.pending.map((i) => (
            <li key={i.id} className="ink-sweep flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="truncate font-semibold">{i.email}</p>
                <p className="text-sm text-muted">
                  Invited as {ROLE[i.role]} · link works until {day(i.expiresAt)}
                </p>
              </div>
              <Button variant="secondary" disabled={busy} onClick={() => void run(() => revokeInvite({ data: { id: i.id } }), "Invitation withdrawn.")}>
                Withdraw
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      {t.canManage ? (
        <Card>
          <h2 className="text-lg font-semibold">Invite someone</h2>
          <p className="mt-1 mb-4 text-[15px] text-muted">
            <b>Staff</b> see every client. <b>Sub-brokers</b> see only the clients you assign to them.
          </p>
          <form
            method="post"
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              void run(
                () => inviteMember({ data: { email: String(f.get("email") ?? ""), role: f.get("role") === "subbroker" ? "subbroker" : "staff" } }),
                "Invitation sent.",
              ).then(() => form.reset());
            }}
          >
            <Field label="Their email" name="email" type="email" required />
            <fieldset className="space-y-2">
              <legend className="text-[15px] font-semibold">Access</legend>
              <label className="flex items-center gap-2 text-[15px]">
                <input type="radio" name="role" value="staff" defaultChecked /> Staff
              </label>
              <label className="flex items-center gap-2 text-[15px]">
                <input type="radio" name="role" value="subbroker" /> Sub-broker
              </label>
            </fieldset>
            <Button type="submit" disabled={busy}>
              Send invitation
            </Button>
          </form>
        </Card>
      ) : (
        <p className="text-sm text-muted">Only the practice owner can invite or change team members.</p>
      )}
    </div>
  );
}
