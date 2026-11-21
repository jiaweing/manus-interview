# Builder verification — #27

Date: 2026-11-21. Worktree: `/home/ubuntu/wt/flopside-i27-scaffold`, branch `flopside/i27-scaffold`, from `origin/main` at `6f65762`. Product: `/home/ubuntu/wt/flopside-i27-scaffold/products/flopside`.

| Evidence | Check | Result |
| --- | --- | --- |
| `scaffold-command.sh`, `scaffold-answers.md`, `scaffold-output.txt` | Exact Better-T-Stack command, PTY addon answers | `SCAFFOLD_EXIT=0`, project ready |
| `install.txt` | `bun install` | Exit 0 |
| `install-frozen.txt` | `bun install --frozen-lockfile` | Exit 0 |
| `dev-output.txt`, `curl-results.txt` | `WEB_PORT=3270 SERVER_PORT=3271 bun run dev`, exact root curl commands | Next and Hono listen; both return 200 |
| `lint.txt` | `bun run lint` | Exit 0; active code/config boundaries documented in product README |
| `typecheck.txt` | `bun run typecheck` | Exit 0; web/server/root runner |
| `test.txt` | `bun run test` (`bun test`) | Exit 0; 3 tests pass, 7 assertions |
| `build.txt` | `bun run build` | Exit 0; Next production build and Bun Hono bundle |
| `start.txt` | `WEB_PORT=3270 SERVER_PORT=3271 bun run start` | Both built roots return 200 |
| `env-loading.txt` | Product-root Bun dotenv loading (public port values only) | Exit 0 |
| `integration-audit.txt` | Active import graph, integration routes absent, network/listener cleanup | No generated integration initializer in runtime; no builder listeners remain |
| `secret-scan.txt` | Staged-file env/artifact and common token-format scan | No committed local env/secret or generated dependency/build artifacts |

## Generated-code compatibility fixes

The unchanged scaffold command installed successfully. Its generic startup needed product-specific unwiring before it could boot without credentials. Removed generated evlog instrumentation along with its runtime module, and removed the Varlock Next/global env hooks. Direct `bun <next CLI>` execution avoids Turbopack forwarding `--bun` into a Node subprocess's `NODE_OPTIONS`. Biome's generated `useTailwindSortedClasses` name was obsolete for the installed 2.5.15; migrated to `nursery.useSortedClasses`. Dormant generated app/package examples remain excluded from active checks, not falsely certified.

## Scope and honesty

The issue body has stale outside-repo/nested-git language. The builder assignment and swarm prompt §3 explicitly require an independent Bun workspace **inside** `products/flopside/` with `--no-git`; evidence uses that authorized layout, without editing issue acceptance text.

No poker features or socket API were added. Native Hono/Bun adapter availability is measured by the smoke test, but a real WebSocket connection is **not** yet verified. The production starter is two local Bun processes; published HTTPS/WSS, two-browser ingress and one-process hosting are #28's responsibility. Independent verification is not claimed by the builder.

Docker build: not run, no docker in sandbox. AI calls: not run, no key; unnecessary for Flopside and dormant. All builder-started dev/production listeners were shut down with scoped Ctrl-C/signal handling.
