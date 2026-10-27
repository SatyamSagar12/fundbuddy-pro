/** Indian number style (₹1,23,456) by default; the practice's locale and currency can change it later. */
export function money(value: number, currency = "INR", locale = "en-IN"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(value || 0);
}

export function day(value: string | Date | null | undefined, locale = "en-IN"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value + (value.length === 10 ? "T00:00:00" : "")) : value;
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

const TYPE_LABEL: Record<string, string> = {
  purchase: "One-time",
  sip: "SIP",
  redemption: "Redemption",
  switch_in: "Switch in",
  switch_out: "Switch out",
  idcw_reinvest: "IDCW reinvest",
  idcw_payout: "IDCW payout",
};
export function txnType(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

/** 0.1234 → "12.3%"; null → "—". */
export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function units(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function navText(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

/** Gains in green, losses in red. */
export function gainTone(value: number | null | undefined): string {
  if (!value) return "";
  return value > 0 ? "text-good" : "text-bad";
}

/** Initials for a client tile: "Ramesh Kumar" → "RK". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** A steady hue per name, for the client tile's tint. */
export function hueOf(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
