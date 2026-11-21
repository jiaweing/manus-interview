# Issue #128 verification

The issue's original product-root paths are adapted to this monorepo's `products/glassroom`. Verification was run from `/home/ubuntu/wt/b128/products/glassroom`, with `PUBLIC_PORT=4128 NEXT_INTERNAL_PORT=5128`, Bun 1.4.5, and the pinned frozen-lockfile dependencies. No server was started.

## Acceptance criteria

- [x] **PASS — Matching secret/context/tag only:** `same-secret round trip` passes in both directions. `wrong secret`, `AAD mismatch`, `ciphertext tamper`, `directional key separation`, and `room salt separation` reject a mismatched secret, room, sender role/direction, version/operation/counter header, or GCM tag. Each negative result has no plaintext/value and contains only the expected static error code.
- [x] **PASS — Directional keys and nonce uniqueness:** HKDF domain-separated AES-256-GCM keys are non-extractable; encrypting the same synthetic bytes at the same IV yields distinct ciphertext under opposite directional keys. Concurrent sends allocate the exact ordered sequence 0–31, with distinct ciphertexts. Counters are reserved before crypto and never wrap.
- [x] **PASS — Rejection without receive-state advance:** Replay/stale counters, invalid encodings, failed authentication, and out-of-limit counters return redacted rejections. Forged high counters and failed authentication do not prevent the original authentic lower-counter frame from being accepted. The exact uint64 boundary is validated/decrypted using big integers, with max+1 rejected. Exhausting a conservative cap follows the same outgoing exhaustion branch, closes the instance, and prevents future operations.

## Final commands

| Command (verbatim) | Exit | Evidence |
| --- | --- | --- |
| `bun test tests/unit/signaling-crypto.test.ts` | 0 | `unit-tests.txt`: **14 pass, 0 fail, 647 assertions**, all eight required named cases included |
| `bun run --cwd apps/web check-types` | 0 | `typecheck.txt` |
| `bunx tsc --ignoreConfig --noEmit --target esnext --module esnext --moduleResolution bundler --lib esnext,dom --strict --types bun --skipLibCheck tests/unit/signaling-crypto.test.ts` | 0 | `test-typecheck.txt` |
| `bunx biome check apps/web/src/lib/crypto/signaling.ts tests/unit/signaling-crypto.test.ts` | 1 | `lint.txt`: existing shared `biome.json` rejects unknown `nursery.useTailwindSortedClasses` before linting files |
| `git diff --check` | 0 | `diff-check.txt` |
| `git diff --cached --check` (repository root) | 0 | `staged-diff-check.txt` |

Full command output and exit code are saved in each text file, with terminal trailing whitespace removed for a clean Git diff. Initial standalone typecheck attempts are retained as `test-typecheck-initial.txt` (TypeScript 6 requires `--ignoreConfig` with explicit files) and `test-typecheck-pre-fix.txt` (Bun's typed assertion needed `AesKeyAlgorithm`). Both were corrected and the final standalone check passes. The shell's first piped verification attempt did not record exit codes reliably; the final captured runs above use Python subprocess return codes.

The new TypeScript files were formatted with Biome using an isolated temporary formatter-only config because the shared config cannot load. No shared package scripts, configs, lockfile, admission, session-key, preflight, or UI files were changed.

## Unverified / limits

- Repository lint is **blocked**, not passed, due to the existing shared Biome configuration error. It was left unchanged for scope/merge safety.
- Browser/WSS/transport integration and lifecycle enforcement by other issues are outside this framework-free unit issue and were not run. Integration must close/discard an instance on teardown and create a fresh room/secret rather than recreate the same invitation with reset counters.
- Sending all 2^64 possible counters is not feasible. The exhaustion branch is covered using a lower allowed cap, while the actual uint64 boundary/overflow schema and decrypt nonce layout are tested directly.
- No screenshots are applicable to this non-UI module. No audit or absolute-security claim is made.
