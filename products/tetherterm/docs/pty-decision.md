# Native PTY decision — dated amendment for issue #107

## Amendment: 2026-11-22 (+08), Bun 1.4.5

**Current decision:** use Bun's **inline terminal option**, `Bun.spawn([executable, ...args], { terminal: { cols, rows, data, exit }, cwd, env })`, through `apps/server/src/pty/spawn.ts`. Do not allocate a reusable `new Bun.Terminal` or wrap the executable in `setsid -c`. This amendment supersedes the original issue #101 decision on terminal ownership and the util-linux dependency, with the Lead's approval.

Validated on **Linux x64, Bun 1.4.5 (a7733435c)**. The manifest and Bun type catalog remain pinned to 1.4.5. Inline spawning establishes the child's new session and controlling terminal natively (setsid + TIOCSCTTY behavior), with **Bun child PID == executable PID == PGID == SID == foreground TPGID**. This removes the Linux-only external `setsid` dependency and its startup/spawn error path. It is **still Linux-validated only; macOS has not been verified**. Removing a dependency is not a cross-platform support claim.

The active product stays `apps/server` inside the existing independent Bun project at `products/tetherterm/`. The enclosing repository/worktree is the Git root. Dormant scaffold apps/addons remain unwired. No runtime/dependency migration or authentication relaxation accompanies this change.

## Original finding and why it was incomplete

The original comparison allocated a reusable terminal first and passed that instance to `Bun.spawn`. Plain reusable attachment provided TTY file descriptors but **not a controlling terminal**: `os.tcgetpgrp(0)` raised `ENOTTY` (errno 25), and PGID/SID belonged to the Bun parent. Adding `detached: true` isolated the session/group but still did not assign a controlling terminal. With this reusable form, `setsid -c` correctly supplied the controlling session and foreground group, preserving PID identity. Those observations were valid for **reusable terminal attachment**, not for inline terminal options.

Issue #107 needed true PTY EOF to flush truncated UTF-8 only after final output. On the pinned runtime, a reusable `new Bun.Terminal` retains the parent-side slave descriptor for reuse: its `exit` callback does not fire when the child and all output writers finish. It fires on explicit `terminal.close()`. Closing at `child.exited`, using input `drain`, or guessing from silence/sleeps/timeouts would lose late output or falsely finalize the ring. None is used as a production EOF mechanism.

Inline terminal options give Bun per-subprocess ownership, permitting real native EOF. They **also** establish session and controlling-terminal ownership, so retaining the old `setsid -c` wrapper attempts a second acquisition and prints `setsid: failed to set the controlling terminal: Operation not permitted`. Inline plus wrapper is rejected.

## Fresh evidence on this machine

The ownership probe was rerun on 2026-11-21 at 23:59 (+08), before this amendment was written:

```sh
bun evidence/probes/107-eof-ownership.ts
```

Actual output (PID values are run-specific):

```text
reusable-setsid DATA "PID=81406 PGID=81406 SID=81406 TPGID=81406\r\na�"
reusable-setsid CHILD_EXIT 81406 0 null
reusable-setsid OBSERVED_AFTER_EXIT {"bytes":47,"nativeEof":false}
reusable-setsid PTY_EOF 0 null
inline-setsid DATA "setsid: failed to set the controlling terminal: Operation not permitted\r\n"
inline-setsid CHILD_EXIT 81410 0 null
inline-setsid PTY_EOF 1 null
inline-setsid OBSERVED_AFTER_EXIT {"bytes":73,"nativeEof":true}
inline-native DATA "PID=81412 PGID=81412 SID=81412 TPGID=81412\r\na�"
inline-native PTY_EOF 1 null
inline-native CHILD_EXIT 81412 0 null
inline-native OBSERVED_AFTER_EXIT {"bytes":47,"nativeEof":true}
EXIT_CODE=0
```

The reusable `PTY_EOF` line occurs **only after the probe explicitly closes it**, following `nativeEof:false`. The probe's 100-ms deadline is diagnostic only, never production completion logic. Its per-chunk display decoder is not the production streaming-normalized ring. Native terminal `exit` status `1` here denotes stream EOF/read-error, **not** child exit status: the inline child really exited `0`. The original round-two blocker and output remain historical evidence; the round-three rerun is recorded at `evidence/tests/107-builder-round3.log`.

