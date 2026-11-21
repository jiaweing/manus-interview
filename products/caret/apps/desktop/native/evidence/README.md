# Issue #6 verification evidence

Recorded on **Linux x64, 2026-11-21**, with Bun 1.4.5, Ubuntu g++ 13.3.0, and MinGW GCC 13-posix. Base commit: `26af538dbdeb72825cdb5e0d6356d875ae787bd6`. `manifest.json` records exact commands and exit codes; each referenced `.txt` contains the retained output with trailing whitespace normalized for Git. Commands ran from `products/caret/`.

| Command | Exit | Result |
| --- | ---: | --- |
| `bun install --frozen-lockfile` | 0 | Lockfile unchanged; dependencies installed |
| `bun run --cwd apps/desktop test:helper-protocol` | 0 | 79 invalid-request fixtures, 2,000 deterministic mutations, framing/dedup/cap tests; 26 Bun tests pass, 0 fail, 100 assertions |
| `bun run --cwd apps/desktop typecheck` | 0 | Production desktop TS check passes |
| `bun run --cwd apps/desktop typecheck:helper` | 0 | Native Bun scripts/tests TS check passes |
| `bun run --cwd apps/desktop build:helper` | 0 | Real helper, fixture harness, independent recorder compile/link for Windows x64 via MinGW |
| `bun run --cwd apps/desktop verify:helper-secrets` | 0 | Scoped source/document scan passes; no credential values printed |
| `bun run --cwd apps/desktop test:windows:helper-protocol` | 2 | Linux guard only: **NOT RUN: needs Windows** |
| `bun run --cwd apps/desktop helper:snapshot` | 2 | Linux guard only: **NOT RUN: needs Windows** |
| `file apps/desktop/native/build/caret-helper.exe` | 0 | PE32+ x86-64 Windows executable |
| Scoped `bunx biome check` (full command in manifest) | 1 | Blocked before linting by unchanged scaffold `biome.json`: unknown `nursery.useTailwindSortedClasses` |
| `git diff --cached --check` | 0 | No whitespace errors across staged source and evidence files |
| Sanitizer compile and `protocol-sanitized` execution (exact commands in manifest) | 0 / 0 | All portable fixtures/mutations pass under AddressSanitizer + UndefinedBehaviorSanitizer |

The protocol's fake-platform counters show `snapshot=0 insert=0 clipboard=0 input=0` for rejected inputs, and duplicate inserts have zero adapter-call deltas. These are **fixture counters**, not native behavioral observations. The only real adapter insert outcome implemented here is `unsupported`; tests of other outcomes use fake adapters. No clipboard/input implementation or API call is added.

## Not verified

- **NOT RUN: needs Windows** — Windows-native compiler/toolchain run, actual executable startup, and desktop behavior.
- **NOT RUN: needs Windows** — focused Notepad foreground/focused-control handles compared with independently recorded Win32 handles; the executable comparison harness exists but has not run on Windows.
- **NOT RUN: needs Windows** — real desktop no-target/foreground-switch behavior and native-side-effect observations/counters.
- The issue's Windows verification command was exercised **only as a Linux guard** (exit 2). No Wine was used. Cross-compile success is not Windows behavioral acceptance.
- Scoped lint did not execute because the existing scaffold configuration fails to load; the offending configuration exists unchanged at the base commit. It is not repaired in this issue-scoped PR.
- Clipboard, paste, target recheck at insertion, restoration, and packaging remain outside this issue (#7/#8 and later integration/packaging issues). This PR must not be described as verified for those behaviors.

Follow `../README.md` on an interactive Windows desktop to complete the missing acceptance evidence before marking issue #6 verified.
