import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Check, Copy, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteInboxMessage, getInbox, renewInboxAddress, retryInboxMessage, saveMailbackPassword } from "@/functions/inbox";
import { Button, Card, Field, Notice, textLink } from "@/components/ui";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/settings/mail")({
  loader: () => getInbox(),
  head: () => ({ meta: [{ title: "Email import · Anqulas Folio" }] }),
  component: MailSettings,
});

const STATUS: Record<string, { label: string; tone: string }> = {
  imported: { label: "Imported", tone: "text-good" },
  needs_password: { label: "Needs the ZIP password", tone: "text-warn" },
  failed: { label: "Couldn't import", tone: "text-bad" },
  ignored: { label: "Not imported", tone: "text-muted" },
  waiting: { label: "Opening…", tone: "text-muted" },
};

const FILTER_FROM = "camsonline.com OR kfintech.com OR karvy.com";

function MailSettings() {
  const d = Route.useLoaderData();
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* the text is selectable anyway */
    }
  }

  async function savePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMsg(null);
    try {
      const res = await saveMailbackPassword({ data: { password: String(new FormData(form).get("password") ?? "") } });
      form.reset();
      setMsg({ tone: "good", text: res.imported ? `Saved. ${res.imported} waiting email${res.imported > 1 ? "s" : ""} imported.` : "Password saved." });
      await router.invalidate();
    } catch (err) {
      setMsg({ tone: "error", text: firstIssue(err) ?? SOMETHING_WRONG });
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      setMsg({ tone: "good", text: done });
      await router.invalidate();
    } catch {
      setMsg({ tone: "error", text: SOMETHING_WRONG });
    } finally {
      setBusy(false);
    }
  }

  const CopyButton = ({ text, label }: { text: string; label: string }) => (
    <button type="button" onClick={() => void copy(text)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium hover:bg-soft" aria-label={label}>
      {copied === text ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied === text ? "Copied" : "Copy"}
    </button>
  );

  return (
    <div className="space-y-5">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card>
        <h2 className="text-lg font-semibold">Automatic import from email</h2>
        <p className="mt-1 text-[15px] text-muted">
          CAMS and KFintech email you transaction reports every day. Forward them to Folio once, and every client's
          transactions, SIPs and values update by themselves, with nothing to upload.
        </p>
        {d.address ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-field p-3">
            <code className="min-w-0 flex-1 truncate text-[15px] font-medium select-all">{d.address}</code>
            <CopyButton text={d.address} label="Copy your Folio address" />
          </div>
        ) : (
          <Notice>
            Email import is being switched on for Folio. Until then, upload the files on the{" "}
            <Link to="/app/import" className={textLink}>
              Import page
            </Link>
            .
          </Notice>
        )}
        {d.address && (
          <p className="mt-2 text-[13px] text-muted">
            Your private Folio address. Only emails from CAMS and KFintech with a ZIP that opens with your password are
            imported; everything else is ignored.
            {d.canRenew && (
              <>
                {" "}
                <button
                  type="button"
                  className="link-draw font-medium text-bronze"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Make a new address? The old one stops working, and you'll need to set up Gmail forwarding again.")) void act(() => renewInboxAddress(), "New address made. Update your Gmail forwarding.");
                  }}
                >
                  Make a new address
                </button>
              </>
            )}
          </p>
        )}
        {d.working && <p className="mt-3 text-[15px] font-medium text-good">✓ Working: emails are arriving and importing.</p>}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Mailback ZIP password</h2>
        <p className="mt-1 mb-4 text-[15px] text-muted">
          The password you give CAMS and KFintech when you ask for reports. Use the same one for both. It is stored
          encrypted, and only used to open these files.
        </p>
        <form onSubmit={savePassword} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <Field label={d.hasPassword ? "Change the password" : "Password"} name="password" type="password" autoComplete="off" placeholder={d.hasPassword ? "Saved ••••••••" : ""} />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </form>
      </Card>

      {d.address && (
        <Card>
          <h2 className="text-lg font-semibold">Set up Gmail (once, about 2 minutes)</h2>
          <p className="mt-1 text-[15px] text-muted">Do this on a computer, in the Gmail account where CAMS and KFintech send your reports.</p>
          <ol className="mt-4 space-y-5 text-[15px]">
            <li>
              <b>1. Add Folio as a forwarding address.</b> Open{" "}
              <a href="https://mail.google.com/mail/u/0/#settings/fwdandpop" target="_blank" rel="noreferrer" className={textLink}>
                Gmail → Settings → Forwarding and POP/IMAP
              </a>
              , click <i>Add a forwarding address</i>, paste your Folio address, then <i>Next</i> and <i>Proceed</i>. Leave
              the rest of that page as it is: only CAMS and KFintech emails will be forwarded (step 3).
            </li>
            <li>
              <b>2. Confirm it.</b> Gmail sends a code to Folio. It appears here:
              {d.forwarding && !d.confirmation ? (
                <div className="mt-2 rounded-xl border border-good/30 bg-good-soft p-3 font-medium text-good">✓ Done: emails are being forwarded.</div>
              ) : d.confirmation ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-good/30 bg-good-soft p-3">
                  <span className="text-[13px] text-muted">Gmail's code{d.confirmation.requester ? ` for ${d.confirmation.requester}` : ""}</span>
                  <code className="text-xl font-semibold tracking-widest select-all">{d.confirmation.code ?? "—"}</code>
                  {d.confirmation.code && <CopyButton text={d.confirmation.code} label="Copy the code" />}
                  {d.confirmation.link && (
                    <a href={d.confirmation.link} target="_blank" rel="noreferrer" className={textLink}>
                      or confirm with Gmail's link
                    </a>
                  )}
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line p-3 text-muted">
                  Waiting for Gmail's code…
                  <button type="button" className="inline-flex items-center gap-1 font-medium text-bronze" onClick={() => void router.invalidate()}>
                    <RefreshCw size={14} aria-hidden /> Check again
                  </button>
                </div>
              )}
              <span className="mt-2 block">
                Back in Gmail, type the code under <i>Forwarding</i> and click <i>Verify</i>.
              </span>
            </li>
            <li>
              <b>3. Forward only CAMS and KFintech emails.</b> In Gmail's search bar, click the options icon on the right
              and put this in <i>From</i>:
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-field p-3">
                <code className="min-w-0 flex-1 truncate select-all">{FILTER_FROM}</code>
                <CopyButton text={FILTER_FROM} label="Copy the filter" />
              </div>
              <span className="mt-2 block">
                Click <i>Create filter</i>, tick <i>Forward it to</i>, choose your Folio address, and click <i>Create filter</i>.
              </span>
            </li>
            <li>
              <b>4. Ask for daily reports.</b> On the CAMS and KFintech distributor websites, schedule the daily
              transaction mailback (CAMS: WBR2; KFintech: MFSD201) to come to this Gmail, with the password you saved
              above. From then on, each day's transactions arrive and import by themselves.
            </li>
          </ol>
        </Card>
      )}

      <Card className="!p-0">
        <div className="px-5 pt-5 pb-2">
          <h2 className="text-lg font-semibold">Received emails</h2>
        </div>
        {d.messages.length === 0 ? (
          <p className="px-5 pb-5 text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {d.messages.map((m) => (
              <li key={m.id} className="px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.subject || "(no subject)"}</p>
                    <p className="truncate text-[13px] text-muted">
                      {m.from} · {new Date(m.receivedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`text-sm font-medium ${STATUS[m.status]?.tone ?? "text-muted"}`}>
                      {STATUS[m.status]?.label ?? m.status}
                      {m.status === "imported" && m.detail.added !== undefined ? ` · ${m.detail.added} new` : ""}
                    </span>
                    {(m.status === "failed" || m.status === "needs_password") && (
                      <button type="button" disabled={busy} aria-label="Try again" className="rounded-lg p-2 text-muted hover:text-text" onClick={() => void act(() => retryInboxMessage({ data: { id: m.id } }), "Tried again.")}>
                        <RefreshCw size={16} />
                      </button>
                    )}
                    <button type="button" disabled={busy} aria-label="Delete" className="rounded-lg p-2 text-muted hover:text-bad" onClick={() => void act(() => deleteInboxMessage({ data: { id: m.id } }), "Deleted.")}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {(m.detail.files?.length || m.detail.note) && (
                  <ul className="mt-1 space-y-0.5 text-[13px] text-muted">
                    {m.detail.note && <li>{m.detail.note}</li>}
                    {m.detail.files?.map((f, i) => (
                      <li key={i}>
                        {f.name}:{" "}
                        {f.status === "imported"
                          ? `${f.added ?? 0} new transactions${f.alreadyIn ? `, ${f.alreadyIn} already in` : ""}${f.newClients ? `, ${f.newClients} new clients` : ""}`
                          : f.note}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
