# Caret helper — issues #6 and #7

The helper implements bounded JSON framing/validation, target snapshot, app-lifetime deduplication, a persistent typed Electron-main client, and **guarded Unicode clipboard paste**. Real Windows behavioral acceptance remains **NOT RUN: needs Windows**. Clipboard save/restore and unsupported-format rejection are intentionally left to issue #8; the current one-way write is destructive. See [PASTE-RUNBOOK.md](PASTE-RUNBOOK.md) for the safety algorithm, cancellation hook, limitations, and exact real-Windows procedure.

## Wire contract

The helper reads UTF-8 JSON objects, one per LF-terminated line, from stdin and writes one JSON response per line to stdout. There is no command execution operation, arbitrary shell, or logging of request/response text. The JSON schema remains the two operations from issue #6:

```json
{"requestId":"request-1","op":"snapshot"}
{"requestId":"request-2","op":"insert","expectedTarget":{"foreground":"0x1234","focus":"0x5678"},"sessionId":"session-1","text":"Hello"}
```

Exact schemas only: extra/missing fields, wrong types, duplicate object keys (including escaped aliases), invalid UTF-8/Unicode escapes, unknown operations, and trailing input are rejected before the platform adapter is called. Handles are canonical lowercase nonzero hexadecimal strings (`0x` plus 1–16 digits, no leading zero); strings avoid JavaScript handle precision loss. Request/session IDs are 1–128 ASCII letters, digits, `_`, or `-`. Text is nonempty, valid Unicode, at most 32,768 UTF-8 bytes, and contains no NUL. The serialized line is at most 65,536 bytes, excluding LF (JSON escaping may hit the line bound before the text bound). Parsing caps nesting at 8 and values at 128.

```json
{"requestId":"request-1","ok":true,"target":{"foreground":"0x1234","focus":"0x5678"}}
{"requestId":"request-2","ok":true,"outcome":"paste_requested"}
{"requestId":"request-3","ok":false,"error":"duplicate_session"}
{"requestId":null,"ok":false,"error":"invalid_request"}
```

The four typed insert outcomes remain `target_changed`, `clipboard_busy`, `unsupported`, and `paste_requested`. `unsupported` also covers cancellation, modifier-release timeout, elevated/unknown targets and failed/short input; no new wire outcome or cancellation operation is added. Error codes remain `invalid_request`, `duplicate_request`, `duplicate_session`, `no_target`, `limit_exceeded`, and `internal_error`. A recoverable request ID is included on schema errors; unparseable/unidentified input uses `null`.

Accepted request IDs and accepted insert session IDs are reserved **before** the platform call, even if it returns an error/unsupported or throws. Duplicate IDs never reach the adapter. There is one ledger per helper process, no eviction, and at most 4,096 accepted request IDs and 4,096 session IDs. Capacity fails closed with `limit_exceeded`; it does not reset or recycle IDs. Oversized lines are drained without buffering more than the limit; partial EOF lines are rejected, not executed.

## Main-process ownership

Use `HelperClient.start(absoluteExecutablePath)` once for the application lifetime, keep it in Electron main, and close it on app shutdown. `snapshot()` returns `Target`; `insert(expectedTarget, sessionId, text, signal?)` returns `InsertOutcome`. Typed helper rejections throw `HelperRequestError`. Client validation precedes writes; at most 32 requests are pending. Startup/exit, closed pipes, timeouts, malformed/duplicate/oversized/unmatched responses, and invalid UTF-8 make the client terminal; pending/later calls reject. There are **no automatic retries or restarts**, particularly after an insert. Do not recreate the helper automatically to bypass session deduplication. Neither errors nor stderr echo user text.

Issue #7 adds an optional `AbortSignal` and explicit `cancelPendingInsert()` main hook. Pending cancellation ends the input channel so the helper can observe cancellation in its shared guard; it invalidates the client lifetime, with a 2.5-second kill deadline for hangs. A cancelled terminal client requires application restart, not automatic replay/recreation. Per-session recoverable cancellation and full tray/session/pipeline integration are not implemented here; future integration must preserve the lifetime ledger rather than silently restart after ambiguous input. A pre-aborted insert never writes; cancellation after a settled result has no effect. See the runbook for the final-guard race caveat and native pipe test.

## Build and Linux verification

Run from `products/caret/`:

```sh
bun install --frozen-lockfile
bun run lint
bun run --cwd apps/desktop test:helper-protocol
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop typecheck:helper
bun run --cwd apps/desktop build:helper
bun run --cwd apps/desktop verify:helper-secrets
```

`test:helper-protocol` retains all original C++ schema/framing/ledger fixtures and Bun client tests, adds the portable guarded-paste suite, and includes a real pipe round trip to the protocol fixture executable. Its counters and call traces are the **fake platform**, not observed Windows API behavior. The protocol-only fake intentionally retains its `unsupported` stub; the separate paste fake exercises the production shared C++ insertion algorithm and records every call.

`build:helper` uses `x86_64-w64-mingw32-g++-posix` on Linux to produce statically linked x64 `native/build/caret-helper.exe`, `protocol-fixtures.exe`, `paste-fixtures.exe`, independent `record-target.exe`, and the real native `paste-target.exe` harness. Cross-compilation proves compile/link success, **not Windows behavior**. Artifacts are ignored. `CXX` can select another compatible compiler. On Windows, use an x64 Visual Studio Developer Prompt (`cl.exe`) or x64 MinGW `g++` on PATH; the build invokes the compiler directly, without a shell.

## Required real Windows gates — NOT RUN

From `products/caret/` on a real interactive Windows 11 x64 desktop:

```sh
bun run --cwd apps/desktop build:helper
bun run --cwd apps/desktop test:windows:helper-protocol
bun run --cwd apps/desktop helper:snapshot
bun run --cwd apps/desktop test:windows:paste-target
```

The protocol/snapshot harness gives five seconds to focus Notepad and uses an independent Win32 observer (not linked to helper code) to compare both handles. Its insertion contract check now uses a deliberately stale target so it cannot mutate the clipboard or paste; duplicate session rejection is retained. This replaces the old issue-#6 assumption that every real insert is unsupported.

The issue-#7 command runs the native input hook and operator-driven target/modifier/cancellation/elevation/duplicate/failure cases; follow [PASTE-RUNBOOK.md](PASTE-RUNBOOK.md). Save the full numeric injected-event log and resulting exact-text Notepad screenshot. The failed-input return is explicitly fault-injected, not naturally reproduced from the OS. The native cancellation case uses a real helper pipe closure. All Windows-only commands refuse on Linux with exit **2**, `NOT RUN: needs Windows`. No screenshots or real-Windows results have been fabricated.

Issue-#6 committed evidence remains historical. Issue-#7 evidence lives under `evidence/paste/`, with actual host, commands, exit codes, counts and unverified items. Until a real desktop runs the gates, Windows target snapshot, Unicode insertion, modifier ordering, focus safety, cancellation, elevation rejection, and captured input behavior are **NOT RUN: needs Windows**.
