# Issue #133 / PR #226 — fix-round evidence

Worktree: `/home/ubuntu/wt/f133`, branch `glassroom/133-invitations`. Product root: `products/glassroom/` in the monorepo. Existing uncommitted changes from the interrupted agent were preserved and completed.

## Root causes and product fixes

1. A delayed/replayed `hashchange` read the current hash after `history.replaceState` had scrubbed it, overwriting the cached **invalid** verdict with **missing**. The handler now consumes only the event's still-current, nonempty fragment; deterministic tests cover stale replay and a genuinely corrected fragment.
2. A creator action can precede initial React StrictMode effect cleanup, including during hydration event replay. Cleanup synchronously closed the CONNECTING socket and detached its callbacks, stranding the UI at **Connecting to room**. The secret-free baseline stress probe reproduced this on profile 61 of 100: constructor at 1187ms, close while CONNECTING at 1193ms, no socket-open event, join send, or second connection. The deterministic initial-effect creator regression failed before the product fix and passed afterward. See [lifecycle-proof.txt](lifecycle-proof.txt).

Effect generations now cancel pending disposal on immediate effect replay, retaining the original socket rather than reconnecting an old room/key. Actual unmount disposes at the next microtask; pagehide still disposes immediately. Admission disposal is exactly-once, captured late callbacks/closing sockets cannot send, and a send exception becomes a terminal connection error. The no-reconnect latch is never reset.

The creator failure was not dev first-compile latency or duplicate/rejected server admission. No timeout, expectation, or existing acceptance assertion was relaxed. Navigation failures and verifier output redact secret fragments and standalone 256-bit secrets; caller-assigned ports are honoured throughout.

## Actual results

Environment: `PUBLIC_PORT=4533 NEXT_INTERNAL_PORT=5533 CHROMIUM_PATH=/usr/bin/chromium`; repeat suites additionally use `PW_NO_WEBSERVER=1` against the runner's owned stack. See [environment.json](environment.json).

| Verification | Result |
| --- | --- |
| Consecutive invitation suites against `bun run dev:https` | **10/10**, 13/13 tests each; every command exit 0 |
| Consecutive invitation suites against `bun run build` then `bun run start:https` | **10/10**, 13/13 tests each; every command exit 0 |
| All required Chromium specs against dev | **22/22**, exit 0 |
| All required Chromium specs against production | **22/22**, exit 0 |
| Frozen install, lint/format check, product typecheck, build, unit tests | All exit 0; **64 unit tests**, zero failures |
| Strict issue-test types, including the new lifecycle unit file | Exit 0 |
| Python caller-port/redaction regressions | **4/4**, exit 0 |
| `git diff --check` | Exit 0 |

The named browser gate includes **boot, preflight, signal-server, data-envelope, invitations**. The production build runs after dev is stopped because Next dev writes `.next`. Each process group is owned by this task and deliberately stopped; no shared process-kill command is used.

The interrupted pre-fix sequence (five passing dev suites followed by a failing sixth) is not counted as part of these final consecutive sequences. Its notes remain at `/home/ubuntu/evidence-tmp/f133/interrupted-sequence/`. The deterministic before/after evidence is retained separately in `lifecycle-proof.txt`.

## Commands and compact output tails

- [static-commands.json](static-commands.json): verbatim static commands and exit codes; each corresponding `.txt` has the last 15 output lines.
- [runs-commands.json](runs-commands.json): all 20 invitation suites, the production build, and both complete Chromium gates, with exit codes.
- [summary.json](summary.json): one success entry per final consecutive invitation run.
- `dev-01.txt` through `dev-10.txt`, and `prod-01.txt` through `prod-10.txt`: per-run command, exit code, and last 15 lines; all use `--reporter=list`.
- `dev-all-chromium.txt` and `prod-all-chromium.txt`: complete required-spec gate tails.
- `merge-main.txt` and `post-merge-all-chromium.txt`: final main integration and required browser gate on the merge result. The final main refresh affected only other products, not Glassroom.

Reproduce from `products/glassroom`:

```sh
export PATH=$HOME/.bun/bin:$PATH
export PUBLIC_PORT=4533 NEXT_INTERNAL_PORT=5533 CHROMIUM_PATH=/usr/bin/chromium
python3 evidence/issues/133/fix-round/gates.py
python3 evidence/issues/133/fix-round/repeat.py
```

## Acceptance criteria

- [x] PASS — exact canonical random room/secret lengths; distinct rooms; deliberate copy only, including native clipboard.
- [x] PASS — secret removed before the first `/signal` attempt; HTTP/WSS URLs and frames contain no secret; admission fields remain public-only.
- [x] PASS — missing/invalid invitations remain local; stale hashchange cannot overwrite the verdict; corrected fragments still work.
- [x] PASS — no login; third participant rejected without displacing the admitted pair.
- [x] PASS — StrictMode creator reaches Waiting for peer with one admission; real teardown is terminal and old invitations do not reconnect.

Required page/address-bar screenshots are in `products/glassroom/evidence/screens/133-joined-{page,url}.png` and `133-room-full-{page,url}.png`. Final headless suites refreshed the page-only captures; the earlier headed address-bar captures are preserved. No invitation secret is shown in either.

## Unverified

None of this fix round's required commands or acceptance criteria is unverified. Future encrypted signaling/WebRTC/chat integration and broader endpoint-security guarantees are outside issue #133. The prior optional repository-wide test-only typecheck caveat is documented in the parent evidence README; the required product typecheck and strict #133 test typecheck both pass.

PR #226 remains open; this round does not merge it. The PR comment records the pushed fix commit SHA.
