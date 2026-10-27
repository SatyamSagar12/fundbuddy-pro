// Packs the Cloudflare build for Cloudflare Pages (advanced mode): static files at the root, the app in
// _worker.js/, and _routes.json so static files are served directly without running the app.
// Run after `vite build`:  npm run build:pages   →  dist/pages
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";

const out = "dist/pages";
if (!existsSync("dist/client") || !existsSync("dist/server/index.js")) {
  console.error("Run `vite build` first");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync("dist/client", out, { recursive: true });
cpSync("dist/server", `${out}/_worker.js`, {
  recursive: true,
  filter: (src) => !src.endsWith(".map") && !src.endsWith("wrangler.json"),
});
// Every static file and folder (assets, icons, manifest, service worker) is served directly by Pages.
const exclude = readdirSync("dist/client").map((name) => (statSync(`dist/client/${name}`).isDirectory() ? `/${name}/*` : `/${name}`));
writeFileSync(`${out}/_routes.json`, JSON.stringify({ version: 1, include: ["/*"], exclude }));
console.log(`Pages build ready in ${out}`);
