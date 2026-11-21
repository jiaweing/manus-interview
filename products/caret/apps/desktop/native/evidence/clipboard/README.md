# Issue #8 evidence — Linux only

Host: Linux x86_64 sandbox. Base: `f6e9f7a` (`origin/main` at worktree creation). Branch: `caret/08-clipboard-restore`. Real Windows desktop behavior: **NOT RUN: needs Windows**. No Wine, screenshots, user clipboard data or Windows results have been substituted.

`exits.tsv` records exact commands, exits and logs. Commands ran from `products/caret/`, with scoped source changes staged before the staged-diff secret scanners. `host.txt` identifies compilers and x64 PE artifacts. `manifest.json` hashes the evidence files. `test-helper-protocol.txt` and `sanitizer-clipboard_policy.txt` are the synthetic clipboard hash/timing reports, **not native Windows snapshots**.

| Command | Exit | Result |
|---|---:|---|
| `bun install --frozen-lockfile` | 0 | Frozen install, no lockfile changes |
| `bun run lint` | 0 | 43 files, no fixes |
| `bun run --cwd apps/desktop typecheck` | 0 | Desktop TS |
| `bun run --cwd apps/desktop typecheck:overlay` | 0 | Overlay TS |
| `bun run --cwd apps/desktop typecheck:helper` | 0 | Helper/scripts TS |
| `bun run --cwd apps/desktop build` | 0 | Electron build |
| `bun run --cwd apps/desktop build:helper` | 0 | Seven x64 PE executables via `x86_64-w64-mingw32-g++-posix`; compile/link evidence only |
| `bun run --cwd apps/desktop test:ipc-boundary` | 0 | 101 pass, 0 fail |
| `bun run --cwd apps/desktop test:tray-hotkey` | 0 | 18 pass, 0 fail |
| `bun run --cwd apps/desktop test:overlay` | 0 | 9 pass, 0 fail |
| `bun run --cwd apps/desktop test:helper-protocol` | 0 | 31 Bun tests (was 30), 79 native invalid/schema fixtures + 2,000 deterministic mutations and retained framing/Unicode/ledger cases; 19 retained guarded-paste cases; 46 new clipboard-policy cases |
| `bun run --cwd apps/desktop verify:helper-secrets` | 0 | 28 scoped source/document files |
| `bun run --cwd apps/desktop verify:tray-secrets` | 0 | Staged known-pattern scanner; not a comprehensive secret audit |
| `bun run --cwd apps/desktop verify:overlay-secrets` | 0 | Staged known-pattern scanner |
| `bun run --cwd apps/desktop test:windows:clipboard-policy` | 2 | **NOT RUN: needs Windows**, required refusal |
| `bun run --cwd apps/desktop test:windows:helper-protocol` | 2 | **NOT RUN: needs Windows**, required refusal |
| `bun run --cwd apps/desktop test:windows:paste-target` | 2 | **NOT RUN: needs Windows**, required refusal |
| `bun run --cwd apps/desktop helper:snapshot` | 2 | **NOT RUN: needs Windows**, required refusal |
| `git diff --check` | 0 | No whitespace errors |

The first full staged whitespace check exited **2** for an extra blank line at EOF in the generated `diff-check.txt` evidence header (not product code). That formatting was corrected and the staged check rerun; both outcomes are retained in `exits.tsv` and the before/after logs.

Additional real Linux checks: protocol, paste, and clipboard policy each compiled with `g++ -std=c++20 -Wall -Wextra -Werror -pedantic -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer -no-pie`, then ran with `ASAN_OPTIONS=detect_leaks=1`; all six commands exited **0**. Exact source/output paths appear in `exits.tsv`. The import audit finds the real clipboard APIs and `SendInput` in the cross-built helper, with no forbidden refocus imports. That is structural/cross-compile evidence, not Windows API behavior.

## Verified fixture coverage

The 46 clipboard-policy cases cover plain-text restore, empty clipboard vs empty Unicode text, six system-derived text format sets, post-mutation cancellation at multiple stages, both late target handles, failed/partial input and an input exception, modifier timeout, newer sequence (including same payload), payload mismatch, new unsupported formats, HTML/RTF/bitmap/DIB/private/registered/unknown formats with identical IDs/raw bytes and hashes, initial busy/paste count 0, restore busy/single open/zero retries, each initial and restore operation failure, owned-write failure from owned-empty, sequence/close recording failures, exactly 700 ms requested timer and hash byte/order/length comparison. Exact payload equality supplements the identity hash.

## Unverified

**NOT RUN: needs Windows** for the issue-named native clipboard policy command and its 14-case interactive harness: native plain/empty restoration, cancellation/target/input exit restoration, sequence/payload protection, native rich/image/private format hash preservation, real initial/restore lock contention and actual restoration timing. Windows helper protocol/snapshot, native input-hook paste/target/modifier/cancellation safety, Notepad/Chrome or packaged app acceptance, Electron's real Windows pipe/cancellation runtime and natural OS failure behavior also remain unverified. MSVC/Windows-host compiler invocation has not been tested; only Linux MinGW x64 cross-compilation has run.

The Windows harness labels cancellation-flag, input-return and masked-sequence injections explicitly. A future successful run is still not evidence of naturally failing `SendInput` or spontaneous sequence inconsistency. Follow [CLIPBOARD-RUNBOOK.md](../../CLIPBOARD-RUNBOOK.md), save `windows/clipboard-hash-timing.txt`, record source commit/host/tool versions and have an independent verifier rerun. No Windows report currently exists. Historical issue-#6/#7 evidence remains unchanged.
