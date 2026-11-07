import { clsx } from "clsx";

/** The Anqulas "A" mark, as on anqulas.com. Decorative: the name sits beside it. */
export function BrandMark({ className }: { className?: string }) {
  return <img src="/brand/anqulas-mark.webp" alt="" width={120} height={108} className={clsx("size-8 shrink-0 object-contain", className)} />;
}
