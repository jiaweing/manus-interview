#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.bun/bin:$PATH"
export WXT_SIDEKICK_PROXY_URL=https://sidekick-proxy.example.com
# The scanner requires a token input; use a fresh dummy if none was supplied.
# Never include its value in command headers or logs.
export SIDEKICK_DEMO_TOKEN="${SIDEKICK_DEMO_TOKEN:-dummy-scan-$(cat /proc/sys/kernel/random/uuid)}"
mkdir -p evidence/82
: > evidence/82/summary.log
trap 'sed -i "s/[[:space:]]*$//" evidence/82/*.log' EXIT
run_check() {
  local name="$1"
  shift
  printf '\nCOMMAND: %s\n' "$*" | tee -a evidence/82/summary.log
  set +e
  "$@" > "evidence/82/${name}.log" 2>&1
  local code=$?
  set -e
  sed -i 's/[[:space:]]*$//' "evidence/82/${name}.log"
  tail -12 "evidence/82/${name}.log" | tee -a evidence/82/summary.log
  printf 'EXIT_CODE=%s\n' "$code" | tee -a evidence/82/summary.log
  if [[ "$code" != 0 ]]; then return "$code"; fi
}
run_check install bun install --frozen-lockfile
run_check build env WXT_SIDEKICK_PROXY_URL=https://sidekick-proxy.example.com bun run build:extension
run_check privacy env SIDEKICK_PRIVACY_EVIDENCE=1 bun test apps/extension/src/page/snapshot-privacy.test.ts
run_check privacy-verbatim bun test apps/extension/src/page/snapshot-privacy.test.ts
run_check suite bun test
run_check typecheck bun run typecheck
run_check check bun run check
run_check secrets bun run verify:secrets
run_check browser xvfb-run -a bun apps/extension/tests/snapshot-privacy.browser.ts
printf '\nReal OpenRouter API: not run: no key.\nHTTPS hosting gate: not run; issue #78 owns this separately gated check.\n' | tee -a evidence/82/summary.log
