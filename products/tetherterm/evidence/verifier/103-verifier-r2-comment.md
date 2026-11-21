## Independent re-verification of PR #211 — AC1/AC2/AC3 PASS; overall FAIL on required ancestry gate

I am a new independent verifier. I read the issue and its comments, `/home/ubuntu/swarm/COMMON.md`, the previous verifier log, and the previous adversarial probe. I made a fresh `mktemp -d` clone at `/tmp/tetherterm-103-verifier-r2.tseyHX/repo` and checked out `tetherterm/103-spawn-policy`, commit `5af027bff8ecf2bdf49255587ca2a08e663e577d`. The final fetched PR head still matches that tested commit. Bun is `1.4.5`.

**The earlier AC3 startup-enforcement failure is corrected and passes actual-process verification.** All required product commands and both independent adversarial suites pass. However, the explicitly required clean-clone ancestry check fails, both before testing and after the final fetch:

```text
$ git merge-base --is-ancestor origin/main HEAD
EXIT: 1
HEAD / PR head: 5af027bff8ecf2bdf49255587ca2a08e663e577d
origin/main:    4eb9f446cf2c4599a81f559833155c6bb401d463
merge-base:    cabdbf37c88f39287f35ec865b9bdef6e1a49247
```

Exact outstanding blocker: **the tested PR branch does not include the current `origin/main`**, so I cannot truthfully confirm the requested ancestry prerequisite or give an overall verified verdict. `HEAD..origin/main` contains `4aa8925`, `5c73481`, and `4eb9f44`, all unrelated Session Seven changes. This is **not a newly observed TetherTerm acceptance failure**. A builder/integrator should update the branch against current main and rerun the clean-clone gate. I did not rebase, merge, commit, push, or edit any product code/tests. Existing `status:blocked` is retained; `status:verified` is not added.

### Commands and exit codes

All product verification commands ran from the fresh clone's `products/tetherterm`. The issue's Verification command was run verbatim.

| Command / operation | Exit | Observed result |
| --- | ---: | --- |
| `gh issue view 103 --repo jiaweing/manus-interview --comments` and JSON source-of-truth retrieval | 0 | Prior evidence and all three criteria read. |
| `gh pr view 211 --repo jiaweing/manus-interview --json ...` | 0 | Correct branch/PR and tested head confirmed again at the end. |
| `gh repo clone jiaweing/manus-interview /tmp/tetherterm-103-verifier-r2.tseyHX/repo` | 0 | Fresh independent clone. |
| `git checkout tetherterm/103-spawn-policy` | 0 | PR branch checked out. |
| `git fetch origin` (initial and final) | 0 | Current main and PR refs fetched. |
| `git merge-base --is-ancestor origin/main HEAD` (initial and final) | **1** | **Required ancestry gate fails**, as detailed above. |
| `bun --version` | 0 | `1.4.5` |
| `bun install --frozen-lockfile` | 0 | `1371 packages installed [4.01s]` |
| `bun test apps/server/test/spawn-policy.test.ts` | 0 | **73 pass, 0 fail, 442 assertions** |
| `bun run test` | 0 | Unit **45/0**, 204 assertions; integration **13/0**, 137 assertions; e2e **32/0**, 248 assertions. Full suite: **90 pass, 0 fail, 589 assertions**. |
| `bun run check` | 0 | `Checked 32 files in 109ms. No fixes applied.` |
| `bun run check-types` | 0 | `tsc --noEmit`, no errors. |
| `cmp` original versus copied previous adversarial probe | 0 | Prior probe rerun unchanged beside the fresh `repo/` clone. |
| `bun test /tmp/tetherterm-103-verifier-r2.tseyHX/103-verifier-adversarial.test.ts` | 0 | **13 pass, 0 fail, 84 assertions**; both formerly failing actual-startup tests now pass. |
| `bun test /tmp/tetherterm-103-verifier-r2.tseyHX/103-verifier-r2-entrypoints.test.ts` | 0 | New independent suite: **21 pass, 0 fail, 170 assertions**. |
| Startup/config call-site `git grep` and `git show` audits | 0 | `index.ts`, `http.ts`, and `stdio.ts` await configuration validation before listening/connecting. |
| `git log` / `git rev-parse` / `git merge-base HEAD origin/main` | 0 | Recorded exact tested refs and missing-main commits. |
| `git diff --check`; `git diff --exit-code`; `git diff --cached --exit-code`; `git status --porcelain` | 0 | No source/test edits, no tracked/staged differences, empty status before evidence-only log copy. |
| Runtime sentinel scan inside the independent suite | 0 | 66 product/evidence/process log files scanned against 60 runtime-generated bearer/credential values; no matches. Raw captured stdout/stderr also checked before saving. |
| `gh issue view 103 --repo jiaweing/manus-interview --json state,labels,url` | 0 | Issue remains `OPEN` with `status:blocked`. |

`strace` was absent initially (`command -v strace`: exit 1), so I installed it solely as a verifier utility (`sudo apt-get update -qq && sudo apt-get install -y -qq strace`: exit 0; `strace --version`: exit 0, version 6.8). No product dependency or code changes were made. The full log records preparation, evidence-preservation, and final GitHub operations as well as these verification commands.

### AC1 — PASS: approved requests reach spawn; denied requests do not

> Approved executable/cwd requests reach spawn, while forbidden executable, traversal, and symlink-escape requests return POLICY_DENIED before spawn is called.

