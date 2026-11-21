# Issue #7 verification evidence

Host: **Linux x64**, Bun 1.4.5. Branch: `caret/07-guarded-paste`, based on `origin/main` at `1a8e5a6`. This is builder verification, not independent verification. **Windows acceptance: NOT RUN: needs Windows.** No Wine evidence, Windows screenshots, or desktop-pass claims are included.

All commands below run from `products/caret/`. Each `.txt` file includes its exact command, host and exit code. `exits.tsv` is the final command summary. Historical development lint output and pre-staging scanner refusals are retained separately, not treated as final passing results.

| Command | Final exit | Result |
|---|---:|---|
| `bun install --frozen-lockfile` | 0 | Frozen lockfile install; no dependency changes |
| `bun run lint` | 0 | Biome/Ultracite desktop scope clean |
| `bun run --cwd apps/desktop test:ipc-boundary` | 0 | 101 pass, 0 fail; unchanged |
| `bun run --cwd apps/desktop test:tray-hotkey` | 0 | 18 pass, 0 fail; unchanged |
| `bun run --cwd apps/desktop test:overlay` | 0 | 9 pass, 0 fail; unchanged |
| `bun run --cwd apps/desktop test:helper-protocol` | 0 | 30 Bun tests, 0 fail (26 original + 4 cancellation tests); original 79 schema fixtures and 2,000 mutations retained; 19 new guarded-paste cases |
| `bun run --cwd apps/desktop typecheck` | 0 | Desktop TypeScript |
| `bun run --cwd apps/desktop typecheck:overlay` | 0 | Overlay TypeScript |
| `bun run --cwd apps/desktop typecheck:helper` | 0 | Helper script/test TypeScript |
| `bun run --cwd apps/desktop build` | 0 | Electron production build |
| `bun run --cwd apps/desktop build:helper` | 0 | Five x64 PE executables built with `x86_64-w64-mingw32-g++-posix`; compile/link evidence only |
| `bun run --cwd apps/desktop verify:helper-secrets` | 0 | Helper source/document scan |
| `bun run --cwd apps/desktop verify:overlay-secrets` | 0 | Staged additions scan |
| `bun run --cwd apps/desktop verify:tray-secrets` | 0 | Staged additions scan |
| `bun run --cwd apps/desktop test:windows:paste-target` | 2 | **NOT RUN: needs Windows**; correct Linux refusal, not a passed native gate |
| `bun run --cwd apps/desktop test:windows:helper-protocol` | 2 | **NOT RUN: needs Windows** |
| `bun run --cwd apps/desktop helper:snapshot` | 2 | **NOT RUN: needs Windows** |
| `git diff --check` | 0 | No whitespace errors |

Total Bun tests: **158 pass, 0 fail**, versus **154 original tests**. No original test was removed or weakened. C++ protocol fixtures remain unchanged; new paste cases run the real shared insertion state machine against a fake platform that records every call. Success has exactly one Ctrl+V; target-change/cancellation/elevation/zero-input-failure cases have zero; all have zero Enter and no refocus primitive. Additional partial-input cases intentionally expose that 2–3 accepted events can already include one V-down; they still make only one request and never retry. These are **fake-platform safety assertions**, not observed Windows desktop results.

Supplemental checks: `sanitizer-protocol.txt` and `sanitizer-paste.txt` include exact g++ ASan/UBSan compile/run commands, both compile and run exit 0. `import-audit.txt` records the cross-built helper's allowed read-only focus/clipboard/input imports and confirms no forbidden refocus/thread-attachment import. This is static evidence only.

Development history: the first lint attempt exited 1 for formatting in three newly edited TS files, then scoped `bunx biome check --write ...` exited 0 and final full lint exited 0. The first overlay/tray secret checks exited 1/2 solely because nothing was staged; their logs explicitly say NOT RUN. After staging the scoped changes, both exit 0. Scanners were not changed or weakened.

## Unverified / not done

- **NOT RUN: needs Windows** — exact `Jia Wei Ng — Manus 42` Notepad insertion and screenshot.
- **NOT RUN: needs Windows** — real Ctrl/Alt/Space release ordering and bounded modifier wait.
- **NOT RUN: needs Windows** — actual foreground/focused-control changes, including post-wait recheck; zero wrong-window pastes.
- **NOT RUN: needs Windows** — cancellation while waiting through the real helper's input-channel closure, and Electron's Windows child-pipe runtime behavior.
- **NOT RUN: needs Windows** — real elevated target rejection, tagged input-event log showing only Ctrl+V/no Enter, and duplicate-session behavior.
- **NOT RUN: needs Windows** — native failed-input return test; the harness explicitly fault-injects failure. A naturally failing/partial OS SendInput batch has not been induced.
- **NOT RUN: needs Windows** — legacy independent Notepad target snapshot comparison and the Windows compiler/native harness execution.
- Independent verifier rerun is not performed by this builder.

The real native harness and human runbook are in `../../tests/paste_target.cpp` and `../../PASTE-RUNBOOK.md`. It observes actual tagged injected keyboard events, requires a human's exact-text confirmation and screenshot, exercises real handle/modifier/elevation queries, and uses a real helper process for pending cancellation. Its failed-input case is transparently fault-injected; foreground-setting counts are structural/source-audit claims, not invented OS trace counters.

Known limits: final target/cancellation checks are not atomic with SendInput; browser DOM fields may share native handles. Pending cancellation intentionally invalidates the current helper client lifetime rather than resetting its ledger; no automatic restart/retry is added. Full recoverable session/tray/pipeline integration belongs to later issues. **No clipboard snapshot, 700 ms restoration, ownership check, or unsupported-format rejection is implemented** — those are issue #8, and the current clipboard write is intentionally destructive.
