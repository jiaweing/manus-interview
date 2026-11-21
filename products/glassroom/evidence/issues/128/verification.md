# Issue #128 fix-round verification

PR: https://github.com/jiaweing/manus-interview/pull/196

Merged `origin/main` at `fde493efcc7c4ad3e0ebabf77b4eb08d3b3a9f9a` into `glassroom/128-signaling-crypto`. The refreshed main includes the evidence-ignore lint configuration, formatted baseline, and merged #126/#129. No Biome rules, dependency versions, or lockfile were edited in this fix round.

Ran `bunx biome check --write` first: it fixed sorting, formatting, regex spelling, and redundant escapes in the two #128 TypeScript files, leaving eight diagnostics. Manual fixes hoist non-global regexes, use property-style function signatures, extract unchanged incoming context/counter validation into a pure helper, and replace test XOR with an equivalent least-significant-bit toggle using checked negative indexing. The authenticated header array, HKDF directions/salt, AES-GCM parameters, nonce layout, queue serialization, counter reservation, receive-state advancement, zeroing, redacted failures, and existing 14 test cases/assertions are preserved.

Working directory: `/home/ubuntu/wt/f128/products/glassroom`, adapting the issue paths to this monorepo. Environment: `export PATH=$HOME/.bun/bin:$PATH`; `PUBLIC_PORT=4328 NEXT_INTERNAL_PORT=5328`; Bun 1.4.5. No server was started. Full refreshed command output is committed under `products/glassroom/evidence/issues/128/`. Only trailing terminal whitespace/ANSI formatting is normalized; diagnostic content is retained. Historical failed final-check logs and obsolete typecheck iterations are replaced/removed. The autofix exit 1 below is the intermediate eight-diagnostic result, not the final lint verdict.

## Issue verification section, verbatim

> Run bun test tests/unit/signaling-crypto.test.ts. Add and pass named cases 'same-secret round trip', 'directional key separation', 'wrong secret', 'AAD mismatch', 'ciphertext tamper', 'replay rejected', 'failed authentication preserves counter', and 'counter exhaustion closes'. Each negative case must assert no plaintext result and no sensitive value in the returned error.

The exact command passed: **14 pass, 0 fail, 647 assertions**. All eight required names remain unchanged. Each negative case calls `rejected`, which asserts the exact static failure result, absence of `value`/`plaintext`, and absence of sensitive fixture values in the error serialization. The complete `tests/unit` suite, including #129 session-handshake tests, passed: **28 pass, 0 fail, 764 assertions**.

## Acceptance criteria

- [x] **PASS:** Envelopes decrypt only with matching secret, room, sender role/direction, supported version, and authentication tag. Named round-trip, wrong-secret, AAD-mismatch, ciphertext-tamper, direction-separation, and room-salt tests pass; negative results contain no plaintext or sensitive errors.
- [x] **PASS:** Directions derive distinct keys; concurrent sends reserve 32 unique ordered counters/ciphertexts. Counters are reserved before WebCrypto and never wrap; same-session nonce behavior is unchanged.
- [x] **PASS:** Replayed/stale counters, exhaustion, invalid encodings, and failed authentication reject without releasing plaintext or advancing accepted receive state. Forged high counters do not poison valid lower receives; exhaustion closes sending and subsequent operations reject.
- [x] **PASS:** `bun run check`, `bun run check-types`, and `bun run build` all exit 0. No lint-rule weakening or suppressions were added.

## Explicit unverified items and limits

- Browser/WSS/WebRTC/UI, cross-issue transport integration, and teardown/refresh enforcement were not rerun in this module-only lint fix. Recreating a role instance with the same room/secret still restarts its counter; callers must enforce the documented one-instance/fresh-invitation lifecycle after teardown. This remains an integration/release gate, not an unconditional cross-instance nonce-reuse guarantee.
- Actual 2^64 outgoing sends are infeasible and were not executed. Conservative counter caps exercise the same exhaustion path; exact uint64 envelope/nonce boundaries are covered by the existing unit test.
- The prior independent verifier's external adversarial tests and Chromium smoke were not rerun in this fix round; their earlier results are not claimed as verification of this new head.
- #128 has no screenshot requirement; no screenshots were taken or committed. No audit or absolute-security claim is made.

## Commands and retained output

### `bun install --frozen-lockfile` — exit 0

Full log: `products/glassroom/evidence/issues/128/install.txt`.

```text
Environment: PUBLIC_PORT=4328 NEXT_INTERNAL_PORT=5328

bun install v1.4.5 (a7733435c)

+ @biomejs/biome@2.5.15
+ @playwright/test@1.65.1
+ @types/bun@1.4.5
+ turbo@2.11.13
+ typescript@6.0.3
+ ultracite@8.0.0
+ zod@4.6.7

320 packages installed [520.00ms]

Exit code: 0
```

### `bunx biome check --write` — exit 1

Full log: `products/glassroom/evidence/issues/128/biome-autofix.txt`.

```text
  i Bitwise operators are prohibited because their use can be confusing or unintended. If you did want to use the bitwise operator, consider suppressing this diagnostic.


Skipped 12 suggested fixes.
If you wish to apply the suggested (unsafe) fixes, use the command biome check --write --unsafe

Checked 47 files in 349ms. Fixed 2 files.
Found 8 errors.
check ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × Some errors were emitted while applying fixes.



Exit code: 1
```

