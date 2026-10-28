import type { ReactNode } from "react";
import { ThemeToggle } from "./theme";
import { AMFI_DISCLAIMER } from "@/lib/statement";

/**
 * Client portal pages, branded as the distributor's: their name, ARN and EUIN on an olive band, the AMFI disclaimer
 * at the foot. Anqulas Folio appears only as a small credit.
 */
export function PortalFrame({
  practice,
  children,
  action,
}: {
  practice: { name: string; arn: string | null; euin: string | null } | null;
  children: ReactNode;
  action?: ReactNode;
}) {
  const reg = practice ? [practice.arn, practice.euin ? `EUIN ${practice.euin}` : null].filter(Boolean).join(" · ") : "";
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-ink text-bone dark:bg-[#111713]">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold tracking-[-0.02em]">{practice?.name ?? "Your portfolio"}</p>
            <p className="truncate text-[13px] text-[#a9b0a5]">{reg || "Mutual fund distributor"}</p>
          </div>
          {action}
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 pt-7 pb-12 sm:px-8 sm:pt-10">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-[13px] text-muted sm:px-8">
          <p className="max-w-xl font-medium text-bronze">{AMFI_DISCLAIMER}</p>
          <div className="flex items-center gap-3">
            <span>Powered by Anqulas Folio</span>
            <ThemeToggle tone="paper" />
          </div>
        </div>
      </footer>
    </div>
  );
}
