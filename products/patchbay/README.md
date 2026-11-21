# Patchbay

A Linux foreground CLI with a tool-free kernel, scaffolded independently with Better-T-Stack. Each session starts with **0 tools and 0 providers**. Only `help`, `exit`, and blank input are currently supported; plugin and agent commands belong to later issues. Read-only declarative manifest and local-package validation is available as a kernel module.

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
bun test apps/server/test/manifest.test.ts
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

## Declarative manifest validation (v1)

`apps/server/src/kernel/manifest/` is read-only and never imports or launches package code, writes registry/config files, installs dependencies, or downloads schemas. All fields below are authoritative; unknown manifest/declaration fields, including hooks, are rejected. The current host version is `0.1.0`; versions are canonical SemVer and minimum-host comparison is numeric, including prereleases. The host and the declared platform list must support Linux.

```toml
manifest_version = 1
id = "example-tool"
name = "Example Tool"
version = "1.0.0"
min_host_version = "0.1.0"
platforms = ["linux"]
permissions = ["workspace:read"]

[runtime]
argv = ["bun", "./worker.ts"]

[config]
schema = { type = "object", additionalProperties = false }
defaults = {}

[[tools]]
name = "search"
description = "Read workspace text"
input_schema = { type = "object", properties = { query = { type = "string" } }, required = ["query"], additionalProperties = false }
rpc_method = "tools/call"
required_permissions = ["workspace:read"]
```

Use `[[providers]]` for a provider such as `name = "llm@1"`, with the same declaration fields and a generic RPC method such as `services/call`. At least one tool/provider is required; unused arrays are optional and normalize to `[]`. Names must be unique across both arrays, and every required permission must be declared. Sharing an RPC method is allowed; sharing an exact capability name is not. Config and input schemas are synchronous, strict JSON Schema draft-07 objects with `type = "object"`, standard formats, and package-local `#` references only. Config defaults and embedded schema defaults are checked without coercion, data removal, or default insertion.

Runtime v1 accepts either a package-relative executable (for example `["./worker"]`, with execute permission), or a bare host interpreter immediately followed by a package-relative entry (for example `["bun", "./worker.ts"]`). Host binaries are trusted runtime dependencies, not loaded during validation. Interpreter flags/eval before the entry and shell/env wrappers are not supported. Additional arguments are literal argv elements, not shell text; standalone path operands must resolve to existing package files. Absolute executable/entry/operand paths, control characters, Windows separators, and `..` path components are rejected. The package root must be an existing local directory, not a symlink/alias. Internal file/directory symlinks are allowed; escaping or broken links anywhere in the package, special files, and missing/non-file entry paths are rejected. Returned `argv` resolves local executable/entry/operand paths to canonical files under `root`.

Public module layout (import directly from each module):

| Module under `src/kernel/manifest/` | Public API |
| --- | --- |
| `index.ts` | `validateLocalPackage(path, options?) -> Promise<ValidatedLocalPackage>` |
| `parse.ts` | `parseManifest(source, options?)`, `validateManifest(value, options?)`, `compilePluginSchema(schema)`; constants `HOST_VERSION`, `MANIFEST_VERSION`, `MANIFEST_FILENAME` |
| `paths.ts` | `validateRuntimeArgv`, `validatePackageRoot`, `validatePackageTree`, `resolvePackageFile`, `resolveRuntimeArgv` |
| `types.ts` | `PluginManifest`, `CapabilityDeclaration`, `JsonSchema`, `ManifestValidationOptions`, `ValidatedLocalPackage` |
| `errors.ts` | `ManifestValidationError`, `ManifestErrorCode`, `MANIFEST_ERROR_CODES` |
| `schema.ts` | Host-owned `manifestSchema` |

`options` accepts `hostVersion`, `platform`, and a read-only `installedIds` iterable. The installer must supply existing IDs; validation itself does not read or mutate a registry. Manifest failures carry a stable `code` and redacted `message`, with no parser/IO/schema cause retained: `INVALID_MANIFEST` (shape/TOML/SemVer), `UNSUPPORTED_MANIFEST_VERSION`, `INCOMPATIBLE_HOST_VERSION`, `INCOMPATIBLE_PLATFORM`, `DUPLICATE_PLUGIN_ID`, `INVALID_DECLARATION` (duplicate names/undeclared permission/no capabilities), `INVALID_SCHEMA`, `INVALID_DEFAULTS`, `INVALID_ARGV` (unsafe/unsupported argv), or `INVALID_PACKAGE_PATH` (root/tree/file containment). Structurally malformed argv fields use `INVALID_MANIFEST`. These are library errors, not new CLI commands or process-exit semantics.

**Trust boundary:** plugins are unsandboxed and run as the current user when enabled by later lifecycle code. Path validation is not a sandbox and cannot freeze a mutable source directory. The installer must create/revalidate the reviewed snapshot before copying/enabling it; do not treat the returned source paths as a race-free installation guarantee. Issue #53's verification tests keep an execution marker absent and compare installed registry bytes after every rejected fixture; output is in [`evidence/tests/i53-verification.log`](evidence/tests/i53-verification.log).

## Active and dormant scaffold

The active code is `apps/server/src/cli.ts`, `src/cli/`, and `src/kernel/`, with boot tests in `apps/server/test/`. Generated Next.js web, native/Expo, WXT extension, Hono management server, DB/MongoDB, auth, payments, remote AI-example, Fumadocs, UI packages, and unrelated addons are **dormant**, not Patchbay features or production plugins. The active CLI does not import or start them. Generated `dev`, `build`, `check-types`, and framework-specific scripts are retained but are not the CLI entrypoint; do not use them to run Patchbay. Installation retains the scaffold's Varlock code-generation hook without starting services.

Per swarm prompt section 3, this is a self-contained project **inside the repository**, with its own `package.json`, `bun.lock`, and `.env.example`, but **no nested `.git`**. `git rev-parse --show-toplevel` therefore reports the containing repository/worktree root, intentionally overriding issue #52's outside-repository wording.

Scaffold generation/boot evidence and the removed WXT nested `.git` are documented in [`evidence/boot/README.md`](evidence/boot/README.md). The root Biome rule name was updated from generated `useTailwindSortedClasses` to `useSortedClasses` for Biome 2.5.15; the generated server package's duplicate `type` key was removed. Final CLI verification output is in [`evidence/tests/i52-verification.log`](evidence/tests/i52-verification.log).
