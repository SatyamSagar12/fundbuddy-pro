import { useEffect, useState, type ButtonHTMLAttributes, type ComponentPropsWithRef, type ReactNode } from "react";
import { clsx } from "clsx";

/** False during server rendering and until the page's scripts have started in the browser. */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  // Before the page is ready, a click would submit the form natively and just reload it.
  const hydrated = useHydrated();
  return (
    <button
      {...props}
      disabled={props.disabled || !hydrated}
      className={clsx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" && "bg-ink text-paper hover:bg-ink-2",
        variant === "secondary" && "border border-line bg-card text-text hover:border-bronze",
        variant === "ghost" && "text-muted hover:text-text",
        className,
      )}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  ...props
}: ComponentPropsWithRef<"input"> & { label: string; hint?: ReactNode; error?: string | undefined }) {
  const id = props.id ?? props.name;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[15px] font-semibold">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="block min-h-12 w-full rounded-lg border border-line bg-white px-3.5 text-[17px] outline-none transition-colors focus:border-bronze"
      />
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-2xl border border-line bg-card p-6", className)}>{children}</div>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "good"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={clsx(
        "rounded-lg border px-4 py-3 text-[15px]",
        tone === "info" && "border-line bg-paper",
        tone === "error" && "border-bad/30 bg-bad/5 text-bad",
        tone === "good" && "border-good/30 bg-good/5 text-good",
      )}
    >
      {children}
    </div>
  );
}

/** Page frame for signed-out screens: logo, title, one card. */
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-bronze">Anqulas Folio</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
        </div>
        <Card>{children}</Card>
      </div>
    </main>
  );
}

const fieldClass =
  "block min-h-12 w-full rounded-lg border border-line bg-white px-3.5 text-[17px] outline-none transition-colors focus:border-bronze";

export function SelectField({
  label,
  options,
  error,
  placeholder,
  ...props
}: ComponentPropsWithRef<"select"> & {
  label: string;
  options: readonly { value: string; label: string }[];
  error?: string | undefined;
  placeholder?: string;
}) {
  const id = props.id ?? props.name;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[15px] font-semibold">
        {label}
      </label>
      <select id={id} {...props} className={fieldClass}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

export function TextAreaField({
  label,
  error,
  ...props
}: ComponentPropsWithRef<"textarea"> & { label: string; error?: string | undefined }) {
  const id = props.id ?? props.name;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[15px] font-semibold">
        {label}
      </label>
      <textarea id={id} rows={3} {...props} className={`${fieldClass} py-2.5`} />
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

/** Page title row with an optional action on the right. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/** Styled like a primary button, for navigation links. */
export const linkButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ink px-5 text-[15px] font-semibold text-paper hover:bg-ink-2";
export const linkButtonSecondary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-card px-5 text-[15px] font-semibold text-text hover:border-bronze";
