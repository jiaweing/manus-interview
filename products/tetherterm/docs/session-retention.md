# Exited-session retention — issue #105

`SessionRetention` in `apps/server/src/sessions/retention.ts` owns retention only. The manager's actual `child.exited` event continues to set `state: "exited"`, nullable native `exitCode`/`signal`, and release the live slot, then calls `retain(record)`. Silence never changes lifecycle state. Runtime enforcement and process termination remain separate services.

An exited record remains addressable for exactly `EXIT_RETENTION_MS` (300,000 ms), measured from the exit event on the manager's injected clock, not from creation or the last output. `get`/`status`, `list`, and insertion synchronously prune expired records. A cancellable, unreferenced timer also removes expired records even when no client polls. Early timer callbacks cannot expire records ahead of the injected clock. Expired and capacity-evicted IDs produce `NOT_FOUND` through the existing manager lookup.

`MAX_SESSION_RECORDS` is sixteen **total registry records**, including running/terminating sessions. Insertion or actual exit evicts only the oldest exited records when needed; equal-clock exits use event order. Running and terminating records are never evicted. Retained exits do not count against the independent four-live-session limit.

Retention preserves the original `Session` object and attached resources without clearing or transforming output. Its PTY stays open during retention so final native data callbacks can still drain; expiry/eviction cancels the timer, removes retention metadata and the registry reference, and closes the native terminal. The removed record and its attached output/queues then become collectible when other services release their references. There are no repeating polling timers or per-record event listeners installed by this service.

The output ring and public cursor-read API belong to issue #107 and are deliberately not implemented here. The final-output lifecycle test observes real PTY data through the approved spawn seam and attaches a test-only buffer to the record, proving that retention keeps both the same record and final ANSI-bearing bytes until expiry. That is not a claim of a production buffered-read API before the ring change is integrated.

Run `bun test apps/server/test/session-exit-retention.test.ts` for the exact issue verification. It registers five controllable-clock/scheduler unit cases and five real-PTY lifecycle cases. The root unit gate also registers the same five deterministic cases, and an integration wrapper includes the named suite in `bun run test`. All test-created PTYs are awaited, group-cleaned by their own PIDs only, and audited with `ps`; teardown advances the injected clock to cancel every retention timer belonging to these fixtures. No test waits five real minutes.

This document updates the retention boundary described by the earlier issue #104 `session-manager.md`; it does not add kill, runtime-expiry, output-ring, input, resize, or transport-tool behavior.
