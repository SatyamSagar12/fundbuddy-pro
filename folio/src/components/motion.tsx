/**
 * Motion helpers shared with Anqulas Docs:
 *  - MotionSettle: the full entrance animations play once per visit; later page changes get a short version.
 *  - NavigationProgress: a thin bronze bar while the next page loads.
 *  - CountUp: a figure that counts up to its value on first paint (the real value is in the HTML).
 */
import { useLayoutEffect, useEffect, useRef } from "react";
import { useLocation, useRouterState } from "@tanstack/react-router";

export function MotionSettle() {
  const path = useLocation({ select: (l) => l.pathname });
  const first = useRef(path);
  useEffect(() => {
    const settle = () => {
      document.documentElement.dataset["settled"] = "";
    };
    if (path !== first.current) return settle();
    const timer = window.setTimeout(settle, 1600);
    return () => window.clearTimeout(timer);
  }, [path]);
  return null;
}

function isSettled(): boolean {
  return typeof document !== "undefined" && "settled" in document.documentElement.dataset;
}

export function NavigationProgress() {
  const loading = useRouterState({ select: (s) => s.status === "pending" });
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5">
      <div
        className="h-full origin-left bg-bronze"
        style={{
          transform: `scaleX(${loading ? 0.85 : 1})`,
          opacity: loading ? 1 : 0,
          transition: loading
            ? "transform 8s cubic-bezier(0.1, 0.7, 0.2, 1) 150ms, opacity 0s 150ms"
            : "transform 0.3s ease, opacity 0.4s ease 0.2s",
        }}
      />
    </div>
  );
}

/** Counts up to `value`, formatted by `format`. Only on the first entrance of a visit, never with reduced motion. */
export function CountUp({ value, format = (n) => String(Math.round(n)), duration = 1000 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !(value > 0) || isSettled()) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      node.textContent = format((1 - Math.pow(1 - t, 4)) * value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    node.textContent = format(0);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      node.textContent = format(value);
    };
  }, [value, duration, format]);
  return <span ref={ref}>{format(value)}</span>;
}
