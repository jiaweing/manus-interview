# Spawn configuration and policy — issue #103

The active server's configuration loader is `apps/server/src/config.ts`. Call
`await loadConfig(mode, env)` before opening a transport, or wrap the transport's
startup callback in `startWithConfig(mode, start, env)`. Validation failures throw
a plain-text `ConfigurationError` and never include input values. The loader does
not initialize dormant scaffold addons or log environments.

Both real MCP launchers (`terminal:http` and `terminal:stdio`) await this loader
before opening a listener or connecting stdio. The legacy `src/index.ts` health
launcher also validates HTTP configuration before listening. Missing or invalid
mode-required inputs exit with code 1 and a
readable, input-free configuration message on stderr; stdio stdout remains
protocol-only. Unexpected transport/platform errors are replaced with static
startup diagnostics. Native inline Bun PTYs no longer require an external setsid
utility; see the dated amendment in [pty-decision.md](pty-decision.md).

| Environment variable | Contract |
| --- | --- |
| `TETHERTERM_APPROVED_ROOT` | Required for both modes. Absolute path to an existing directory; canonicalized with `realpath`. |
| `TETHERTERM_APPROVED_EXECUTABLES` | Required for both modes. Nonempty JSON array of literal command names on operator PATH or absolute executable paths. Every entry resolves at startup to a canonical executable file. |
| `TETHERTERM_PORT` | Loopback port, integer `0`–`65535`. Takes precedence over the legacy `PORT` alias; the alias is validated identically and used only when this key is absent. Default is `3000` when both are absent. Tests use `0`. All HTTP launchers use the validated port and hostname, always `127.0.0.1`, not configurable. |
| `TETHERTERM_TUNNEL_HOSTNAME` | Required for HTTP only. One exact DNS hostname, not a URL, wildcard, path, or hostname with port. |
| `TETHERTERM_TOKEN_ENV_VAR` | Required for HTTP only. Name of the environment variable containing the bearer token, not the token itself. |

HTTP requires a randomly generated 32-byte token, represented as 64 hex
characters, 44 padded base64 characters, or 43 unpadded base64url characters. The
operator must generate it with a cryptographically secure generator; validation
checks representation, not entropy. The token value is deliberately absent from
the returned configuration. An HTTP transport reads it from the configured
variable for bearer comparison and enforces Host/Origin/authentication separately.
Never include it in URLs or diagnostic output. Owner-trusted stdio requires no
HTTP token or tunnel hostname. If the token variable name is supplied in stdio,
it is still excluded from child environments.

## Terminal creation boundary

Session creation must use `spawnWithPolicy(config, request)` from
`apps/server/src/policy.ts`, not call the low-level PTY helper directly. The
boundary validates literal executable/arguments and `realpath`-checks the cwd
before invoking its injectable spawn callback. It then passes the canonical cwd
and the exact configured executable's canonical path as an argv array to the
inline `Bun.spawn({ terminal: { data, exit, cols, rows } })` helper, without a wrapper.
Request strings are never used to
construct shell commands. An approved interpreter may interpret its own argv:
this policy is a guardrail, **not an isolation or sandbox guarantee**.

The root itself, nested directories, and symlinks resolving inside it are
permitted. Traversal or symlink escapes, prefix-sharing sibling directories,
missing/non-directory cwd paths, relative cwd paths, and unapproved executable
names return a typed `TerminalError` with `code: "POLICY_DENIED"`. No denied
request reaches the spawn callback. Checking canonical paths cannot protect
against a malicious host user concurrently replacing directories/executables;
run unprivileged on the PRD's disposable workspace.

## Environment and diagnostics

Child environments are assembled from an allowlist: PATH, HOME, USER, LOGNAME,
SHELL, TERM, COLORTERM, LANG, LANGUAGE, LC_* locale settings, TZ, and TMPDIR. All
other variables (including scaffold addon/database/AI settings and interpreter
startup injection settings) are dropped. Names resembling credentials (`token`,
`secret`, `password`, `passwd`, `credential`, `auth`, `cookie`, `session`, `key`)
and the configured bearer variable are always excluded, even if normally
allowlisted. Parent environments are not mutated. TERM defaults to
`xterm-256color` unless TERM itself is the configured token variable.

`logDiagnostic` has a closed static event vocabulary and accepts no error object,
request, environment, or terminal bytes. Spawn failures discard raw platform
errors because those can contain argv or paths. Preserve that restriction in
entrypoint/session integrations; terminal output is untrusted in-memory data,
not diagnostic log content.

## Verification

From `products/tetherterm`:

```sh
bun install --frozen-lockfile
bun test apps/server/test/spawn-policy.test.ts
bun run test
bun run check
bun run check-types
```

The issue-named test entrypoint imports policy unit/integration and actual-process
startup suites; root
scripts independently execute those suites from their standard directories. Each
denial asserts zero spawn calls. All credential sentinels are generated only at
runtime. The real-PTY test asserts absence of credentials without printing child
environments or sentinel values. Committed command output, including intermediate
lint/type corrections, is in `evidence/tests/103-builder.log`.

Actual-process tests cover `index.ts`, `http.ts`, and `stdio.ts` with missing and
invalid required inputs. They leave stdin open with a queued initialize request,
assert exit 1, readable stderr, no startup success or stdout, no runtime token
values, and preload a transparent observer recording every `Bun.serve` call in
the owned launcher process. The observer delegates unchanged to the real listener:
a positive control gets actual HTTP 200 and verifies the socket closes on exit.
Bad configuration must fail without even attempting to open a listening socket.
Valid SDK boot tests retain empty tool discovery and
credential-free owner-trusted stdio. HTTP request authentication and tools remain
separate follow-up issues; this change does not add middleware or tools.
