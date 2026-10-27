/** Stand-in for Cloudflare's `cloudflare:workers` module in tests: settings come from the process environment. */
export const env: Record<string, string | undefined> = process.env;
