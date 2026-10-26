/** Typed access to the Worker's settings and secrets (wrangler.jsonc vars + `wrangler secret put`). */
import { env as cfEnv } from "cloudflare:workers";

export type AppEnv = {
  APP_URL: string;
  MAIL_FROM: string;
  SES_REGION: string;
  MASTER_KEY: string;
  SESSION_SECRET: string;
  SES_ACCESS_KEY_ID?: string;
  SES_SECRET_ACCESS_KEY?: string;
  PLATFORM_ADMIN_EMAILS?: string;
};

export function appEnv(): AppEnv {
  const e = cfEnv as unknown as Partial<AppEnv>;
  for (const key of ["MASTER_KEY", "SESSION_SECRET"] as const) {
    if (!e[key]) throw new Error(`Missing secret ${key}. Locally: copy .dev.vars.example to .dev.vars.`);
  }
  return e as AppEnv;
}
