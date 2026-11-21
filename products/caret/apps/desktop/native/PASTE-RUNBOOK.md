# Guarded Unicode paste — issue #7

## Status and scope

**Real Windows results: NOT RUN: needs Windows.** Linux fixtures and x64 cross-compilation are not desktop behavioral evidence. Wine is not acceptance evidence. The native harness is implemented, not certified. The PR references #7 rather than closing it.

Issue #7 writes `CF_UNICODETEXT` and requests Ctrl+V once. **It intentionally overwrites the clipboard and does not restore it.** Do not use a valuable clipboard during these checks. Snapshot, supported-format rejection, the 700 ms conditional restore, and newer-copy protection belong solely to issue #8. The clearly marked `write_unicode` seam is where that issue should add them.

## Shared algorithm and main cancellation

`PastePlatform::insert` is the shared C++ state machine, used by the real Win32 adapter and Linux recording fake. Protocol validation and app-lifetime session reservation precede it, including failed attempts. It converts UTF-8 to UTF-16, checks cancellation/elevation and both target handles before writing, writes Unicode text once, waits at most **2,000 ms**, polling Ctrl OR Alt OR Space every **10 ms**, then checks elevation, both handles and cancellation again immediately before the single input call. Missing/changed target gives `target_changed`, clipboard-write failure gives `clipboard_busy`, and cancellation/modifier timeout/unknown or elevated process/input failure gives existing `unsupported`. Only a complete four-event input request gives `paste_requested`. That outcome is a request, never proof an application accepted the text.

The sole sequence is Ctrl-down, V-down, V-up, Ctrl-up. There is no Enter, typing/accessibility fallback, foreground-setting, thread attachment, or refocusing primitive. A failed or short `SendInput` batch is never retried. A **partial batch can already have pasted or left Ctrl down**, so an error is not proof of zero OS side effects. The fixtures cover 0, 1, 2 and 3 accepted events honestly; two/three accepted events can contain one V-down. Manually release Ctrl if needed and start a fresh session, never automatically replay the old one.

Electron-main callers can pass their session's `AbortSignal` to `client.insert(target, id, text, signal)` or call `client.cancelPendingInsert()`. Cancellation rejects pending calls and ends main's helper stdin, without a new JSON operation. The real adapter polls `PeekNamedPipe` for closed/unavailable input while waiting and at the final pre-input guard, including parent death. The client becomes terminal and force-kills a hung helper after 2.5 seconds; never restart it to bypass deduplication. A pre-aborted signal does not write anything. Settled inserts remove the listener. This is the localized main-client hook; full tray/session/pipeline wiring remains the later session issues.

The final cancellation/handle checks and `SendInput` are not atomic OS operations. A target change or abort after the last guard may race with input already beginning. This is not universal browser-field detection: multiple DOM fields can share native handles. Keep the caret in place. No claims of complete race elimination or universal field detection are made.

## Linux commands

From `products/caret/`:

```sh
bun install --frozen-lockfile
bun run lint
bun run --cwd apps/desktop test:helper-protocol
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop typecheck:helper
bun run --cwd apps/desktop build:helper
bun run --cwd apps/desktop verify:helper-secrets
bun run --cwd apps/desktop test:windows:paste-target
```

The last command must exit **2** with `NOT RUN: needs Windows`, before compiling or running any desktop harness. `test:helper-protocol` keeps all issue-#6 fixtures and adds the recording fake paste fixtures; the fake records every guard/write/wait/input call and checks exact ordering. `build:helper` uses `x86_64-w64-mingw32-g++-posix` and produces five x64 executables; compile success is not behavior evidence.

## Real Windows 11 x64 procedure (NOT RUN)

Use an interactive, unlocked, **non-elevated** Windows 11 desktop and Bun. Have x64 MSVC (`cl.exe`, Developer Prompt) or x64 MinGW `g++` on PATH. Keep the Caret app and other input-injecting software stopped. Arrange the terminal, Notepad, a second editable application, and the harness's two-field window so the printed prompts remain visible. Use non-sensitive scratch documents and an expendable clipboard.

