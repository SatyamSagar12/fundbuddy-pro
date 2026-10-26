#!/usr/bin/env bash
# Starts (or restarts) the local dev server in the background and waits until it answers.
# Logs: .wrangler/dev.log
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .wrangler/dev.pid ] && kill -0 "$(cat .wrangler/dev.pid)" 2>/dev/null; then
  kill "$(cat .wrangler/dev.pid)"; sleep 2
fi
mkdir -p .wrangler
nohup npx vite dev --host 127.0.0.1 > .wrangler/dev.log 2>&1 &
echo $! > .wrangler/dev.pid
for _ in $(seq 1 60); do
  if curl -s -o /dev/null http://localhost:3000/login; then echo "Dev server ready on http://localhost:3000"; exit 0; fi
  sleep 1
done
echo "Dev server did not start; see .wrangler/dev.log" >&2; exit 1
