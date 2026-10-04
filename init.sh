#!/usr/bin/env bash
# Session start (CLAUDE.md): Node ≥ 22.12, npm ci, Chromium for Playwright, browser smoke test.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

need="22.12.0"
have="$(node -v 2>/dev/null | sed 's/^v//')" || { echo "init.sh: node not found" >&2; exit 1; }
if [ "$(printf '%s\n%s\n' "$need" "$have" | sort -V | head -n1)" != "$need" ]; then
  echo "init.sh: Node >= $need required, found $have" >&2; exit 1
fi
echo "init.sh: node $have, npm $(npm -v)"

npm ci --no-audit --no-fund
bash scripts/ensure-chromium.sh
if command -v perl >/dev/null 2>&1; then echo "init.sh: $(perl -v | sed -n 2p)"; else echo "init.sh: perl not found"; fi

echo "init.sh: browser smoke"
npm run --silent build:e2e >/dev/null
npx playwright test e2e/smoke.spec.ts --project desktop --grep "environment"
echo "init.sh: ok"