From `products/caret/`, run in PowerShell:

```powershell
bun install --frozen-lockfile
New-Item -ItemType Directory -Force apps/desktop/native/evidence/paste/windows | Out-Null
bun run --cwd apps/desktop test:windows:paste-target 2>&1 | Tee-Object apps/desktop/native/evidence/paste/windows/input-events.txt
$LASTEXITCODE
```

The runner audits insertion sources for refocus APIs, builds the real native harness/helper, runs portable fixtures (clearly labeled fake), and runs `paste-target.exe`. This is operator-driven, not unattended automation. Each case waits for Enter in the terminal, then gives five seconds to focus the requested field. **Never synthesize focus in the harness.** If you miss a timing instruction, the case must fail; rerun rather than weakening checks.

| Native case | Operator action | Required evidence |
|---|---|---|
| Unicode + duplicate | Focus a completely blank non-elevated Notepad document. Leave it focused. | Tagged hook records exactly Ctrl-down/V-down/V-up/Ctrl-up; Ctrl+V=1, Enter=0. Duplicate has delta Ctrl+V=0 and no new adapter call. Entire document exactly `Jia Wei Ng — Manus 42`. |
| Modifier release | Hold Ctrl+Alt+Space at capture; release about one second after capture, within the two-second bound. | Held state observed, input only after release, Ctrl+V=1. |
| Foreground change | Initially focus Notepad; after capture switch to another app's editable field during the three-second interval. | Actual foreground handle differs; `target_changed`; Ctrl+V=0. |
| Control change | Initially focus Field A in the harness's two-field window; after capture click Field B within three seconds. | Same foreground, different native focus handle; `target_changed`; Ctrl+V=0. |
| Post-release control change | Hold Ctrl+Alt+Space with Field A focused at capture; click Field B then release within two seconds. | Real modifier wait exercised; final handle recheck rejects; Ctrl+V=0. |
| Cancellation while waiting | Hold Ctrl+Alt+Space at capture and keep holding for two seconds afterward. | A real separate helper gets an insert over inherited pipes; harness closes its stdin after 500 ms (main-client cancellation transport), helper returns `unsupported` and exits; Ctrl+V=0. |
| Elevated target | Manually start Notepad as Administrator, focus its document, keep harness non-elevated. | Independent token query must prove elevation, not silently treat access failure as elevation; `unsupported`; Ctrl+V=0. |
| Failed input + duplicate | Return to non-elevated Notepad. | Native adapter's failure return is explicitly fault-injected; one input request, no injected events, no duplicate retry. This is NOT proof of a naturally failing OS `SendInput` call. |

Every case prints Enter=0 and foreground-setting=0. The event hook records **only Caret-tagged injected events**, never physical keystrokes or surrounding text. The foreground-setting claim is structural: no refocus primitive exists and the runner audits actual insertion source; it is not a fabricated Windows API-call counter. If desired, verify helper imports independently with `dumpbin /imports` or `objdump -p`; no foreground-setting/thread-attachment API should be imported.

Immediately after the Unicode case, before moving focus or continuing, save a screenshot of the resulting Notepad document as `apps/desktop/native/evidence/paste/windows/notepad-unicode.png` using Windows Snipping Tool. The harness explicitly asks you to type `YES` only after observing the exact entire document. The screenshot and your confirmation are the result-text evidence; the harness does not infer application acceptance from `SendInput`. No screenshot currently exists because this gate is NOT RUN.

Retain the complete input-event log, screenshot, Windows version, compiler/Bun versions, exit code, and source commit. A successful complete run must exit 0 and print PASS for all listed cases. A hook, handle, elevation, modifier, confirmation, or cancellation failure must exit nonzero. Have an independent verifier rerun from a clean clone. Natural OS input-failure behavior and Electron runtime pipe semantics remain unverified until separately exercised on Windows; the native harness checks the shared failure-return contract and equivalent pipe cancellation transport.

No issue-#8 clipboard preservation, packaged tray/hotkey loop, cloud processing, or end-to-end application acceptance beyond the operator-confirmed Notepad fixture is covered here.
