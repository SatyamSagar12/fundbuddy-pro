import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { readDevOutbox, sesConfigured } from "@/server/mailer";
import { appUrl } from "@/server/env";

/** Local development only: mail that would have been sent. 404 anywhere with real email or a real domain. */
export const getDevOutbox = createServerFn({ method: "GET" }).handler(async () => {
  if (sesConfigured() || !appUrl().startsWith("http://localhost")) throw notFound();
  return readDevOutbox().map((m) => ({ ...m }));
});
