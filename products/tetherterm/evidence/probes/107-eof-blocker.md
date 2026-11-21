# Issue #107 round-two native EOF blocker

**Historical round-two report.** The Lead approved inline-native spawning in round three; the dated amendment in `docs/pty-decision.md` and current `evidence/tests/107-builder-round3.log` supersede this blocker. The observations below are preserved, not current implementation instructions.

The branch was rebased additively onto origin/main `c9aba59e8c9aa236d4c66283945a17b6ff190d9b`. Required Session.output fixture updates and the streaming-normalized ring are implemented but uncommitted. Strict type checking passes. Pure ring tests pass. Native EOF tests fail because the existing helper allocates a reusable `new Bun.Terminal` before `Bun.spawn`.

Bun 1.4.5+a7733435c keeps its parent-side slave descriptor open for independently allocated/reusable terminals. Their native `exit` callback fires only on `terminal.close()`, not when the actual child (and all output writers) exits. This prevents genuine EOF with the current approved helper. Calling close at child exit, using drain, or inferring EOF from silence would violate the lead’s explicit decisions and is not implemented.

Passing terminal options inline to Bun.spawn permits native EOF, but Bun 1.4.5 also assigns the spawned process its own controlling session/process group. The mandated `setsid -c` wrapper then attempts a second session/controlling-terminal acquisition, forks, prints `setsid: failed to set the controlling terminal: Operation not permitted`, and does not run the requested executable. Child exit remains 0, illustrating why this is not an acceptable fix.

An inline terminal without the setsid wrapper independently proves `child.pid == PID == PGID == SID == TPGID` and native EOF. However, COMMON.md and docs/pty-decision.md explicitly prohibit plain inline spawning and require setsid -c. No such forbidden production switch has been made. The lead must decide whether to allow the pinned runtime’s native inline controlling-terminal behavior (and rerun all controlling-terminal/process-tree gates), or provide a supported API that releases only the reusable terminal’s parent slave descriptor without closing the master/output reader. There is no such method in the pinned public Bun.Terminal declaration.

Reproduction: `bun evidence/probes/107-eof-ownership.ts`. The 100 ms deadline is diagnostic only; it does not determine production completion or finalize output. Results are in `evidence/tests/107-builder-round2.log`.

Sources inspected:

- https://bun.com/docs/runtime/child-process — Reusable Terminal states explicitly that exit fires on terminal.close, not individual subprocess exit.
- https://github.com/oven-sh/bun/blob/bun-v1.4.5/src/runtime/api/bun/js_bun_spawn_bindings.rs — Inline terminals receive `pty_slave_fd` for setsid+TIOCSCTTY and close the parent slave through subprocess lifecycle; existing terminals retain it for reuse.

No commit, force push, PR-body update or merge has been performed because native acceptance gates are not green.
