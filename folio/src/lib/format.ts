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
  purchase: "Lump sum",
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
