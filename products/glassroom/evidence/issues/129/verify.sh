#!/usr/bin/env bash
set -u
export PATH="$HOME/.bun/bin:$PATH"
export PUBLIC_PORT="${PUBLIC_PORT:-4129}"
export NEXT_INTERNAL_PORT="${NEXT_INTERNAL_PORT:-5129}"
export NO_COLOR=1
export FORCE_COLOR=0
cd "$(dirname "$0")/../../.." || exit 1
EVIDENCE="evidence/issues/129"
TEMP_CONFIG=".issue-129-biome.json"
trap 'rm -f "$TEMP_CONFIG"' EXIT

run_check() {
  local name="$1"
  shift
  local output="$EVIDENCE/$name.txt"
  {
    printf 'Command:'
    printf ' %q' "$@"
    printf '\nWorking directory: products/glassroom\n'
    printf 'PUBLIC_PORT=%s NEXT_INTERNAL_PORT=%s\n\n' "$PUBLIC_PORT" "$NEXT_INTERNAL_PORT"
  } > "$output"
  "$@" >> "$output" 2>&1
  local status=$?
  printf '\nExit code: %s\n' "$status" >> "$output"
  # CLI padding has no semantic content; trim it for clean committed evidence.
  sed -i 's/[[:blank:]]*$//' "$output"
  printf '%s: exit %s\n' "$name" "$status"
  tail -n 15 "$output"
  return "$status"
}

failed=0
run_check install bun install --frozen-lockfile || failed=1
run_check handshake-unit bun test tests/unit/handshake-crypto.test.ts || failed=1
run_check product-types bun run check-types --force || failed=1
run_check unit-types bunx tsc --ignoreConfig --noEmit --strict --target ES2017 --module esnext --moduleResolution bundler --lib esnext,dom --types bun --skipLibCheck tests/unit/handshake-crypto.test.ts || failed=1
run_check browser-smoke bun run evidence/issues/129/browser-smoke.ts || failed=1

# Preserve the unmodified shared-config failure rather than silently skipping it.
run_check biome-original bunx biome check apps/web/src/lib/crypto/handshake.ts tests/unit/handshake-crypto.test.ts
original_biome=$?
printf 'Original shared Biome configuration exit: %s (known unsupported useTailwindSortedClasses rule).\n' "$original_biome"

# Compatibility check changes exactly one unsupported config rule, in a temporary
# file only. No tracked shared file is edited and no other lint rules are disabled.
run_check biome-config-prepare python3 -c 'import json; p=json.load(open("biome.json")); p["linter"]["rules"]["nursery"].pop("useTailwindSortedClasses"); open(".issue-129-biome.json","w").write(json.dumps(p)+"\n")' || failed=1
run_check biome-compatible bunx biome check --config-path=.issue-129-biome.json apps/web/src/lib/crypto/handshake.ts tests/unit/handshake-crypto.test.ts || failed=1
printf 'Verification exit: %s; default shared-config lint failure is documented separately.\n' "$failed"
exit "$failed"
