import { useState } from "react";
import { Button, Card, Field, Notice, SelectField, TextAreaField } from "./ui";
import { clientSchema, NOMINEE_RELATIONS, type ClientForm } from "@/lib/records";

type Errors = Partial<Record<keyof ClientForm, string>>;

/** Add or edit a client. Checks every field in the browser first; the server checks again. */
export function ClientFormView({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ClientForm;
  submitLabel: string;
  onSubmit: (client: ClientForm) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ClientForm>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bind = (name: keyof ClientForm) => ({
    name,
    value: form[name],
    error: errors[name],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [name]: e.target.value })),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = clientSchema.safeParse(form);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ClientForm;
        next[key] ??= issue.message;
      }
      setErrors(next);
      setError("Please correct the highlighted fields.");
      return;
    }
    setErrors({});
    setError(null);
    setBusy(true);
    const problem = await onSubmit(parsed.data);
    setBusy(false);
    if (problem) setError(problem);
  }

  return (
    <form method="post" onSubmit={submit} className="space-y-5" noValidate>
      {error && <Notice tone="error">{error}</Notice>}
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Client</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Full name" autoComplete="off" required {...bind("name")} />
          </div>
          <Field label="Mobile" inputMode="numeric" maxLength={10} {...bind("mobile")} />
          <Field label="Email" type="email" {...bind("email")} />
          <Field label="PAN" maxLength={10} placeholder="ABCDE1234F" {...bind("pan")} />
          <Field label="Date of birth" type="date" {...bind("dob")} />
          <div className="sm:col-span-2">
            <TextAreaField label="Address" {...bind("address")} />
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Bank account</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account number" inputMode="numeric" maxLength={18} {...bind("bankAccountNo")} />
          <Field label="Bank name" {...bind("bankName")} />
          <Field label="IFSC" maxLength={11} placeholder="HDFC0001234" {...bind("ifsc")} />
          <Field label="MICR" inputMode="numeric" maxLength={9} {...bind("micr")} />
          <div className="sm:col-span-2">
            <Field label="Branch" {...bind("branch")} />
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Nominee</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nominee name" {...bind("nomineeName")} />
          <SelectField
            label="Relation"
            placeholder="Choose"
            options={NOMINEE_RELATIONS.map((r) => ({ value: r, label: r }))}
            {...bind("nomineeRelation")}
          />
          <Field label="Nominee date of birth" type="date" {...bind("nomineeDob")} />
          <Field label="Nominee PAN" maxLength={10} {...bind("nomineePan")} />
          <Field label="Nominee mobile" inputMode="numeric" maxLength={10} {...bind("nomineeMobile")} />
          <Field label="Nominee email" type="email" {...bind("nomineeEmail")} />
        </div>
      </Card>

      <Card>
        <TextAreaField label="Notes (only your team sees these)" {...bind("notes")} />
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
