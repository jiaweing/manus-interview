Closes #4

## Scope

Implement only issue #4: single-instance startup, setup minimize/close-to-tray, Setup/Cancel/Quit tray actions, the fixed `Control+Alt+Space` toggle, bounded registration/readiness errors, busy activation rejection, and owned-shortcut cleanup. Main lifecycle logic is in new files with injected Electron APIs; only localized edits touch `src/main/index.ts` and desktop `package.json`.

`launchCaretTray(createSetupWindow, callbacks)` exposes main-owned readiness, phase, toggle, cancellation, and status hooks. Normal startup remains blocked on missing key/microphone readiness until their later issues integrate those hooks. Recording-stop toggles still work if readiness is subsequently lost. No key setup, capture, provider, overlay, or insertion implementation is added.

An explicit `CARET_TRAY_TEST_ADAPTER=1` Windows-only, unpackaged-only adapter supplies fixture readiness and emits only event/phase/foreground-handle metadata. It never captures audio. Instructions are in `products/caret/apps/desktop/tests/tray-hotkey.windows.md`. Generated desktop build output is not committed to minimize simultaneous-builder conflicts.

## Verification actually run

All output is committed under `evidence/tests/issue-04/`. The following run from `products/caret` after `export PATH=$HOME/.bun/bin:$PATH`, unless another directory is stated.

| Exact command | Exit code | Output tail |
| --- | --- | --- |
| `bun install --frozen-lockfile` | 0 | `Checked 1414 installs across 1560 packages (no changes) [4.45s]`; `EXIT_CODE=0` |
| `bun test apps/desktop/tests/tray-hotkey.test.ts` | 0 | `18 pass`; `0 fail`; `74 expect() calls`; `Ran 18 tests across 1 file. [107.00ms]`; `EXIT_CODE=0` |
| `bun run --cwd apps/desktop test:tray-hotkey` | 0 | `18 pass`; `0 fail`; `74 expect() calls`; `Ran 18 tests across 1 file. [20.00ms]`; `EXIT_CODE=0` |
| `bun run --cwd apps/desktop typecheck` | 0 | `$ tsc --noEmit -p tsconfig.json`; `EXIT_CODE=0` |
| `bun run --cwd apps/desktop build` | 0 | `out/renderer/index.html 0.35 kB`; `out/renderer/assets/index-DKor02y-.js 565.10 kB`; `✓ built in 181ms`; `EXIT_CODE=0` |
| From `products/caret/apps/desktop`: `bunx tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --types bun,node tests/tray-hotkey.test.ts` | 0 | No diagnostics; `EXIT_CODE=0` |
| From repo root after staging: `bun run --cwd products/caret/apps/desktop verify:tray-secrets` | 0 | `Secret check PASS` for staged added lines, OpenRouter/GitHub credential and private-key patterns; `EXIT_CODE=0` |
| From repo root: `git diff --cached --check` | 0 | No diagnostics; `EXIT_CODE=0` |

The **18 tests are Linux injected fixtures, not Windows evidence**. They cover second-instance exit, successful fixed registration, conflicting and throwing registration, each readiness blocker, readiness changes, busy activation, recording-stop routing, Cancel, minimize/close-to-tray, explicit Setup, shutdown unregister, pre-readiness shutdown, and development-adapter gating/events.

The staged-diff secret scan is deliberately bounded and not a comprehensive secret audit. It never echoes matching content.

## Failed optional attempts (not hidden)

Exact commands and complete retained diagnostics also appear in `evidence/tests/issue-04/README.md`:

- `bunx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --types bun,node apps/desktop/tests/tray-hotkey.test.ts` from `products/caret`: **exit 1**; output tail `error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline. Use '--ignoreConfig' to skip this error.`
- The same command with `--ignoreConfig` from `products/caret`: **exit 2**; output tail `error TS2688: Cannot find type definition file for 'node'.` Corrected desktop-workspace invocation passed above.
- `bunx biome check apps/desktop/src/main/tray-hotkey.ts apps/desktop/src/main/tray-runtime.ts apps/desktop/src/main/tray-test-adapter.ts apps/desktop/tests/tray-hotkey.test.ts`: **exit 1**; diagnostic `biome.json:46: Found an unknown key useTailwindSortedClasses`; output tail `Biome exited because the configuration resulted in errors. Please fix them.` This is an existing scaffold configuration problem, left outside issue #4. **Lint was not successfully verified.**
- First `bun run --cwd products/caret/apps/desktop verify:tray-secrets`: **exit 2**; output tail `Secret check NOT RUN: no staged additions to inspect.` Git's colorized output hid diff prefixes. Fixed by forcing `--no-color`; corrected scan passed.
- First `git diff --cached --check`: **exit 2**; output tail identifies trailing spaces in `lint-initial.log`. Logs retain diagnostics/exit outcomes with only trailing whitespace normalized; final check passed.

## NOT RUN: needs Windows

The issue's `bun run --cwd apps/desktop dev` command, run twice on a real Windows 11 desktop, was **NOT RUN: needs Windows**. No Windows desktop is attached.

Not verified: one native Caret process group/tray icon after a second launch; real global shortcut registration/conflict/unregister; Notepad's unchanged foreground handle and one actual toggle event; setup staying hidden during activation; native minimize/close-to-tray; native tray Cancel without setup activation; the requested real tray screenshot and payload-free foreground/event log. The documented fixture adapter is a way to perform those checks on Windows, not a substitute for them.

Do not treat this builder PR as Windows acceptance evidence. Do not merge without the assigned verifier/reviewer process.
