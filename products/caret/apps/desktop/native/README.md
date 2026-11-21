# Caret helper — issue #6

This change implements the bounded JSON protocol, a persistent typed Electron-main client, and Win32 target snapshot. **It does not implement clipboard or paste:** the real `insert` adapter returns `unsupported` after validation and deduplication. Issues #7/#8 own those side effects. No renderer IPC or app/session integration is added here.

## Wire contract

The helper reads UTF-8 JSON objects, one per LF-terminated line, from stdin and writes one JSON response per line to stdout. There is no command execution operation, command-line protocol, arbitrary shell, or logging of request/response text.

```json
{"requestId":"request-1","op":"snapshot"}
{"requestId":"request-2","op":"insert","expectedTarget":{"foreground":"0x1234","focus":"0x5678"},"sessionId":"session-1","text":"Hello"}
```

Exact schemas only: extra/missing fields, wrong types, duplicate object keys (including escaped aliases), invalid UTF-8/Unicode escapes, unknown operations, and trailing input are rejected before the platform adapter is called. Handles are canonical lowercase nonzero hexadecimal strings (`0x` plus 1–16 digits, no leading zero); strings avoid JavaScript handle precision loss. Request/session IDs are 1–128 ASCII letters, digits, `_`, or `-`. Text is nonempty, valid Unicode, at most 32,768 UTF-8 bytes, and contains no NUL. The serialized line is at most 65,536 bytes, excluding LF (JSON escaping may hit the line bound before the text bound). Parsing also caps nesting at 8 and values at 128.

```json
{"requestId":"request-1","ok":true,"target":{"foreground":"0x1234","focus":"0x5678"}}
{"requestId":"request-2","ok":true,"outcome":"unsupported"}
{"requestId":"request-3","ok":false,"error":"duplicate_session"}
{"requestId":null,"ok":false,"error":"invalid_request"}
```

The four typed insert outcomes are `target_changed`, `clipboard_busy`, `unsupported`, and `paste_requested`. Only `unsupported` is produced by the real issue-#6 adapter; other outcomes are contract-tested with fake adapters. Error codes are `invalid_request`, `duplicate_request`, `duplicate_session`, `no_target`, `limit_exceeded`, and `internal_error`. A recoverable request ID is included on schema errors; unparseable/unidentified input uses `null`.

Accepted request IDs and accepted insert session IDs are reserved **before** the platform call, even if it returns an error/unsupported or throws. Duplicate IDs never reach the adapter. There is one ledger per helper process, no eviction, and at most 4,096 accepted request IDs and 4,096 session IDs. Capacity fails closed with `limit_exceeded`; it does not reset or recycle IDs. Oversized lines are drained without buffering more than the limit; partial EOF lines are rejected, not executed.

## Main-process ownership

Use `HelperClient.start(absoluteExecutablePath)` once for the application lifetime, keep that instance in Electron main, and close it on app shutdown. `snapshot()` returns `Target`; `insert(expectedTarget, sessionId, text)` returns `InsertOutcome`. Typed helper rejections throw `HelperRequestError` with an error code. Client-side validation occurs before writes; at most 32 requests are pending. Helper startup/exit, closed pipes, timeouts, malformed/duplicate/oversized/unmatched responses, and invalid UTF-8 make the client terminal: all pending calls reject, the helper is killed, and later calls reject without writing. There are **no automatic retries or restarts**, especially after insertion. A future app owner must not recreate the helper automatically to bypass session deduplication. Neither client errors nor stderr echo user text.

## Build and Linux verification

Run from `products/caret/`:

```sh
bun install --frozen-lockfile
bun run --cwd apps/desktop test:helper-protocol
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop typecheck:helper
bun run --cwd apps/desktop build:helper
bun run --cwd apps/desktop verify:helper-secrets
```

`test:helper-protocol` compiles/runs the platform-independent C++ fixtures with `g++` and runs Bun client tests, including a real pipe round trip to the fixture executable. This is protocol/client evidence only. The rejection counters report calls to the **fake platform**, not observed calls on a real Windows desktop. The fixture clipboard/input counters remain zero; rejected requests additionally assert zero snapshot/insert adapter calls.

`build:helper` uses `x86_64-w64-mingw32-g++-posix` on Linux to produce statically linked x64 `native/build/caret-helper.exe`, `protocol-fixtures.exe`, and the independent `record-target.exe` verifier. Cross-compilation proves compile/link success, **not Windows behavior**. Build artifacts are ignored. `CXX` may name another compatible compiler. On Windows, use an x64 Visual Studio Developer Prompt (`cl.exe`) or an x64 MinGW `g++` on PATH; the build invokes the compiler directly, without a shell.

## Required real Windows gate

From `products/caret/` on a real interactive Windows x64 desktop:

```sh
bun run --cwd apps/desktop build:helper
bun run --cwd apps/desktop test:windows:helper-protocol
bun run --cwd apps/desktop helper:snapshot
```

The Windows test runs the same C++ rejection/counter fixtures and Bun response/exit tests, then gives you five seconds to focus the editable input in **Notepad**. It launches a separate Win32 observer (not linked to helper code) to independently record foreground/focused-control handles and checks that the foreground process is Notepad. The real helper's `GetForegroundWindow`/`GetGUIThreadInfo` snapshot must match both recorded handles; both pairs are printed for capture. It also checks real `insert` returns `unsupported` and rejects a repeated session ID. `helper:snapshot` is the standalone snapshot/independent-comparison harness command and performs the same five-second focus/handle comparison. A changed target during comparison is a failure; refocus and rerun, do not weaken the check.

Save the command output with the PASS/FAIL results, the independently recorded and helper handle pairs, and the rejection counter lines. Separately verify no-target behavior and foreground changes on the real desktop as appropriate; Linux fixtures alone do not verify those Win32 calls. Do not use Wine as acceptance evidence. On non-Windows, both Windows-only commands exit 2 with **`NOT RUN: needs Windows`**, before executing desktop tests.

The committed evidence lists the actual host, commands, exit codes, and output. Until the real Windows gate runs, **Notepad snapshot and real Windows behavior are NOT RUN: needs Windows**. No paste/clipboard behavior can be claimed in issue #6.
