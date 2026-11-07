import type { CSSProperties } from "react";
import { clsx } from "clsx";
import { hueOf, initials } from "@/lib/format";

/** Client initials on a soft tint of the client's own hue (both themes). */
export function ClientAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx("client-avatar flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", className)}
      style={{ "--h": hueOf(name) } as CSSProperties}
    >
      {initials(name)}
    </span>
  );
}