The required issue suite passes. The unchanged prior independent probe confirms an approved nested cwd/executable reaches exactly one canonical spawn with literal argv, while forbidden executable, relative executable, traversal, root-prefix sibling, and symlink escape all produce readable `POLICY_DENIED` with **zero spawn calls**. Native PTY success is also verified. This remains a policy/spawn-module boundary result; it does not claim that terminal-create tools or a session manager have been implemented by this issue.

### AC2 — PASS: bearer/credential values absent from real child environments and diagnostics

> A configured bearer-token and credential sentinel are absent from the child environment and application diagnostic logs.

The unchanged prior probe runs real Python PTY children, confirms TTY/control-terminal ownership and PID=PGID=SID, parses each child's full printed environment, and proves credential variable names/values are absent. It configures normally allowlisted `LANG` and `TERM` as token variables and proves their exclusion, including no reintroduction by a TERM default. Locale credential names and mixed-case credential names are excluded. Deliberately secret-containing spawn failures and request fields do not cross the readable error/diagnostic boundary.

My new real-launcher probes independently place runtime-only bearer and credential sentinels in the environment and, in redaction attacks, in malformed port, root, and executable-JSON inputs. **No sentinel is present in stdout, stderr, syscall logs, or saved product/evidence log files.** Captures are checked in memory; the verifier would redact a regression before persisting it. The observed captures required no redaction. No terminal content is written to application diagnostic logs.

### AC3 — PASS: exact configuration and enforcement at every real startup path

> Configuration supplies the exact PRD security inputs, and invalid required configuration prevents server startup with a readable error.

Source audit and independent configuration assertions confirm approved root/executables, loopback hostname/port, exact tunnel hostname, and configured token environment-variable name. Configuration retains no bearer value. The canonical port is validated even when legacy `PORT=0` is present.

Most importantly, `index.ts` now awaits `loadConfig("http")` before `Bun.serve`; `http.ts` does the same before creating/listening with its MCP app; and `stdio.ts` awaits `loadConfig("stdio")` before connecting its MCP transport. Startup errors are readable and raw credential-containing errors are not propagated.

I launched the **actual root scripts as processes**, not imported callbacks or mocked entrypoints:

```text
bun run terminal:stdio
bun run terminal:http
```

For **both** root launchers, missing configuration, invalid port `65536`, unset approved root, nonexistent approved root, and malformed secret-containing configuration all exit **1**, with readable non-ANSI stderr and **empty stdout**. For HTTP, both an absent token-variable setting and an absent configured token value also exit **1**. Every invalid root-launcher process tree was traced with `strace -f -e trace=bind,listen`: **zero bind calls, zero listen calls**, zero observed owned listening TCP sockets, and no live descendants afterward. Only bind/listen syscalls were recorded; environment values, request payloads, and headers were not traced.

A positive control launches the real HTTP entrypoint with valid configuration, detects real bind/listen syscalls and its owned ephemeral loopback socket, receives HTTP 200, and shuts down cleanly. This proves the failure observer is capable of detecting an actual listener rather than relying on absence of a startup log line.

Valid configurations preserve real MCP service:

```text
stdio with runtime secrets:
  SDK_initialize=OK SDK_tools/list=OK tools_count=0 SDK_errors=0
  stdout=2 complete SDK-valid JSON-RPC messages only
  readable startup diagnostic on stderr; EOF_exit=0; listening_sockets=0

stdio with NO HTTP token configuration/credentials/tunnel hostname:
  SDK_initialize=OK SDK_tools/list=OK tools_count=0 SDK_errors=0
  stdout protocol-only; EOF_exit=0

HTTP with valid configuration and an in-memory Authorization header:
  real owned ephemeral loopback listener observed
  SDK_initialize=OK SDK_tools/list=OK tools_count=0 SDK_errors=0
  stdout=EMPTY; credential_values_absent=true
  SIGTERM_exit=0; socket_after_shutdown=CLOSED; descendants_alive=0
```

The clients are the official SDK `Client` with `StdioClientTransport` and `StreamableHTTPClientTransport`. An empty tools list is the current inherited discovery contract, not a claim that the eight PRD terminal tools are complete. This verification covers startup credential requirements, policy, environment, diagnostics, and discovery; it is **not** an end-to-end claim about future tool/session wiring, request-level bearer/Host/Origin enforcement, an HTTPS tunnel, or Manus connectivity.

### Evidence and disposition

- Full command/output log: `/home/ubuntu/swarm/evidence/103-verifier-r2.log`.
- This comment source: `/home/ubuntu/swarm/evidence/103-verifier-r2-comment.md`.
- New independent probe: `/home/ubuntu/swarm/evidence/103-verifier-r2-entrypoints.test.ts` (runnable by placing it beside a fresh `repo/` clone; SDK imports intentionally resolve from that clone).
- Per-process stdout/stderr and syscall captures: `/home/ubuntu/swarm/evidence/103-verifier-r2-process-captures/`.
- Previous probe rerun verbatim: `/home/ubuntu/swarm/evidence/103-verifier-adversarial.test.ts`.

All tests use unique temporary directories, port 0/ephemeral ports, runtime-generated secrets, and only owned PID/process-tree cleanup. No product edits were made; the requested clone-local command-log copy is an evidence-only artifact. The issue is left open.

**Final judgments: AC1 PASS; AC2 PASS; AC3 PASS. Overall FAIL / `status:blocked` solely because `git merge-base --is-ancestor origin/main HEAD` exits 1.**
