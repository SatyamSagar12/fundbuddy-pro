import { defineConfig } from "vitest/config";

// Tests run in Node against the local Postgres (scripts/local-db.sh), not through the Cloudflare plugin.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ["test/**/*.test.ts"], fileParallelism: false, testTimeout: 20000 },
});
