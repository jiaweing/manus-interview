# Patchbay

A Linux foreground CLI with a tool-free kernel, scaffolded independently with Better-T-Stack. This issue establishes boot only: each session starts with **0 tools and 0 providers**. Only `help`, `exit`, and blank input are currently supported; plugin and agent commands belong to later issues.

## Setup and run

Use Bun 1.4.5 and an existing absolute `HOME` directory. From the repository root:

```sh
cd products/patchbay
bun install
bun run patchbay
```

No database, HTTP server, credentials, or `.env` file is needed. The CLI runs in the foreground, displays a prompt on a TTY, and terminates on `exit` or EOF (Ctrl-D). It does not create files in a fresh HOME. `.env.example` contains empty placeholders only; automatic dotenv loading is disabled for this boot path.

## Checks

Run these from `products/patchbay`:

```sh
bun install --frozen-lockfile
bun run typecheck
bun test apps/server/test/cli-boot.test.ts
bun run lint
bun run test
```

Typechecking, linting, and tests target only the active CLI/kernel and tests in `apps/server`. Root Biome includes are limited to those paths, with force-ignore entries preventing discovery of the dormant apps' independent configurations. Plain `bun test` is also rooted at `apps/server/test` via `bunfig.toml`.

Generated `check` (`ultracite check`) and `fix` (`ultracite fix`) scripts are retained unchanged, but Ultracite supplies scaffold-wide file paths, including dormant addons/packages and generated JSON. The optional `bun run check` currently exits `1` on those lint/format diagnostics (291 errors, 52 warnings); it is not the active CLI lint gate. Use `bun run lint`. `bun run fix` was not run because it would rewrite dormant scaffold files.

## Stable errors and process exits

Errors are written to stderr as `ERROR [CODE]: message`; raw command text and exception details are not echoed.

| Code | Meaning | Process behavior |
| --- | --- | --- |
| `UNKNOWN_COMMAND` | Input is not a supported command. | Session continues; subsequent `help`/`exit` remain usable. |
| `STARTUP_FAILED` | HOME is missing, relative, nonexistent, or not a directory. | Exit `1`, before the ready banner. |
| `UNSUPPORTED_PLATFORM` | Platform is not Linux. | Exit `1`, before the ready banner. |
| `SESSION_FAILED` | An unexpected fatal session failure occurred. | Exit `2`, with a redacted diagnostic. |

Normal EOF or `exit` returns `0`, including sessions that recover from unknown commands. For example, `printf 'foo\nhelp\n' | bun run patchbay` reports `UNKNOWN_COMMAND`, then prints the available commands and exits `0` on EOF. Exit `1` is reserved for startup failure; exit `2` is reserved for fatal session failure.

The CLI always emits plain text, so `NO_COLOR=1` (or any other `NO_COLOR` value) produces no ANSI color escapes. Unknown input containing ANSI escapes is not echoed.

## Active and dormant scaffold

The active code is `apps/server/src/cli.ts`, `src/cli/`, and `src/kernel/`, with boot tests in `apps/server/test/`. Generated Next.js web, native/Expo, WXT extension, Hono management server, DB/MongoDB, auth, payments, remote AI-example, Fumadocs, UI packages, and unrelated addons are **dormant**, not Patchbay features or production plugins. The active CLI does not import or start them. Generated `dev`, `build`, `check-types`, and framework-specific scripts are retained but are not the CLI entrypoint; do not use them to run Patchbay. Installation retains the scaffold's Varlock code-generation hook without starting services.

Per swarm prompt section 3, this is a self-contained project **inside the repository**, with its own `package.json`, `bun.lock`, and `.env.example`, but **no nested `.git`**. `git rev-parse --show-toplevel` therefore reports the containing repository/worktree root, intentionally overriding issue #52's outside-repository wording.

Scaffold generation/boot evidence and the removed WXT nested `.git` are documented in [`evidence/boot/README.md`](evidence/boot/README.md). The root Biome rule name was updated from generated `useTailwindSortedClasses` to `useSortedClasses` for Biome 2.5.15; the generated server package's duplicate `type` key was removed. Final CLI verification output is in [`evidence/tests/i52-verification.log`](evidence/tests/i52-verification.log).
