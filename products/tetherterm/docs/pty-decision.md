# Native PTY decision — issue #101

## Supported runtime and scope

Tested on **Linux x64, Bun 1.4.5 (a7733435c), util-linux setsid 2.39.3**. The root manifest records `packageManager: bun@1.4.5`, `engines.bun: 1.4.5`, and the Bun type catalog is pinned to 1.4.5. `bun.lock` locks the independent product's workspaces and dependencies. Active server runtime dependencies are Hono 4.13.18, the official `@modelcontextprotocol/sdk` 1.32.2, and Zod (resolved 4.6.7).

The existing Better-T-Stack scaffold is reused, not generated again. Per the Lead's recorded path correction, this independent Bun project lives at `products/tetherterm/` in the repository; `git rev-parse --show-toplevel` returns the enclosing repository/worktree root, not a second product Git repository. Prior scaffold evidence is in `evidence/boot/scaffold-boot.md`.

Only `apps/server` is active. Its sole boot-proof route is loopback `GET /healthz`, returning `200 ok`. This route does not expose any terminal or MCP functionality. Authentication is not weakened: the authenticated MCP transports, policy checks, session manager and tools belong to subsequent issues and are not implemented or claimed here.

## Decision: Bun.Terminal plus setsid -c

Use `apps/server/src/pty/spawn.ts`:

```typescript
const { child, terminal } = spawnPty({
  executable,
  args,
  cwd,
  env,
  cols,
  rows,
  onData,
});
```

The helper allocates a **real `Bun.Terminal`**, attaches it to `Bun.spawn`, and invokes the executable through the util-linux wrapper:

```text
setsid -c <executable> <args...>
```

`setsid` creates a session and `-c` acquires the attached PTY as that session's controlling terminal. Bun still owns all terminal creation, output callbacks, writes and resize operations. The wrapper is a native Linux utility, not a replacement PTY implementation, pipe transport, Python helper or alternative runtime.

`requireSetsid` resolves an executable `setsid` on PATH before any terminal allocation. The server calls the same dependency check **before listening**. On an unsupported OS or absent `setsid`, startup/spawn throws an actionable error, including “require util-linux setsid on PATH; install util-linux before starting the server”. There is no fallback. Unit and boot tests verify this failure mode using a unique empty PATH directory.

### Why the controlling-terminal check matters

The previous builder's plain `Bun.spawn({ terminal })` spike established TTY stdin/stdout, input/echo, ANSI preservation, dimensions and normal exit, but Python's `os.tcgetpgrp(0)` raised `ENOTTY` (errno 25). A TTY file descriptor alone is **not** proof of a controlling terminal. Plain attachment leaves the child in the parent's session/process group, so sending byte `0x03` does not supply the required foreground-group SIGINT behavior, and `kill(-pgid)` could target the server's group.

The clean comparison probe, committed at `evidence/probes/101-controlling-terminal.ts`, produced the following actual output on the tested runtime (PID values are naturally run-specific):

```text
plain (Bun subprocess pid=6342, exit=0):
TTY=True,True SIZE=os.terminal_size(columns=80, lines=24)
PID=6342 PGID=6341 SID=5576 PARENT_PGID=6341 PARENT_SID=5576
CONTROLLING=false TCGETPGRP_ERRNO=25

detached (Bun subprocess pid=6346, exit=0):
TTY=True,True SIZE=os.terminal_size(columns=80, lines=24)
PID=6346 PGID=6346 SID=6346 PARENT_PGID=6341 PARENT_SID=5576
CONTROLLING=false TCGETPGRP_ERRNO=25

setsid -c (Bun subprocess pid=6347, exit=0):
TTY=True,True SIZE=os.terminal_size(columns=80, lines=24)
PID=6347 PGID=6347 SID=6347 PARENT_PGID=6341 PARENT_SID=5576
CONTROLLING=true FOREGROUND_PGID=6347
```

`detached: true` can create a distinct group/session, as this probe shows, but still does **not** assign the controlling terminal. It is not the fix and is not used by the helper.

The Lead's supplied `/home/ubuntu/swarm/probes/t3.ts` was also executed and its output retained honestly: plain/detached reported `ENOTTY`, wrapped Python reported `^CKI`, and wrapped `bash -c 'sleep 30; echo after:$?'` exited 130. That diagnostic script itself exited 1 because its unconditional delayed input timers wrote to already-closed terminals. The committed clean probe has no such late timers and exits 0; the product spike below is the behavioral acceptance test.

### PID, session and process-group ownership

The helper deliberately uses neither Bun's `detached` option nor `setsid -f`. A freshly spawned child inherits the Bun parent's PGID, which differs from the fresh child's PID. Under util-linux, `setsid` therefore does **not** fork: it creates the session and execs the requested executable in place. `child.pid` is the real executable PID, session leader SID and process-group PGID.

The spike independently verifies `PID == Bun subprocess pid == PGID == SID == foreground PGID` for both Bash and Python, and confirms SID/PGID are distinct from the Bun test parent's. Python also directly asserts `os.tcgetpgrp(0) == os.getpgrp()` and `os.getsid(0) == os.getpid()`. Bash checks `ps`'s controlling-terminal foreground PGID and actually opens `/dev/tty`. **No different leader PID was observed**, so there is no alternate-PID discovery path. Changes to Bun spawn semantics, `detached`, `setsid -f`, or the wrapper require re-running this invariant test before trusting `process.kill(-child.pid, signal)`.

