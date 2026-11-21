# Clipboard ownership and restoration — issue #8

## Status

**NOT RUN: needs Windows.** No real Windows desktop is attached. Linux fixtures and `x86_64-w64-mingw32-g++-posix` cross-compilation do not establish Windows behavior. Wine is not evidence. This work references #8; it does not close or certify the Windows gate.

## Policy

The production `PastePlatform::insert` algorithm is shared with the recording fixture. It opens once and enumerates **before mutation**, accepting only an empty clipboard or a plain-text set containing only `CF_TEXT` (1), `CF_OEMTEXT` (7), `CF_UNICODETEXT` (13), and `CF_LOCALE` (16). Every other standard, registered, private, HTML/RTF, and image format is rejected with `unsupported`. Failure to enumerate/read also fails closed. Initial open failure is `clipboard_busy`, with zero paste requests and no retry.

The supported original is saved in RAM as Unicode text, or as an empty-clipboard marker. Win32 synthesizes Unicode for ANSI/OEM text using the clipboard locale. Restoration preserves text contents, not original ANSI encoding/locale or exact system-derived format IDs; Windows can regenerate derived text formats. An empty text value is distinct from an empty clipboard. Rich/private/image contents are never read by the production policy, saved, normalized, or mutated.

After clearing the clipboard and writing the owned Unicode payload, sequence number and exact UTF-16 payload identity are retained under the lock. The lock closes before modifier release/input. There remains only one Ctrl+V request and no insertion fallback/refocusing. After that request (or any post-mutation failure/cancellation/late target change/modifier timeout), the shared cleanup path schedules one **700 ms** wait. This is 700 ms after reaching the exit/input boundary, not before modifier release. No clipboard lock is held during that wait.

Cleanup opens once, checks both sequence and payload, then restores only if both still match. The hash is a deterministic FNV-1a-64 identity precheck; exact UTF-16 equality is also required, so a collision cannot authorize restoration. A changed sequence, including a newer copy of the identical payload, skips restoration. A payload mismatch or newly unsupported format also skips it. An originally empty clipboard is cleared without writing text. A failed owned write after a successful clear records owned-empty and uses the same conditional restore. If ownership cannot be recorded/checked or open/read/enumerate/clear/write/close fails during cleanup, the typed outcome is `clipboard_restore_failed`. It overrides a paste request or earlier rejection and means clipboard restoration failed, **not** that a paste did not already occur. There is no second open/restore/input attempt.

The 700 ms requested delay is exact in the injected-clock fixtures; Windows scheduling can deliver it later. The native report prints requested and observed wait times rather than claiming exact scheduler precision. Newer copies are checked while the clipboard is locked, before any mutation. Clipboard sequence wraparound and the final target-check/input OS race cannot be made atomic by this utility. Existing main cancellation ends helper stdin and allows the native cleanup path to finish before the existing 2.5-second hang-kill deadline. Force termination/OS crash cannot guarantee cleanup.

## Linux verification

From `products/caret/`:

```sh
bun install --frozen-lockfile
bun run lint
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop typecheck:overlay
bun run --cwd apps/desktop typecheck:helper
bun run --cwd apps/desktop build
bun run --cwd apps/desktop build:helper
bun run --cwd apps/desktop test:ipc-boundary
bun run --cwd apps/desktop test:tray-hotkey
bun run --cwd apps/desktop test:overlay
bun run --cwd apps/desktop test:helper-protocol
bun run --cwd apps/desktop verify:helper-secrets
bun run --cwd apps/desktop verify:tray-secrets
bun run --cwd apps/desktop verify:overlay-secrets
bun run --cwd apps/desktop test:windows:clipboard-policy
```

Stage scoped changes before the tray/overlay staged-diff secret scans. The final command must exit **2** with `NOT RUN: needs Windows`, without building or invoking a desktop harness. `test:helper-protocol` retains the protocol and 19 guarded-paste cases and adds the clipboard-policy fixtures and typed client outcome. The recording platform exposes open, enumerate, read, clear, write, sequence and close independently, including per-call failures, native-format/data snapshots, input counts and an injectable clock. Linux fixture hashes contain synthetic data only.

