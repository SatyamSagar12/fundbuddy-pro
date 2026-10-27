/** Typed access to the Worker's settings and secrets (wrangler.jsonc vars + `wrangler secret put`). */
import { env as cfEnv } from "cloudflare:workers";
import { getRequestUrl } from "@tanstack/react-start/server";

export type AppEnv = {
  /** The site's address for links in emails. When unset, the address the request came in on is used. */
  APP_URL?: string;
  MAIL_FROM: string;
  SES_REGION: string;
  MASTER_KEY: string;
  SESSION_SECRET: string;
  SES_ACCESS_KEY_ID?: string;
  SES_SECRET_ACCESS_KEY?: string;
  PLATFORM_ADMIN_EMAILS?: string;
  /** Your UPI ID for plan payments (e.g. anqulas@okhdfcbank) and the name shown in the payer's UPI app. */
  UPI_ID?: string;
  UPI_PAYEE_NAME?: string;
};

export function appEnv(): AppEnv {
  const e = cfEnv as unknown as Partial<AppEnv>;
  for (const key of ["MASTER_KEY", "SESSION_SECRET"] as const) {
    if (!e[key]) throw new Error(`Missing secret ${key}. Locally: copy .dev.vars.example to .dev.vars.`);
  }
  return e as AppEnv;
}

/** The site's public address, without a trailing slash. */
export function appUrl(): string {
  const configured = appEnv().APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return getRequestUrl().origin;
}
