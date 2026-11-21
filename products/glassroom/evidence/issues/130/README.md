# Issue #130 — authenticated data envelopes

Scope: `products/glassroom` inside the monorepo (adapted from the issue's product-root paths). Built only the data-envelope codec, its integration contract, and tests on #129's handshake API. No server, UI, transport, dependency, or lint-configuration changes.

## Acceptance criteria

- [x] **PASS — Only three outer fields visible.** Strict Zod envelopes contain `sessionId`, lossless decimal `sequence`, and canonical base64url `ciphertext`. Message IDs/text, acknowledgements, verification decisions, and end controls are authenticated encrypted body variants; both directions round-trip all four.
- [x] **PASS — Concurrent requests allocate unique increasing sequences and specified IVs.** Thirty-two simultaneous requests produce sequences 0–31 and distinct ciphertext. Independent test encoding confirms the encryption path's `zero32 || uint64(sequence)` big-endian IV and canonical AAD; exact helper bytes also cover a >2^53 sequence and uint64 maximum.
- [x] **PASS — Context/tamper/stale/malformed/oversized/exhaustion rejection before dispatch.** Tests independently change session AAD, direction AAD, and sequence AAD, attempt reflection, flip a tag bit, race duplicate receives, exercise malformed JSON/UTF-8/encodings/fields, and send an otherwise-valid padded frame of **33601 bytes = declared 33600-byte maximum + one byte** with zero dispatches. A 33600-byte padded frame is accepted. Conservative counter exhaustion terminates sends; full uint64 receive boundary is losslessly tested. Strict body validation includes message limits of 4096 UTF-8 bytes and worst-case JSON escapes.
- [x] **PASS — Failed authentication preserves accepted incoming sequence.** Forged high-sequence and same-sequence frames fail without poisoning state; subsequent authentic frames succeed. Concurrent receives advance only after authenticated, validated body decoding.

## Lifecycle

One-shot authenticated-handshake ownership and a runtime constructor token prevent normal JavaScript callers from resetting sequence/key state through a second codec. Disposal destroys the owned handshake, drops key references, and prevents queued or in-flight crypto results from releasing ciphertext/body. Decrypted/encoded temporary bytes are best-effort zeroed. There is no import/restore/resumption API; JavaScript cannot guarantee physical key erasure.

## Recorded verification

All commands in `verification.json` exited **0** after `git fetch origin && git merge origin/main` (merged main SHA is recorded there). Each text file contains the exact command, working directory, exit code, and last approximately 15 output lines; `issue-unit.txt` retains the complete small suite so all ten required case names are visible.

- `bun install --frozen-lockfile`: PASS, no dependency/lockfile changes.
- `bun run check`: PASS, 54 files; no fixes applied at final gate.
- `bun run check-types`: PASS, all 3 check-type tasks.
- `bun run build`: PASS, both build tasks.
- `bun test tests/unit/data-envelope.test.ts`: **16 pass, 0 fail**, all ten exact issue names plus six regressions.
- `bun test tests/unit`: **55 pass, 0 fail**, four files.
- `PUBLIC_PORT=4130 NEXT_INTERNAL_PORT=5130 bunx playwright test --project=chromium tests/e2e/data-envelope.spec.ts tests/e2e/boot.spec.ts tests/e2e/preflight.spec.ts tests/e2e/signal-server.spec.ts --reporter=list`: **9 passed**. `chromium-cases.txt` lists every case, including the runner-only real Chromium WebCrypto codec smoke. The preflight fault-injection scenario's internal `status: failed` is the intended assertion for blocked connectivity, not a failed test.
- `git diff --check`: PASS.

No screenshots were required; no screenshots or large HTML reports were committed. No listener remained on either assigned port after Playwright cleanup.

## Unverified

None of #130's acceptance criteria or required gates remain unverified. Full room/chat integration, human verification UI/gating, intended judge-network delivery, and a security audit are outside this issue. Browser codec and preflight checks used Chromium 159.0.8154.6 on the local sandbox; this does not prove arbitrary-network connectivity or endpoint-compromise resistance. The verified head SHA and PR link are in the PR verification body, avoiding a self-referential commit hash in this evidence tree.
