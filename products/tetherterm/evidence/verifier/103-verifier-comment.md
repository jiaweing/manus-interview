## Independent verification of PR #211 — overall FAIL / `status:blocked`

Tested branch `tetherterm/103-spawn-policy`, commit `155a4a233c325a05fcd9d57b8a46ad22b1824363`, in a **fresh clean clone**, not a builder worktree: `/tmp/tetherterm-103-verifier.SBQ3p7/repo`. Bun `1.4.5`. No product source or tests were edited. The clone had an empty `git status --porcelain` before installation and after verification; tracked and staged diffs also remained empty.

**The issue cannot be verified as complete:** acceptance criterion 3 explicitly says that invalid required configuration **“prevents server startup with a readable error.”** Passing a callback-boundary unit test does not satisfy this entrypoint-level requirement. Two independent actual-process probes demonstrate that the current server starts and serves HTTP 200 with absent or explicitly invalid required configuration.

### Required commands

All product commands ran from the clean clone's `products/tetherterm`. The issue's Verification command was run verbatim.

| Command | Exit | Observed output |
| --- | ---: | --- |
| `gh issue view 103 --repo jiaweing/manus-interview` | 0 | Retrieved the issue, including all three acceptance criteria. |
| `gh repo clone jiaweing/manus-interview /tmp/tetherterm-103-verifier.SBQ3p7/repo` | 0 | Clean clone created. |
| `git checkout tetherterm/103-spawn-policy` | 0 | Checked out the PR branch. |
| `bun install --frozen-lockfile` | 0 | `1371 packages installed [3.32s]` |
| `bun test apps/server/test/spawn-policy.test.ts` | 0 | `41 pass`, `0 fail`, `198 expect() calls` |
| `bun run test` | 0 | Unit: `43 pass`, `0 fail`, `200 expect() calls`; integration: `8 pass`, `0 fail`, `100 expect() calls`; e2e: `2 pass`, `0 fail`, `6 expect() calls`. |
| `bun run check` | 0 | `Checked 23 files in 151ms. No fixes applied.` |
| `bun run check-types` | 0 | `tsc --noEmit`, no errors. |
| `bun test /tmp/tetherterm-103-verifier.SBQ3p7/103-adversarial.test.ts` | **1** | **`11 pass`, `2 fail`, `80 expect() calls`**. Both failures are actual-server bad-config startup requirements. |
| `git grep -n -E 'loadConfig\|startWithConfig\|spawnWithPolicy\|Bun.serve' -- apps/server/src` | 0 | Configuration/spawn boundary definitions exist; actual entrypoint calls `Bun.serve` directly. |
| `git show HEAD:products/tetherterm/apps/server/src/index.ts` | 0 | Actual entrypoint inspected; see gap below. |
| `git status --porcelain`; `git diff --exit-code && git diff --cached --exit-code` | 0 | No product changes. |
| `gh pr view 209 --repo jiaweing/manus-interview --json url,state,mergedAt,headRefName,headRefOid` | 0 | Sibling transport PR is `OPEN`, `mergedAt: null`. It is not included in this tested branch. |
| `gh pr view 211 --repo jiaweing/manus-interview --json headRefOid,url` | 0 | Confirmed the tested PR head still matches the commit above. |

### Acceptance criterion 1 — PASS at the provided policy/spawn module boundary

> Approved executable/cwd requests reach spawn, while forbidden executable, traversal, and symlink-escape requests return POLICY_DENIED before spawn is called.

The issue verification tests pass, including each denied-request spawn spy. Independent probes confirm:

```text
PROBE allowed nested cwd/executable: spawn_calls=1; canonical_paths=true; literal_argv=true
PROBE symlink escape: POLICY_DENIED; spawn_calls=0; readable_error=true; credential_in_diagnostics=false
PROBE dot-dot escape: POLICY_DENIED; spawn_calls=0; readable_error=true; credential_in_diagnostics=false
PROBE root vs root-evil prefix: POLICY_DENIED; spawn_calls=0; readable_error=true; credential_in_diagnostics=false
PROBE relative executable: POLICY_DENIED; spawn_calls=0; readable_error=true; credential_in_diagnostics=false
PROBE executable not on allowlist: POLICY_DENIED; spawn_calls=0; readable_error=true; credential_in_diagnostics=false
PROBE relative executable config ./python3: readable_configuration_rejection=true
```

The `/root` versus `/root-evil` containment attack was reproduced using directories named `root` and `root-evil` beneath an isolated `mkdtemp` directory; no host `/root` directory was touched. Traversal used `root/nested/../../root-evil`; an in-root symlink pointed to the sibling outside the approved root. Literal shell-looking argv was passed unchanged, not interpolated. Approved native PTY execution is also proven by the environment probes below.

This is specifically a **module-boundary pass**, not a claim that MCP/session entrypoints already use `spawnWithPolicy`; they are absent on this branch. The issue's verification specifies a spawn spy, which this implementation satisfies. Session/tool integration must use this boundary; retain coverage in follow-up work, including refs #112/#113.

### Acceptance criterion 2 — PASS at the environment/diagnostic module boundary, with real native PTY children

> A configured bearer-token and credential sentinel are absent from the child environment and application diagnostic logs.

Independent probes used runtime-generated random sentinels in `LC_TOKEN`, `LC_API_KEY`, `LC_SECRET`, `LC_PASSWORD`, `LC_AUTH`, `Credential_Sentinel`, and mixed-case/lowercase TOKEN/KEY/SECRET/PASSWORD/AUTH-like names. The `LC_*` names deliberately challenge otherwise allowlisted locale variables. Each real Python child **printed its full environment as JSON through the PTY**; the verifier parsed it and checked both variable names and sentinel values. Raw environment values were not echoed into evidence.

