import { defineConfig } from "vitest/config";

// Tests run in Node against the local Postgres (scripts/local-db.sh), not through the Cloudflare plugin.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "cloudflare:workers": new URL("./test/stubs/cloudflare-workers.ts", import.meta.url).pathname },
  },
  test: { include: ["test/**/*.test.ts"], fileParallelism: false, testTimeout: 20000 },
});
