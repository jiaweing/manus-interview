# Issue 132 builder verification

Verified on 2026-11-21 from `products/glassroom` in the isolated `glassroom/132-admission` worktree. This adapts the issue's original product-root paths to the monorepo. The current bootstrap test actually lives in `tests/e2e/boot.spec.ts`, not `apps/web/tests/e2e/boot.spec.ts` in this checkout.

Environment: Bun 1.4.5, `PUBLIC_PORT=4132`, `NEXT_INTERNAL_PORT=5132`, `CHROMIUM_PATH=/usr/bin/chromium`. Every check has a `.command.txt`, complete `.output.txt`, and `.exit.txt` here. Successful final results:

| Check | Command | Exit | Result |
| --- | --- | --- | --- |
| Locked dependencies | `bun install --frozen-lockfile` | 0 | No dependency or lockfile changes |
| Required issue verification | `bun test tests/unit/signal-server.test.ts` | 0 | 11 pass, 0 fail, 408 assertions |
| Workspace types | `bun run check-types` | 0 | 3 successful tasks |
| Workspace build | `bun run build` | 0 | 2 successful tasks |
| Real HTTPS/WSS Chromium tests | `PUBLIC_PORT=4132 NEXT_INTERNAL_PORT=5132 CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e tests/e2e/boot.spec.ts tests/e2e/signal-server.spec.ts` | 0 | 6 passed, including all 3 boot tests |
| Source/privacy boundary audit | `python3 evidence/issues/132/static-audit.py` | 0 | Route, raw forwarding, no payload logging/decryption/persistence checks passed |
| Whitespace | `git diff --check` | 0 | No errors |

The initial static audit exited 1 because its substring pattern matched `req` inside the existing TLS error word `required`. No product defect was found or changed in response. The audit was corrected to match identifier word boundaries and rerun successfully. The original diagnostic/command/exit are preserved as `static-initial.*.txt`.

## Acceptance criteria

- [x] **PASS — at most one creator and one joiner.** Named unit cases `creator plus one joiner`, `third participant rejected`, `duplicate role rejected`, and `join nonexistent room rejected` verify admission, original-peer identity, and unchanged admitted peers. Browser tests reject both outsider roles and then successfully forward between the original pair.
- [x] **PASS — invalid versions/schemas, room-role spoofing, and over-cap frames rejected without forwarding.** Named `socket room-role binding` and `schema and over-cap rejection` assert zero ciphertext peer-forward calls for every negative frame. Coverage includes malformed JSON, missing/extra fields, binary frames, invalid operations, plaintext-body keys, canonical room/counter/base64url encoding, uint64 overflow, decoded ciphertext length, and whole-frame UTF-8 size. Boundary tests include both exact caps. Real WSS verifies spoofing (1008) and transport-level over-cap (1009).
- [x] **PASS — ciphertext forwarded unchanged; no message route, decryption, or persistence integration.** Named `ciphertext forwarded unchanged` checks exact original text (including whitespace) in both directions. Browser WSS does the same. The sole Hono route remains `/signal`; source audit verifies no payload logging, server decryption, or storage integration. No new dependencies were added.
- [x] **PASS — admitted termination deletes the room and ends the remaining membership.** Named `termination deletes room` checks both roles, immediate absence of the room ID, peer notification/close, single-creator close, idempotence, and stale callbacks after replacement admission. Browser WSS covers ordinary participant close and rejection-driven teardown, followed by nonexistent-room joiner rejection and fresh creator admission.

## Wire contract and integration

The server follows the contemporaneous #128 wire contract: `{version:1, roomId, role, operation:"forward", counter, ciphertext}`, with a separate strict join envelope. `roomId` is canonical base64url encoding of 16 bytes. Ciphertext length is derived and validated (16 through `64 * 1024 + 16` decoded bytes), not a caller-supplied/extra `length` field. The complete UTF-8 JSON cap is 128 KiB to accommodate the crypto module's 64 KiB plaintext limit plus GCM/base64url overhead. Details are in `apps/server/README.md`. No #128/#129/#127 files were edited.

The boot test keeps the ready control frame and malformed-payload 1008 checks, but now proves a valid creator join succeeds between them. Its secure context, HTTPS URL, and foreign/insecure-origin checks remain green.

## Unverified / limits

No issue-132 acceptance criterion is left unverified. Full application integration with the concurrent invitation crypto, ECDH/fingerprint, and WebRTC preflight branches was not run; their files are deliberately outside this issue. The server validates opaque encodings, not authenticity of AES-GCM bytes, which is the client's responsibility. No production deployment, load test, infrastructure-retention audit, or audited-security claim is made. No screenshots were requested or captured; verification is unit assertions, actual browser/WSS transport tests, and source checks. Playwright's ignored local HTML report is not committed; complete textual results are retained here.