For ordinary descendants that retain the group, negative-PID SIGTERM/SIGKILL reaches the child and its descendants without hitting Bun. Deliberately detached descendants are outside the PRD's supported cleanup boundary. The test considers a descendant terminated when `/proc/<pid>/stat` is absent or records state `Z`; a zombie is already dead, and final orphan reaping is the host init's responsibility, not a claim that `kill(pid, 0)` must immediately fail.

## Rejected alternatives

- **node-pty / Node runtime:** Node's native-addon/runtime and packaging path is outside the mandated Bun delivery. It is not used as a fallback when Bun's PTY semantics need investigation.
- **Python ptyprocess:** Adds Python runtime/helper lifecycle and packaging outside the required product stack. Python is only an independently inspected child/test fixture here; it does not create or proxy product PTYs.
- **exec/spawn pipes:** Do not provide a real terminal or controlling-terminal line discipline. They cannot meet isatty, foreground CTRL-C, SIGWINCH and interactive prompt requirements. Pipes used to capture boot/curl diagnostics are not terminal sessions.
- **Plain terminal attachment or detached attachment alone:** The probes demonstrate the missing controlling-terminal ownership. TTY=true is insufficient.

## Deterministic proof and commands

From `products/tetherterm`, with Bun 1.4.5 on PATH:

```sh
bun install
bun install --frozen-lockfile
bun evidence/probes/101-controlling-terminal.ts
bun test apps/server/test/pty-spike.test.ts
for run in 1 2 3 4 5; do
  bun test apps/server/test/pty-spike.test.ts || exit
 done
bun run test
bun run check
bun run check-types
git rev-parse --show-toplevel
```

The spike contains **six tests**: a full Bash interaction; a full Python interaction; and SIGTERM/SIGKILL group-termination cases for each executable. Each full interaction asserts TTY stdin/stdout, controlling-terminal/session/group identity, input consumed and separately echoed, resize dimensions and SIGWINCH, CTRL-C behavior, and exit code 7. Bash's actual `sleep 30` is observed running in `/proc` before byte `0x03` is written; it returns 130. Python observes `KeyboardInterrupt`. Group tests launch `sleep 60 & wait` (directly in Bash, through a Bash descendant for Python), verify descendant SID/PGID, signal `-child.pid`, observe child signal exit and descendant termination, and assert Bun remains alive.

All readiness assertions use output/process-state polling with deadlines, not fixed sleeps. Bash can defer a WINCH trap while blocked in `read`, so the test sends the resize-report input before waiting for the trap output. A no-op INT trap keeps the Bash harness alive to report the **foreground sleep's** status; exec children reset caught traps, and sleep is still interrupted by real terminal SIGINT. These harness accommodations do not replace signals with direct `child.kill` calls.

Five consecutive final spike runs passed: **6/6 each, 30/30 total, 90 assertions per run**. One actual run:

```text
bash PID=PGID=SID=TPGID=6749 TTY=true ECHO=true SIGWINCH=43x132 CTRL_C=130 EXIT=7
python3 PID=PGID=SID=TPGID=6756 TTY=true ECHO=true SIGWINCH=37x101 CTRL_C=KeyboardInterrupt EXIT=7
bash GROUP=6758 GRANDCHILD=6761 SIGTERM=TREE_TERMINATED BUN_ALIVE=true
bash GROUP=6762 GRANDCHILD=6765 SIGKILL=TREE_TERMINATED BUN_ALIVE=true
python3 GROUP=6767 GRANDCHILD=6769 SIGTERM=TREE_TERMINATED BUN_ALIVE=true
python3 GROUP=6770 GRANDCHILD=6772 SIGKILL=TREE_TERMINATED BUN_ALIVE=true
6 pass, 0 fail, 90 expect() calls
```

Root `test` runs unit → integration → e2e sequentially and stops on any failure: **3 unit + 7 integration (including the six-test spike) + 2 e2e = 12 tests**, 108 assertions. The e2e test starts the actual entrypoint with **only PATH and PORT=0**, discovers the bound loopback port, runs actual curl and verifies:

```text
PORT=46017 ENV=PATH,PORT ONLY; curl /healthz: ok
HTTP_STATUS=200
```

No MongoDB, auth/payment settings or AI keys are required. Root `dev`, `start`, `build` and `check-types` target only `apps/server`. Biome/Ultracite excludes dormant web/native/extension/docs/auth/db/ui scaffold directories, coding-agent configuration and `evidence`, while checking all active server source/tests under strict TypeScript. Narrow inline lint explanations cover necessary sequential polling; no behavioral acceptance assertions are disabled.

`src/services.ts`, `src/env.server.ts` and the unused generated server `src/env.ts` are removed. The active server no longer imports Varlock. The original server `.env.schema` remains **only because the dormant db schema imports it**. Root postinstall still successfully generates the dormant web/native/db types, but deliberately does not regenerate server env imports; this does not boot any dormant runtime. Frozen installation remains a clean-clone gate.

All builder verification output, including the original blocker and intermediate corrections, is committed at `evidence/tests/101-builder.log`. The product `.gitignore` explicitly permits `evidence/tests/*.log` despite the scaffold's general `*.log` rule. No credentials or terminal secrets are recorded.
