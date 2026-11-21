# R17 policy release-gate tests — issue #116

Run from `products/tetherterm`:

```sh
bun test apps/server/test/requirements/policy.test.ts
bun run test
bun run check
bun run check-types
```

The issue-named entrypoint is imported by `test/integration/requirements-policy.test.ts`, so the ordinary root test gate includes the same assertions. No production implementation is changed.

## Evidence collected

Denied `SessionManager.create` requests cover non-allowlisted executable names and absolute paths, an existing relative executable, traversal outside the approved root, a realpath symlink escape, a prefix-sharing sibling, symlink-plus-traversal, relative/missing/file cwd, and credential-bearing invalid inputs. Every case checks typed `POLICY_DENIED`, zero policy spawn-seam calls, zero real `Bun.spawn` calls using a transparent native spy, zero owned PTYs, an unchanged empty registry, no newly observed Linux child process across all Bun threads, and no child-created marker. It then fills all four slots with live real PTYs, proving that the denied reservation was released rather than inspecting private counters.

Positive controls run the approved command with root, nested, and inside-root symlink cwd. Canonical cwd/executable metadata and genuine TTY checks are asserted. Environment probes print the complete child environment from a real PTY. Runtime-random sentinels cover the configured bearer variable (including normally allowlisted `LANG` and `TERM`), credential-looking names, credential-looking `LC_*` names that would otherwise be permitted, and dormant addon/database/interpreter-injection settings. Names and values must be absent; ordinary PATH/HOME and unchanged parent environments are positive controls. Neither full environments nor sentinel values are written to test output.

All application console channels are captured during manager create/output/failure/denial. A synthetic native-boundary failure containing sentinels must produce only the static sanitized error/diagnostic. A separate real PTY deliberately echoes a sentinel supplied as literal argv: the test observes it only in memory and requires empty diagnostic logs. This is not credential inheritance and the environment probes still require zero sentinel matches. The real HTTP and stdio entrypoint processes additionally run with credential/addon settings: their stdout/stderr are checked after successful initialization/discovery and after a credential-bearing configuration failure. The HTTP positive control uses an authenticated official SDK client and an ephemeral loopback port. Dormant addons are not initialized; capturing all launcher stdout/stderr is not a claim to test an addon runtime that does not exist.

Every owned PTY is killed only through its own inline-native process group (or its own PID if that group has already disappeared), awaited, and closed; owned launcher processes are awaited. The dated [PTY amendment](pty-decision.md) removes the external setsid wrapper while preserving controlling-terminal/group ownership. A final `ps` query restricted to recorded PIDs rejects any surviving live process. Approved interpreters retain host permissions: these tests make no host-isolation assertion and create no deliberately detached jobs or claim detached-job cleanup.

## Pending protocol-level coverage

On the main branch used to author this suite, `createMcpServer` advertises tool capability but registers no terminal tools. `SessionManager.create` is therefore the highest implemented create path, and native child environment inspection is performed through it, not through a fictitious MCP adapter. Launcher tests verify real transport initialization/discovery and credential-free diagnostics, **not** `terminal_create` policy results.

See #112 for wiring the eight tools and shared manager into both real transports, including mapping `TerminalError` to the PRD section 9 `isError: true` code/message result. See #117 for real-client create/read/kill/security integration through those wired tools and authenticated HTTPS, including zero-spawn/registry and credential checks at the MCP boundary. This test issue neither implements tools nor claims an HTTPS/Manus connection. Existing transport authentication tests remain separate.

Command output, including corrections and final rebased verification, is committed in `evidence/tests/116-builder.log`.
