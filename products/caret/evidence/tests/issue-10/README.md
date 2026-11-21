# Issue #10 builder verification

Linux sandbox; Bun 1.4.5. Builder checks, not independent verification. All commands below were run from `products/caret` unless noted. Raw final output is retained in the adjacent log files. A zero exit code for a Linux fixture or cross-build is not Windows behavior evidence.

## Final command results

| Command | Exit | Output |
| --- | ---: | --- |
| `bun install --frozen-lockfile` | 0 | `install.log` |
| `bun run lint` | 0 | `lint.log` |
| `bun run --cwd apps/desktop typecheck` | 0 | `typecheck.log` |
| `bun run --cwd apps/desktop typecheck:overlay` | 0 | `typecheck-overlay.log` |
| `bun run --cwd apps/desktop typecheck:helper` | 0 | `typecheck-helper.log` |
| `bun run --cwd apps/desktop build` | 0 | `build.log` |
| `bun run --cwd apps/desktop build:helper` | 0 | `build-helper.log` (cross-compilation only) |
| `bun run --cwd apps/desktop test:ipc-boundary` | 0 | `test-ipc-boundary.log`: 101 pass |
| `bun run --cwd apps/desktop test:tray-hotkey` | 0 | `test-tray-hotkey.log`: 18 pass |
| `bun run --cwd apps/desktop test:overlay` | 0 | `test-overlay.log`: 9 pass |
| `bun run --cwd apps/desktop test:helper-protocol` | 0 | `test-helper-protocol.log`: C++ protocol/paste/clipboard/resource fixtures and 31 client/schema tests pass |
| `bun run --cwd apps/desktop test:session` | 0 | `test-session.log`: 63 pass |
| `bun test apps/desktop/tests/session-machine.test.ts` | 0 | `session-exact.log`: 63 pass |
| `bunx biome check --write apps/desktop` | 0 | `format-final.log` |
| `bunx tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM --strict --skipLibCheck --types bun apps/desktop/tests/session-machine.test.ts` | 0 | `typecheck-session.log` (no diagnostics) |
| `bun run --cwd apps/desktop verify:helper-secrets` | 0 | `verify-helper-secrets.log` |
| `bun run --cwd apps/desktop verify:overlay-secrets` | 0 | `verify-overlay-secrets.log` |
| `bun run --cwd apps/desktop verify:tray-secrets` | 0 | `verify-tray-secrets.log` |

Secret scans were run **after `git add`**, then rerun against all staged source and forced-added final logs. This is pattern-based scanning, not a comprehensive secret audit. No screenshots or real user payloads were collected.

## Coverage and integration limits

The fake-clock suite covers immediate Starting; capture-gated Listening; toggle stop and exact 60-second cap; busy presses in snapshot/Starting/capture-complete/STT/cleanup/insertion; cancel in every active state plus idle/Done/Error; double cancel; stop/cancel races; stale concurrent snapshots/provider/insertion results; callbacks queued before cancel; exact 15/5-second deadlines both before and after timer dispatch; a response one millisecond before deadline; fresh IDs after all terminal results; stage-specific aborts; capture failure; port throws/rejections; observer/controller-factory exceptions; metadata-only IPC and tray bindings; unconnected defaults failing closed; one insertion request; and helper outcome mapping.

For cancellation/deadline paths, tests assert capture discard requested, no provider retry, and no subsequent insertion request. Cancelling Inserting occurs after its one request has already been dispatched: its signal is aborted, late completion cannot advance state, and a signal-honoring fake insertion adapter performs zero post-cancel effects. The machine cannot recall externally accepted input; real insertion safety still needs #14 and Windows verification.

Production main connects overlay/status/tray/cancel only. Snapshot/capture/STT/cleanup/insertion hooks are typed but unconnected; audio submission and key setup remain unavailable at the IPC binding pending #11/#15. No capture, provider, paste, settings or extra UI implementation was added.

### Explicitly pending

- [ ] #9 native-loop gate: **UNVERIFIED: needs Windows**.
- [ ] Windows hotkey, tray, focus, microphone release, paste and clipboard behavior: **UNVERIFIED: needs Windows**.
- [ ] End-to-end real stage integrations: **UNVERIFIED: depends on #11–#14** (readiness/setup also depends on #15).
- [ ] Real OpenRouter API checks: **not run: no key**.

**Ordering waiver:** the owner comment on epic #1 waives the #9-first ordering for **BUILDING only** (“Pls build first then test on Windows later”). It does not waive any Windows verification criterion; all remain unchecked, and a later native-gate failure may require dependent rework.

## Development attempts

Initial lint and formatting checks exited 1 before strict formatting/style fixes. The initial session run had 57 pass / 3 fail (exit 1): fixture assertions incorrectly expected an active ID after synchronous snapshot/observer exceptions had already terminated it. Those assertions were corrected without weakening termination checks; the final suite has 63 pass / 0 fail. An optional file-based TypeScript 6 check initially exited 1 because it requires `--ignoreConfig`; the corrected command above exits 0. Initial diagnostic logs remain in the builder worktree; the committed logs are final verification output.
