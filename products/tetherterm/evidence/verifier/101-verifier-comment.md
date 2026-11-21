## Independent verifier: PASS — PR #198 / issue #101

Verified branch `tetherterm/101-pty-spike` at **`829f482aa68aff37bfab4f9ebcd1b86d073cd35f`** from a **fresh clean clone**, not the builder's worktree. I did not edit product code. Final `git status --porcelain` is empty. PR head was checked again after verification and still matches the verified commit.

### Setup and authorized deviation

Read `gh issue view 101 --repo jiaweing/manus-interview` (Tasks, Acceptance criteria, Verification), `/home/ubuntu/swarm/COMMON.md`, and the Lead's comments on #100. As explicitly instructed, the already-completed scaffold was **not** rerun: the independent Bun project is `products/tetherterm/`, with the **enclosing repository** as Git root, not a separate `/home/ubuntu/workspaces/tetherterm` repository. Existing scaffold provenance is `products/tetherterm/evidence/boot/scaffold-boot.md`; it records the authorized `--no-git` setup. This PR does not change the scaffold script.

```sh
git clone https://github.com/jiaweing/manus-interview /tmp/tetherterm-101-verified.8Vv6qD1e/clone
git checkout tetherterm/101-pty-spike
cd /tmp/tetherterm-101-verified.8Vv6qD1e/clone/products/tetherterm
git rev-parse --show-toplevel
# /tmp/tetherterm-101-verified.8Vv6qD1e/clone
```

All commands above exited **0**. Runtime output: `bun --version` → `1.4.5`, `bun --revision` → `1.4.5+a7733435c`; `setsid --version` → `setsid from util-linux 2.39.3` (all exit 0).

### Acceptance criteria, checked individually

| Criterion / required subcheck | Verdict | Observed proof |
|---|---|---|
| AC1: independent scaffold/project and correct Git root, under the authorized Lead path correction | **PASS** | `pwd` returns the fresh clone's `products/tetherterm`; `git rev-parse --show-toplevel` returns that clone's enclosing repo; own `package.json`/`bun.lock`; no nested product `.git`. Scaffold script diff against `origin/main...HEAD` is empty, exit 0. Historical scaffold creation was already done, not independently rerun. |
| AC2: real child stdin/stdout TTY | **PASS** | Independent child: `TTY=true STDIN_TTY=True STDOUT_TTY=True`; spike Bash/Python summaries both report `TTY=true`. |
| AC2: output after write | **PASS** | `HELPER_WRITE_BYTES=27` then actual child output `OUTPUT_AFTER_WRITE=<independent-verifier-input>`; spike independently asserts Bash and Python responses and separate terminal echo. |
| AC2: requested resize dimensions | **PASS** | Independent resize to cols=119, rows=41: `RESIZED_DIMENSIONS=41x119`; spike: `SIGWINCH=43x132` for Bash and `SIGWINCH=37x101` for Python. |
| AC2: recorded child exit | **PASS** | `RECORDED_EXIT_CODE=7`; spike Bash and Python: `EXIT=7`, assertions check both awaited exit and `child.exitCode`. |
| AC3: Bun-only installation/test tooling | **PASS** | Actual `bun install --frozen-lockfile` and `bun test apps/server/test/pty-spike.test.ts` exit 0. Manifests pin `packageManager=bun@1.4.5`, `engines.bun=1.4.5`; no npm/pnpm/yarn/Node commands in root/server scripts. |
| AC3: no substitute PTY runtime | **PASS** | Active helper uses `new Bun.Terminal`, `Bun.spawn({terminal})`, and Linux util-linux `setsid -c`. Active source has no node-pty, Python helper, ptyprocess, child_process or pipe-based terminal. Python is only a child/test fixture; diagnostic pipes capture boot/curl output, not PTY sessions. |
| AC3: dormant scaffold features not activated | **PASS** | Only two active source files: `src/index.ts`, `src/pty/spawn.ts`. Server runtime dependencies are `@modelcontextprotocol/sdk,hono,zod`; no auth/db/payment/AI imports. Root dev/start/build/types target only server. Diff of web/native/extension/docs/auth/db/ui directories is empty (exit 0). Install's existing postinstall generates dormant types only; it does not start those runtimes. |
| Required controlling terminal and CTRL_C | **PASS** | My independently authored `/home/ubuntu/swarm/probes`-style comparison confirms plain Bun attachment raises `TCGETPGRP_ERRNO=25`, while imported repo helper gives `CONTROLLING=true TCGETPGRP=9415` and `PID=PGID=SID=9415`. Sending byte 0x03 produces actual `CTRL_C=SIGINT`. Spike verifies foreground Bash sleep status `CTRL_C=130`, Python `CTRL_C=KeyboardInterrupt`, and isolated group termination without killing Bun. |
| Required no-DB/no-key boot and curl HTTP 200 | **PASS** | Independent actual entrypoint launched from a unique empty cwd with **only PATH and PORT=0**, no `.env` or inherited keys; discovered ephemeral port 43747; actual curl returns `ok`, `HTTP_STATUS=200`, `CURL_EXIT_CODE=0`. Full e2e suite also proves boot and absent-setsid failure before listening. |
| Runtime decision/rejection documentation | **PASS** | `docs/pty-decision.md` records tested versions, native controlling-terminal limitation, approved Linux wrapper, and rejection rationale for node-pty/Node, Python ptyprocess and exec pipes. TypeScript base has `strict: true`; typecheck passes. |