### `bunx biome format --write apps/web/src/lib/crypto/signaling.ts tests/unit/signaling-crypto.test.ts` — exit 0

Full log: `products/glassroom/evidence/issues/128/format.txt`.

```text
Command: bunx biome format --write apps/web/src/lib/crypto/signaling.ts tests/unit/signaling-crypto.test.ts
Environment: PUBLIC_PORT=4328 NEXT_INTERNAL_PORT=5328

Formatted 2 files in 13ms. Fixed 1 file.

Exit code: 0
```

### `bun test tests/unit/signaling-crypto.test.ts` — exit 0

Full log: `products/glassroom/evidence/issues/128/unit-tests.txt`.

```text
(pass) invitation-authenticated signaling > failed authentication preserves counter [1.53ms]
(pass) invitation-authenticated signaling > counter exhaustion closes [1.18ms]
(pass) invitation-authenticated signaling > invalid encodings do not release plaintext or consume receive state [9.63ms]
(pass) invitation-authenticated signaling > concurrent sends use unique counters and concurrent receives reject duplicate [4.94ms]
(pass) invitation-authenticated signaling > room salt separation [0.78ms]
(pass) invitation-authenticated signaling > uint64 boundary is validated without floating point rounding [0.57ms]
(pass) invitation-authenticated signaling > invalid initialization and oversized plaintext are redacted [0.75ms]
(pass) invitation-authenticated signaling > queued plaintext and envelope inputs are snapshotted [0.44ms]

 14 pass
 0 fail
 647 expect() calls
Ran 14 tests across 1 file. [118.00ms]

Exit code: 0
```

### `bun run check` — exit 0

Full log: `products/glassroom/evidence/issues/128/check.txt`.

```text
Command: bun run check
Environment: PUBLIC_PORT=4328 NEXT_INTERNAL_PORT=5328

$ ultracite check
Checked 47 files in 331ms. No fixes applied.

Exit code: 0
```

### `bun run check-types` — exit 0

Full log: `products/glassroom/evidence/issues/128/typecheck.txt`.

```text
   • Remote caching disabled, using shared worktree cache

server:check-types: cache miss, executing 4a5761078023a2ee
@glassroom/ui:check-types: cache miss, executing 26448c8660d227d5
server:check-types: $ tsc --noEmit
@glassroom/ui:check-types: $ tsc --noEmit
web:check-types: cache miss, executing 9c82f23b6da41ab5
web:check-types: $ tsc --noEmit

 Tasks:    3 successful, 3 total
Cached:    0 cached, 3 total
  Time:    5.083s


Exit code: 0
```

### `bun run build` — exit 0

Full log: `products/glassroom/evidence/issues/128/build.txt`.

```text
web:build:
web:build: Route (app)
web:build: ┌ ○ /
web:build: └ ○ /_not-found
web:build:
web:build:
web:build: ○  (Static)  prerendered as static content
web:build:

 Tasks:    2 successful, 2 total
Cached:    0 cached, 2 total
  Time:    8.563s


Exit code: 0
```

### `bun test tests/unit` — exit 0

Full log: `products/glassroom/evidence/issues/128/all-unit-tests.txt`.

```text
(pass) ephemeral session handshake > nonce binding [0.99ms]
(pass) ephemeral session handshake > invalid HMAC [0.90ms]
(pass) ephemeral session handshake > fresh session material [1.75ms]
(pass) ephemeral session handshake > no private material in envelopes [1.39ms]
(pass) ephemeral session handshake > both local and peer confirmations are required [1.44ms]
(pass) ephemeral session handshake > malformed and unknown envelope fields fail closed [7.04ms]
(pass) ephemeral session handshake > one-shot derivation, copied envelopes, and teardown [1.39ms]
(pass) ephemeral session handshake > teardown cannot resurrect an in-flight handshake [0.85ms]

 28 pass
 0 fail
 764 expect() calls
Ran 28 tests across 2 files. [103.00ms]

Exit code: 0
```

### `bunx tsc --ignoreConfig --noEmit --target esnext --module esnext --moduleResolution bundler --lib esnext,dom --strict --types bun --skipLibCheck tests/unit/signaling-crypto.test.ts` — exit 0

Full log: `products/glassroom/evidence/issues/128/test-typecheck.txt`.

```text
Command: bunx tsc --ignoreConfig --noEmit --target esnext --module esnext --moduleResolution bundler --lib esnext,dom --strict --types bun --skipLibCheck tests/unit/signaling-crypto.test.ts
Environment: PUBLIC_PORT=4328 NEXT_INTERNAL_PORT=5328


Exit code: 0
```

### `git diff --check` — exit 0

Full log: `products/glassroom/evidence/issues/128/diff-check.txt`.

```text
Command: git diff --check
(no diagnostic output)
Exit code: 0
```

### `git diff --cached --check` — exit 0

Full log: `products/glassroom/evidence/issues/128/staged-diff-check.txt`.

```text
Command: git diff --cached --check
(no diagnostic output)
Exit code: 0
```