The amended `evidence/probes/101-controlling-terminal.ts` independently compares all four forms. Fresh round-three output includes:

```text
plain reusable (Bun subprocess pid=81540, exit=0):
PID=81540 PGID=81534 SID=81400 PARENT_PGID=81534 PARENT_SID=81400
CONTROLLING=false TCGETPGRP_ERRNO=25

detached reusable (Bun subprocess pid=81544, exit=0):
PID=81544 PGID=81544 SID=81544 PARENT_PGID=81534 PARENT_SID=81400
CONTROLLING=false TCGETPGRP_ERRNO=25

setsid -c reusable (Bun subprocess pid=81545, exit=0):
PID=81545 PGID=81545 SID=81545 PARENT_PGID=81534 PARENT_SID=81400
CONTROLLING=true FOREGROUND_PGID=81545

inline native (Bun subprocess pid=81546, exit=0):
PID=81546 PGID=81546 SID=81546 PARENT_PGID=81534 PARENT_SID=81400
CONTROLLING=true FOREGROUND_PGID=81546
```

All four report TTY stdin/stdout and 80×24 dimensions. The inline case also awaits real native EOF. The probe exits `0`. This distinguishes the two APIs rather than overwriting the historical finding.

## Product API, output completion and process groups

`spawnPty({ executable, args, cwd, env, cols, rows, onData, onEof? })` returns `{ child, terminal: child.terminal, eof }`. `terminal.write(...)` and `terminal.resize(cols, rows)` operate on that native child terminal. Inline Bun ownership also owns cleanup on spawn failure; there is no separately allocated reusable terminal to leak.

The native terminal `exit` callback runs after final `data`, invokes `onEof` exactly once, then resolves `eof`. Session creation allocates its ring before spawning and finishes that same production ring synchronously from `onEof`. Child process exit has one separate observer for actual code/signal, state, live-slot release and retention. A same-group descendant may hold the PTY slave and emit final bytes **after session-leader exit**; an input/FIFO handshake integration test proves the ring waits for native EOF, not child exit. See [output-ring.md](output-ring.md) and [session-manager.md](session-manager.md).

Negative-PID signals `process.kill(-child.pid, signal)` target only the child's isolated process group. CTRL_C writes byte `0x03` to the PTY and the line discipline raises foreground-group SIGINT; it is not replaced with a direct process kill. Ordinary descendants retaining the group are covered by cleanup. Deliberately detached descendants are outside the PRD guarantee. A `/proc` entry that is absent or `Z` represents a terminated process; host init owns orphan reaping.

## Behavioral verification

`apps/server/test/pty-spike.test.ts` keeps six real-PTY behavioral tests: Bash and Python interactions, plus SIGTERM/SIGKILL group termination for both. Each interaction proves TTY descriptors, controlling-terminal identity, separate input echo/consumption, resize and real SIGWINCH, CTRL_C (Bash foreground command status 130; Python KeyboardInterrupt), and exit 7. Group cases check grandchild PGID/SID, signal the negative leader PID, observe child signal exit and descendant termination, and prove Bun survives. All six additionally verify the inline `child.terminal` handle and exactly-once native EOF before explicit cleanup closes it.

Native spawn/policy tests assert literal argv, canonical metadata, controlling-session ownership, credential exclusion and EOF. Empty-PATH tests prove a canonical executable can spawn and the authenticated health launcher can boot without `setsid`. Policy denial still occurs before native allocation; no guardrail is bypassed.

From `products/tetherterm`:

```sh
bun install --frozen-lockfile
bun run check
bun run check-types
bun run test
bun evidence/probes/107-eof-ownership.ts
bun evidence/probes/101-controlling-terminal.ts
```

Round-three evidence, including the ten consecutive targeted PTY/ring/EOF runs, is in `evidence/tests/107-builder-round3.log`. Prior issue #101 evidence remains at `evidence/tests/101-builder.log`; its external-wrapper dependency assertions are historical and superseded by this amendment.

## Alternatives still excluded

No node-pty, Node runtime fallback, Python PTY helper, or exec/spawn pipes are used for terminal sessions. Python is an independent child/test fixture, not a creator/proxy of product PTYs. Diagnostic pipes capture only launcher/probe results. A real TTY descriptor without a controlling-terminal check remains insufficient. Neither detached reusable attachment nor reusable attachment with forced-close-at-exit meets this decision.
