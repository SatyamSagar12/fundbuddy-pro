import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";
import { linkButtonSecondary } from "./ui";

/**
 * Shown instead of a page that failed to load or draw (a server timeout, a dropped connection, a bug).
 * Keeps the menu around it, offers a retry, and never shows technical text to the person.
 */
export function PageError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useEffect(() => {
    console.error("Page failed:", error);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-[2rem]">This page didn't load.</h1>
      <p className="mt-3 text-[15px] text-muted">
        The server took too long or the connection dropped. Your data is safe. Try again in a moment.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          className="inline-flex h-11 items-center rounded-full bg-text px-5 text-[15px] font-medium text-paper"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          Try again
        </button>
        <Link to="/app" className={linkButtonSecondary} onClick={() => reset()}>
          Go to Home
        </Link>
      </div>
    </div>
  );
}

/** A server function's answer that isn't what the page expects (e.g. an error page from the host) fails loudly here. */
export function expectShape<T>(value: T, key: string): T {
  if (!value || typeof value !== "object" || !(key in (value as object))) throw new Error("The server's answer was incomplete.");
  return value;
}
