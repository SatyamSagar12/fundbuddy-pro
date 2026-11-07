import { useMemo, useState } from "react";
import { Crown, Search } from "lucide-react";
import { Button, Card, Field, inputClass, Notice } from "./ui";
import { familyProblem, familySchema, type FamilyForm } from "@/lib/families";

type Client = { id: string; name: string; mobile: string | null; familyId: string | null; family: string | null };

/** Create or edit a family: its name, its members (ticked from the client list) and its head. */
export function FamilyFormView({
  familyId,
  initial,
  clients,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  familyId: string | null;
  initial: FamilyForm;
  clients: readonly Client[];
  submitLabel: string;
  onSubmit: (family: FamilyForm) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FamilyForm>(initial);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const chosen = new Set(form.memberIds);
  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    // Members first, then everyone else, so the family is easy to check at a glance.
    return clients
      .filter((c) => !text || c.name.toLowerCase().includes(text) || (c.mobile ?? "").includes(text))
      .sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)) || a.name.localeCompare(b.name))
      .slice(0, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, q, form.memberIds]);

  function toggle(id: string) {
    setForm((f) => {
      const on = f.memberIds.includes(id);
      const memberIds = on ? f.memberIds.filter((x) => x !== id) : [...f.memberIds, id];
      // The first member chosen becomes the head; taking the head out clears it.
      const headId = on && f.headId === id ? (memberIds[0] ?? null) : (f.headId ?? (on ? null : id));
      return { ...f, memberIds, headId };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = familySchema.safeParse(form);
    if (!parsed.success) {
      const nameIssue = parsed.error.issues.find((i) => i.path[0] === "name");
      setNameError(nameIssue?.message);
      setError(parsed.error.issues.find((i) => i.path[0] !== "name")?.message ?? (nameIssue ? "Please correct the highlighted field." : null));
      return;
    }
    const problem = familyProblem(parsed.data);
    if (problem) return setError(problem);
    setNameError(undefined);
    setError(null);
    setBusy(true);
    const res = await onSubmit(parsed.data);
    setBusy(false);
    if (res) setError(res);
  }

  return (
    <form method="post" onSubmit={submit} className="space-y-5" noValidate>
      {error && <Notice tone="error">{error}</Notice>}
      <Card>
        <Field
          label="Family name"
          name="name"
          placeholder="Sharma family"
          autoComplete="off"
          value={form.name}
          error={nameError}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </Card>

      <Card className="!p-0">
        <div className="space-y-3 px-5 pt-5 pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Members</h2>
            <p className="text-sm text-muted">
              {form.memberIds.length} chosen · tap <Crown size={13} className="inline -translate-y-px text-bronze" /> to make someone the head
            </p>
          </div>
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 z-10 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a client by name or mobile"
              aria-label="Find a client"
              className={`${inputClass} !pl-10`}
            />
          </div>
        </div>
        <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto border-t border-line">
          {shown.map((c) => {
            const on = chosen.has(c.id);
            const elsewhere = c.familyId && c.familyId !== familyId ? c.family : null;
            return (
              <li key={c.id} className="flex items-center gap-3 px-5 py-2.5">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={on} onChange={() => toggle(c.id)} className="size-5 shrink-0 accent-[var(--bronze)]" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-[13px] text-muted">
                      {[c.mobile, elsewhere ? `now in ${elsewhere}${on ? " (will move here)" : ""}` : null].filter(Boolean).join(" · ") || " "}
                    </span>
                  </span>
                </label>
                {on && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, headId: c.id }))}
                    aria-pressed={form.headId === c.id}
                    aria-label={form.headId === c.id ? `${c.name} is the head` : `Make ${c.name} the head`}
                    className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${form.headId === c.id ? "bg-bronze/15 text-bronze" : "text-muted hover:bg-soft"}`}
                  >
                    <Crown size={14} /> {form.headId === c.id ? "Head" : "Make head"}
                  </button>
                )}
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-5 py-6 text-center text-muted">No client matches that.</li>}
        </ul>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
