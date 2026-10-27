import { useEffect, useState, type ButtonHTMLAttributes, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { clsx } from "clsx";
import { BrandMark } from "./brand";

/** False during server rendering and until the page's scripts have started in the browser. */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

/** Stagger order for `.reveal` / `.line-mask` entrances. */
export const order = (i: number) => ({ "--i": i }) as CSSProperties;

const buttonBase =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium tracking-[-0.01em] whitespace-nowrap transition-all duration-150 select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0";
const buttonLook = {
  primary: "bg-primary text-primary-fg shadow-xs hover:opacity-90 hover:shadow-sm",
  secondary: "border border-line bg-card text-text shadow-xs hover:bg-soft",
  ghost: "text-muted hover:bg-soft hover:text-text",
  danger: "bg-bad-soft text-bad hover:brightness-95",
} as const;

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonLook }) {
  // Before the page is ready, a click would submit the form natively and just reload it.
  const hydrated = useHydrated();
  return <button {...props} disabled={props.disabled || !hydrated} className={clsx(buttonBase, buttonLook[variant], className)} />;
}

/** Styled like the buttons, for navigation links. */
export const linkButton = clsx(buttonBase, buttonLook.primary);
export const linkButtonSecondary = clsx(buttonBase, buttonLook.secondary);

const fieldClass =
  "block min-h-12 w-full rounded-lg border border-line bg-field px-3.5 text-[16px] text-text shadow-xs outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted/70 focus:border-bronze focus:ring-3 focus:ring-bronze/15";
const labelClass = "block text-[14px] font-medium";

export function Field({
  label,
  hint,
  error,
  ...props
}: ComponentPropsWithRef<"input"> & { label: string; hint?: ReactNode; error?: string | undefined }) {
  const id = props.id ?? props.name;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input id={id} {...props} className={fieldClass} />
      {hint && !error && <p className="text-[13px] text-muted">{hint}</p>}
      {error && <p className="text-[13px] text-bad">{error}</p>}
    </div>
  );
}

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
      <label htmlFor={id} className={labelClass}>
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
      {error && <p className="text-[13px] text-bad">{error}</p>}
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
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <textarea id={id} rows={3} {...props} className={`${fieldClass} py-2.5`} />
      {error && <p className="text-[13px] text-bad">{error}</p>}
    </div>
  );
}

/** The input look, for custom inputs (search boxes, pickers). */
export const inputClass = fieldClass;

export function Card({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div style={style} className={clsx("reveal rounded-2xl bg-card p-6 shadow-sm ring-1 ring-line", className)}>
      {children}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "good" | "warn"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={clsx(
        "reveal rounded-xl px-4 py-3 text-[15px] ring-1",
        tone === "info" && "bg-card text-text ring-line",
        tone === "error" && "bg-bad-soft text-bad ring-bad/20",
        tone === "good" && "bg-good-soft text-good ring-good/20",
        tone === "warn" && "bg-warn-soft text-warn ring-warn/20",
      )}
    >
      {children}
    </div>
  );
}

/** Page title: a small bronze eyebrow, the serif headline rising out of its mask, a hairline below. */
export function PageHeader({
  title,
  subtitle,
  action,
  eyebrow,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="mb-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-6">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow reveal mb-3 text-bronze">{eyebrow}</p>}
        <h1 className="text-[2.25rem] sm:text-[2.875rem]">
          <span className="line-mask">
            <span>{title}</span>
          </span>
        </h1>
        {subtitle && (
          <p className="reveal mt-3 max-w-prose text-[15px] leading-relaxed text-muted" style={order(1)}>
            {subtitle}
          </p>
        )}
      </div>
      {action && (
        <div className="reveal flex flex-wrap gap-2" style={order(2)}>
          {action}
        </div>
      )}
    </header>
  );
}

/** Empty states name the next step; never a blank panel. */
export function EmptyState({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-card/60 px-6 py-14 text-center">
      <h2 className="font-serif text-[1.75rem] leading-none tracking-[-0.02em]">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-muted">{description}</p>
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** A small label above a figure or a section. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={clsx("eyebrow text-muted", className)}>{children}</p>;
}

/**
 * Signed-out pages, laid out like the anqulas.com hero (and Anqulas Docs): a dark olive band with the display
 * type, the form on bone paper beside it. Animates with CSS on first paint; the form works at once.
 */
export function AuthFrame({
  title,
  subtitle,
  children,
  eyebrow = "Anqulas Folio",
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  eyebrow?: string;
  footer?: ReactNode;
}) {
  const assurances = [
    { label: "Client data", value: "PAN and bank details encrypted per practice" },
    { label: "NAVs", value: "Every scheme, from AMFI, each evening" },
    { label: "Your firm only", value: "The database keeps practices apart" },
  ];
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.08fr_1fr]">
      <section className="relative flex flex-col justify-between overflow-hidden bg-ink px-6 py-6 text-bone sm:px-10 lg:px-14 lg:py-12">
        <span className="pointer-events-none absolute -right-40 -bottom-40 size-[36rem] rounded-full bg-[radial-gradient(closest-side,rgb(205_174_126/0.16),transparent)]" />
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(242_239_232/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(242_239_232/0.035)_1px,transparent_1px)] [mask-image:linear-gradient(180deg,black,transparent_85%)] bg-[size:72px_72px]" />
        <Link to="/" className="relative flex w-fit items-center gap-3 rounded-lg transition-opacity hover:opacity-85">
          <BrandMark className="size-9" />
          <span className="text-[17px] font-semibold tracking-[-0.02em]">Anqulas Folio</span>
        </Link>
        <div aria-hidden className="relative my-10 lg:my-0">
          <p className="eyebrow reveal text-[#97a096]">For mutual fund distributors</p>
          <p className="text-display mt-5 text-[clamp(2.75rem,6.6vw,6.75rem)]">
            <span className="line-mask">
              <span>Every client's</span>
            </span>
            <span className="line-mask" style={order(1)}>
              <span>
                money, <em className="text-bronze-light">valued</em> daily.
              </span>
            </span>
          </p>
        </div>
        <dl aria-hidden className="relative hidden grid-cols-3 gap-6 border-t border-bone/15 pt-6 lg:grid">
          {assurances.map((a, i) => (
            <div key={a.label} className="reveal" style={order(i + 3)}>
              <dt className="eyebrow text-[#97a096]">{a.label}</dt>
              <dd className="mt-2 text-sm text-[#bdc1b6]">{a.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col justify-center px-6 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <p className="eyebrow reveal text-bronze">{eyebrow}</p>
          <h1 className="mt-4 text-[clamp(2.25rem,4vw,3rem)]">
            <span className="line-mask" style={order(1)}>
              <span>{title}</span>
            </span>
          </h1>
          {subtitle && (
            <div className="reveal mt-4 text-[15px] leading-relaxed text-muted" style={order(2)}>
              {subtitle}
            </div>
          )}
          <div className="reveal mt-8 rounded-xl bg-card p-7 shadow-md ring-1 ring-line" style={order(3)}>
            {children}
          </div>
          {footer && (
            <div className="reveal mt-6 text-sm text-muted" style={order(4)}>
              {footer}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

/** Link style under auth forms and in text. */
export const textLink = "link-draw font-medium text-bronze";