## Real Windows 11 x64 procedure — NOT RUN

Use Bun and x64 MSVC (`cl.exe` in a Developer Prompt) or MinGW `g++`. The desktop must be interactive, unlocked and non-elevated. Stop Caret and other input-injecting programs. Remove valuable clipboard data, disable clipboard history/cloud synchronization/clipboard managers, and use only scratch documents. The harness intentionally replaces the clipboard with synthetic fixtures; it does **not** read or save the user's previous clipboard. No real clipboard contents should appear in evidence.

From `products/caret/`, in PowerShell:

```powershell
bun install --frozen-lockfile
New-Item -ItemType Directory -Force apps/desktop/native/evidence/clipboard/windows | Out-Null
bun run --cwd apps/desktop test:windows:clipboard-policy 2>&1 | Tee-Object apps/desktop/native/evidence/clipboard/windows/clipboard-hash-timing.txt
$LASTEXITCODE
```

The command builds the actual Win32 helper and harness, runs the portable policy fixtures (explicitly **not** Windows evidence), then runs `clipboard-policy-windows.exe`. Type `SYNTHETIC` to authorize replacing the clipboard. Each native case requires Enter in the terminal, then five seconds to focus non-elevated Notepad. The initial target is checked to be Notepad, not the terminal. The harness never refocuses anything. Keep modifiers released. For the target-change case, after the mutation prompt switch to a second editable application within three seconds; missing the operator action fails the case.

| Native case | What is actually exercised | Required assertions |
|---|---|---|
| Plain-text / empty restore | Real clipboard writes/reads and real `SendInput` | Sentinel restored / native clipboard empty; one paste request; requested 700 ms and measured delay |
| Post-mutation cancellation | Real clipboard; explicitly injected production cancellation flag | No input; sentinel restored |
| Post-mutation target change | Real operator focus change after mutation | `target_changed`; no input; sentinel restored |
| Post-mutation input failure | Real clipboard; explicitly injected zero `SendInput` return | One failed input request; sentinel restored; no retry |
| Newer sequence / same payload | Real synthetic copy from a separate owner during the wait | New copy unchanged; no policy restoration mutation |
| Payload mismatch | Real changed clipboard bytes, sequence accessor explicitly masked to the recorded value | Payload check alone skips restore; new copy unchanged |
| HTML / RTF / bitmap / private format | Real native synthetic formats, independent raw Win32 snapshots | `unsupported`; zero writes/clears/pastes; identical before/after format IDs and all data bytes/hashes |
| Initial busy | Another thread genuinely holds `OpenClipboard` | `clipboard_busy`; policy-open count 1; paste count 0; snapshot unchanged |
| Restore busy | Another thread holds the real clipboard lock throughout cleanup | `clipboard_restore_failed`; policy-open count 2 total (one initial + one restore); no retries/overwrite |

A full native run must exit **0** and print PASS for **14 cases**. The report prints only format IDs, sizes, deterministic hashes, counters and timing—not clipboard text. It checks full native snapshot byte equality as well as reporting hashes. Observer/fixture opens are separate from the instrumented **policy-open** count. Retain the complete report, source commit, Windows version, Bun/compiler versions and exit code, then have an independent verifier rerun from a clean checkout. This harness proves clipboard policy behavior, not application acceptance: use the existing `test:windows:paste-target` gate for input-hook/operator-confirmed Notepad evidence.

The cancellation flag, input-failure return, and unchanged-sequence mismatch are labelled fault injections. They are not evidence of naturally failing Windows `SendInput`, spontaneous sequence inconsistency, or the Electron cancellation transport. The existing paste-target harness separately exercises real helper stdin closure. Neither Windows harness has been run here. Packaged tray/Notepad/Chrome integration and broader issue #21 clipboard regression remain separate gates.