Two tests configured the bearer variable as ordinarily safe/allowlisted `LANG` and `TERM`, respectively; the latter also verifies that the default TERM value does not reintroduce the excluded variable.

```text
PROBE real PTY LANG: child_exit=0; tty=true; controlling=true; PID=PGID=SID=14659; child_printed_env=true; child_env_keys=HOME,LC_CTYPE,PATH,TERM,USER
PROBE real PTY LANG: TOKEN/KEY/SECRET/PASSWORD/AUTH_names_absent=true; credential_sentinel_absent=true; configured_token_var_absent=true; token_values_absent=true; diagnostics_values_absent=true
PROBE real PTY TERM: child_exit=0; tty=true; controlling=true; PID=PGID=SID=14660; child_printed_env=true; child_env_keys=HOME,LANG,PATH,USER
PROBE real PTY TERM: TOKEN/KEY/SECRET/PASSWORD/AUTH_names_absent=true; credential_sentinel_absent=true; configured_token_var_absent=true; token_values_absent=true; diagnostics_values_absent=true
PROBE diagnostics: credential_values_absent=true; terminal_content_absent=true; configured_token_absent=true; captured_static_events=5
CAPTURED_DIAGNOSTIC TetherTerm: invalid required startup configuration
CAPTURED_DIAGNOSTIC TetherTerm POLICY_DENIED: terminal request rejected by policy
CAPTURED_DIAGNOSTIC TetherTerm: approved terminal could not be started
```

The child independently confirmed TTY stdin/stdout and controlling-terminal ownership with PID=PGID=SID. A deliberately thrown spawn error containing credential/terminal sentinels was replaced with `Approved terminal could not be started`; captured diagnostics remained static. HTTP/addon diagnostics beyond the currently supplied module remain unverified until their entrypoints exist and are integrated, including refs #112/#113.

### Acceptance criterion 3 — FAIL / BLOCKED: explicit actual-startup requirement is not wired

> Configuration supplies the exact PRD security inputs, and invalid required configuration prevents server startup with a readable error.

**The configuration-module half passes:** approved root/executables, loopback hostname/port, exact tunnel hostname, and token variable name are supplied; bearer values are not retained. Invalid configuration prevents the `startWithConfig` callback; stdio loads without HTTP credentials.

```text
PROBE config module: exact_PRD_inputs=true; invalid_config_start_callback_calls=0; readable_error=true; stdio_without_HTTP_credentials=true
```

**The actual-startup half fails:** `apps/server/src/index.ts:9–16` only calls `requireSetsid()` and then `Bun.serve({ hostname: "127.0.0.1", port: Number(Bun.env.PORT ?? "3000"), ... })`. It does not import/call `loadConfig` or `startWithConfig`, ignores `TETHERTERM_PORT`, and never rejects missing/invalid approved root, executable list, tunnel hostname, or token configuration before listening. The call-site audit shows `loadConfig` only in `config.ts`, not an actual entrypoint.

Actual process observations:

```text
PROBE actual server missing-required-config: STARTED=true; ephemeral_port=39427; HTTP_STATUS=200; health_body=ok; invalid_config_rejected=false
CAPTURED_STARTUP TetherTerm listening on http://127.0.0.1:39427
PROBE actual server explicit-invalid-required-config: STARTED=true; ephemeral_port=35391; HTTP_STATUS=200; health_body=ok; invalid_config_rejected=false
CAPTURED_STARTUP TetherTerm listening on http://127.0.0.1:35391
error: AC3 requires bad config to prevent actual server startup; listening/HTTP 200 proves missing wiring
11 pass
2 fail
80 expect() calls
```

The missing-config probe supplied only `PATH` and `PORT=0`. The explicit-invalid probe additionally supplied a relative approved root, empty executable array, negative `TETHERTERM_PORT`, a URL instead of exact hostname, and a configured-but-absent bearer variable. Both actual servers listened and returned `200 ok`, rather than a readable configuration failure.

PR #209 is a sibling transport PR, currently unmerged; its existence does not prove startup enforcement on PR #211. The builder disclosed this gap honestly, but the acceptance wording requires more than the supplied callback helper. Wire validation into the actual mode-specific startup path before listening/connecting, without requiring HTTP credentials for stdio, and rerun actual-entrypoint negative tests. This required AC3 behavior is a blocker for this issue, **not merely an optional follow-up**. Broader HTTP/session/tool integration and end-to-end diagnostic checks can remain follow-ups in refs #112/#113.

### Evidence and safety

Full command/output log: `/home/ubuntu/swarm/evidence/103-verifier.log`.
Comment source: `/home/ubuntu/swarm/evidence/103-verifier-comment.md`.
Independent probe source snapshot: `/home/ubuntu/swarm/evidence/103-verifier-adversarial.test.ts` (original runnable location: `/tmp/tetherterm-103-verifier.SBQ3p7/103-adversarial.test.ts`; place this source beside a clean `repo/` clone to rerun).

All probes used unique temporary directories and ephemeral ports. Only verifier-owned server processes/groups were terminated; PTYs were closed and temporary fixture directories removed. No actual token or credential sentinel values were printed. No product source edits, commits, pushes, or issue closure were performed. **Verdicts: AC1 PASS (module boundary); AC2 PASS (module boundary + real PTY); AC3 FAIL/BLOCKED; overall FAIL / `status:blocked`.**
