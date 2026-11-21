# Issue 132 / PR 204 — admission fix-round evidence

This replaces the earlier builder outputs. The Git root is the monorepo; all commands run in `products/glassroom`, not a separate Glassroom repository. The dedicated worktree was `/home/ubuntu/wt/f132`, tracking `origin/glassroom/132-admission`.

## Changes

Merged `origin/main` at `fde493efcc7c4ad3e0ebabf77b4eb08d3b3a9f9a` into the admission branch. Resolved `apps/server/src/index.ts` and `tests/e2e/boot.spec.ts` by preserving issue 132's admission/forwarding/teardown callbacks and successful admission assertions alongside main's secure boot, strict `https://` origin matching, proxy behavior, and insecure/foreign-origin rejection tests. Main's `bun --bun` runtime flags, disabled Next request logging, formatting, and fixed Biome evidence exclusions are retained unchanged.

Ran `bunx biome check --write` first. It safely formatted five source/test files and reported nine remaining lint errors (exit 1); `biome-first.*.txt` retains that diagnostic output. Corrected them by hand: equivalent uint64 maximum via exponentiation instead of a bit shift; property-style socket function signatures; nonshadowing browser test arguments; equivalent string-based base64url conversion instead of nested regex literals; a documented intentionally inert close mock; and template literals for the same negative test values. No tests, assertions, rejection cases, or Biome rules were removed or weakened. The final Biome run exited 0 without further edits (`biome-final.*.txt`).

The existing static audit's length-validation assertion now tolerates formatting whitespace while still requiring both bounds. No additional product feature or dependency was introduced.

## Reproduction

`python3 evidence/issues/132/verify.py` runs the commands below with `PUBLIC_PORT=4332`, `NEXT_INTERNAL_PORT=5332`, `CHROMIUM_PATH=/usr/bin/chromium`, `NEXT_TELEMETRY_DISABLED=1`, `CI=1`, and `NO_COLOR=1`. The runner preserves each command, exit code, and complete text output as `<name>.command.txt`, `<name>.exit.txt`, and `<name>.output.txt`. ANSI escapes and trailing whitespace are normalized only in captured outputs, not product code.

| Evidence prefix | Command run verbatim | Exit | Result |
| --- | --- | --- | --- |
| `install` | `bun install --frozen-lockfile` | 0 | Frozen dependencies installed; no lockfile change |
| `unit` | `bun test tests/unit/signal-server.test.ts` | 0 | 11 pass, 0 fail, 408 assertions |
| `check` | `bun run check` | 0 | 48 files checked; no fixes applied |
| `types` | `bun run check-types` | 0 | All three type-check tasks successful |
| `build` | `bun run build` | 0 | Server and Next production builds successful |
| `all-unit` | `bun test tests/unit` | 0 | 25 pass, 0 fail, 525 assertions; includes main's handshake tests |
| `e2e` | `bun run test:e2e tests/e2e/boot.spec.ts tests/e2e/signal-server.spec.ts` | 0 | All six Chromium boot/signaling tests passed |
| `static` | `python3 evidence/issues/132/static-audit.py` | 0 | Sole signal route, strict origin/cap, unchanged forwarding, no logging/decryption/persistence |
| `diff` | `git -c color.ui=false diff --check` | 0 | No whitespace errors in fix-round unstaged edits |

The issue's Verification section command, `bun test tests/unit/signal-server.test.ts`, was executed exactly. All eight required named cases passed: `creator plus one joiner`, `third participant rejected`, `duplicate role rejected`, `join nonexistent room rejected`, `socket room-role binding`, `schema and over-cap rejection`, `ciphertext forwarded unchanged`, and `termination deletes room`. Existing cap-inclusive and no-queue cases also passed.

## Acceptance criteria

- [x] **PASS — at most one creator and one joiner.** Duplicate roles, nonexistent-room joiners, and both outsider roles fail closed without evicting or forwarding to the original pair. Browser WSS checks continued bidirectional forwarding after outsiders are rejected.
- [x] **PASS — invalid schema/version, room/role spoofing, and over-cap frames are rejected without forwarding.** Every rejected-frame unit case retains zero-peer-forward assertions. Canonical room/ciphertext/counter validation, uint64 overflow, exact byte caps, malformed JSON, binary input, missing/extra fields, and forbidden message-body keys remain covered. Real WSS spoofing closes with 1008 and transport-level over-cap closes with 1009.
- [x] **PASS — opaque ciphertext is forwarded unchanged.** Unit and browser tests compare the exact original frame, including surrounding whitespace, in both directions. The source audit checks the sole Hono `/signal` route and absence of signal-core payload logging, decryption, and persistence APIs.
- [x] **PASS — admitted termination deletes the room and closes its peer.** Both-role unit teardown explicitly checks that the map no longer contains the ID, handles late callbacks, and preserves replacement admission. Browser tests verify normal-close, spoof, and over-cap teardown, nonexistent-room late join rejection, and fresh creator admission.

## Wire contract

The strict forward envelope remains `{version:1, roomId, role, operation:"forward", counter, ciphertext}` with a separate join envelope. The room ID is canonical base64url encoding of 16 bytes. Ciphertext length is derived from canonical decoding (16 through `64 * 1024 + 16` bytes), not trusted caller metadata. The whole UTF-8 JSON frame cap remains 128 KiB. Details are in `apps/server/README.md`. The server validates opaque encoding, not AES-GCM authenticity, which remains the client's responsibility.

## Evidence limits and cleanup

No requested command or issue-132 acceptance criterion remains unverified. Full client/chat integration with other unmerged issues, production deployment, load testing, infrastructure retention, and an audited-security assessment are outside this server-admission fix round; no such claims are made. Next/Playwright emitted only harmless color-environment warnings in the passing browser run.

No screenshots were requested or captured; these changes introduce no UI. Generated Playwright HTML reports and test results remain ignored and are not committed. Playwright's test-managed servers released ports 4332 and 5332 after the run. The PR is updated, not merged.