### Executed gate commands and exit codes

From the clean clone's `products/tetherterm`:

| Command | Exit | Output tail / count |
|---|---:|---|
| `bun install --frozen-lockfile` | 0 | `1371 packages installed [3.84s]` |
| `bun test apps/server/test/pty-spike.test.ts` | 0 | `6 pass`, `0 fail`, `90 expect() calls` |
| Same spike, consecutive run 1/3 | 0 | `6 pass`, `0 fail`, `90 expect() calls` |
| Same spike, consecutive run 2/3 | 0 | `6 pass`, `0 fail`, `90 expect() calls` |
| Same spike, consecutive run 3/3 | 0 | `6 pass`, `0 fail`, `90 expect() calls` |
| `bun run test` | 0 | Unit 3/3 (9 assertions); integration 7/7 (93 assertions); e2e 2/2 (6 assertions): **12/12** |
| `bun run check` | 0 | `Checked 15 files in 104ms. No fixes applied.` |
| `bun run check-types` | 0 | `bun run --cwd apps/server check-types` → `tsc --noEmit` |
| `bun run /home/ubuntu/swarm/evidence/101-verifier-independent.ts` with `TETHERTERM_CLONE` pointing at this clone | 0 | `INDEPENDENT_PLAIN=PASS`, `INDEPENDENT_HELPER=PASS`, `INDEPENDENT_BOOT=PASS`, `INDEPENDENT_VERIFIER_PROBES=PASS` |
| `git status --porcelain` after all checks | 0 | Empty |

### Key actual output attached

```text
bash PID=PGID=SID=TPGID=8585 TTY=true ECHO=true SIGWINCH=43x132 CTRL_C=130 EXIT=7
python3 PID=PGID=SID=TPGID=8592 TTY=true ECHO=true SIGWINCH=37x101 CTRL_C=KeyboardInterrupt EXIT=7
bash GROUP=8594 GRANDCHILD=8597 SIGTERM=TREE_TERMINATED BUN_ALIVE=true
bash GROUP=8598 GRANDCHILD=8601 SIGKILL=TREE_TERMINATED BUN_ALIVE=true
python3 GROUP=8603 GRANDCHILD=8605 SIGTERM=TREE_TERMINATED BUN_ALIVE=true
python3 GROUP=8606 GRANDCHILD=8608 SIGKILL=TREE_TERMINATED BUN_ALIVE=true
6 pass
0 fail
90 expect() calls

=== INDEPENDENT PLAIN pid=9414 ===
TTY=true STDIN_TTY=True STDOUT_TTY=True
IDENTITY PID=9414 PGID=9323 SID=7950
CONTROLLING=false TCGETPGRP_ERRNO=25
RECORDED_EXIT_CODE=0
INDEPENDENT_PLAIN=PASS
HELPER_WRITE_BYTES=27
=== INDEPENDENT HELPER pid=9415 ===
TTY=true STDIN_TTY=True STDOUT_TTY=True
IDENTITY PID=9415 PGID=9415 SID=9415
CONTROLLING=true TCGETPGRP=9415
INITIAL_DIMENSIONS=24x80
READY
independent-verifier-input
OUTPUT_AFTER_WRITE=<independent-verifier-input>
INTERRUPT_READY
RESIZED_DIMENSIONS=41x119
^CCTRL_C=SIGINT
RECORDED_EXIT_CODE=7
INDEPENDENT_HELPER=PASS
INDEPENDENT_BOOT_ENV=PATH,PORT ONLY; CWD=unique empty directory; no .env, DB or keys
TetherTerm listening on http://127.0.0.1:43747
ok
HTTP_STATUS=200
CURL_EXIT_CODE=0
INDEPENDENT_BOOT=PASS
INDEPENDENT_VERIFIER_PROBES=PASS
```

Complete command/output evidence, including the independent probe source and inspection commands, is saved **outside the repo** at **`/home/ubuntu/swarm/evidence/101-verifier.log`**, for the Lead to commit. Independent probe source is `/home/ubuntu/swarm/evidence/101-verifier-independent.ts`; this comment body is `/home/ubuntu/swarm/evidence/101-verifier-comment.md`. An initial interactive logging wrapper failed to retain `PIPESTATUS`; its errors are preserved honestly in the log, followed by a new clean clone and reliable scripted reruns with numeric exit codes. These were logging-only errors, not failed product checks.

**Overall verdict: PASS. All issue #101 acceptance criteria pass under the explicitly authorized setup deviation; no product assertions failed, no product code was modified, and no in-scope criterion remains unverified. Applying `status:verified`; leaving the issue open.**
