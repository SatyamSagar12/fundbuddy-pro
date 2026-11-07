/**
 * Light, dark, or match the device. The choice is kept in this browser (localStorage "theme"); a small script in
 * the page head applies it before the first paint, so the page never flashes the wrong theme.
 */
import { Moon, Sun, SunMoon } from "lucide-react";
import { useEffect, useState } from "react";
import { clsx } from "clsx";

type Theme = "light" | "system" | "dark";

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "Match device", icon: SunMoon },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export function ThemeToggle({ className, tone = "olive" }: { className?: string; tone?: "olive" | "paper" }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    let saved: Theme = "system";
    try {
      const t = localStorage.getItem("theme");
      if (t === "light" || t === "dark") saved = t;
    } catch {
      // storage blocked: follow the device
    }
    setTheme(saved);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let t: string | null = null;
      try {
        t = localStorage.getItem("theme");
      } catch {
        // ignore
      }
      if (t !== "light" && t !== "dark") apply("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function choose(t: Theme) {
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", t);
    } catch {
      // still applied for this page
    }
    apply(t);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={clsx("inline-flex items-center gap-0.5 rounded-lg p-0.5", tone === "olive" ? "bg-white/[0.06]" : "bg-soft", className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => choose(value)}
            className={clsx(
              "flex items-center justify-center gap-1.5 rounded-md transition-colors",
              tone === "olive" ? "size-7" : "h-9 px-3 text-[14px] font-medium",
              tone === "olive"
                ? active
                  ? "bg-white/[0.14] text-bone shadow-sm"
                  : "text-[#97a096] hover:text-bone"
                : active
                  ? "bg-card text-text shadow-sm"
                  : "text-muted hover:text-text",
            )}
          >
            <Icon size={14} aria-hidden />
            {tone === "paper" && label}
          </button>
        );
      })}
    </div>
  );
}
