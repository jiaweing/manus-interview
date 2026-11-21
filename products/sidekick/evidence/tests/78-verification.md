# #78 proxy security verification

Builder branch: `sidekick/78-proxy-security`. Verified on 2026-11-21 with Bun 1.4.5.

## Hosting status: durable gate UNMET

The reachable origin used here is `https://8787-iew64p70hi5e7f4kbrn79-5b0a26b0.sg2.manus.computer`.

This is an **EPHEMERAL sandbox forwarding URL**, forwarding HTTPS to a Bun/Hono process on local port 8787. It is **not a durable deployment**. Passing the smoke test proves temporary authenticated routing only. The sandbox can hibernate/stop forwarding; durable hosting still needs the user's permanent HTTPS host. Host-level TLS termination, exclusion of headers/bodies from ingress logs, isolation of the plain-HTTP backend, and any shared rate budget for replicas remain deployment responsibilities, not verified durable infrastructure.

A random dummy token was generated with Python `secrets.token_urlsafe(48)` and stored only in the gitignored, mode-0600 root `.env`/server process environment. It was never printed or committed. The extension's separate ignored `.env` contains only the public URL, no token/provider key. No OpenRouter integration is included: **real API check not run: no key**; #79 owns that adapter and full protocol validation.

## Commands and results

All commands ran from `products/sidekick`, after `export PATH=$HOME/.bun/bin:$PATH`. For the required verbatim test commands, the private `.env` was exported with `set -a; . ./.env; set +a` (no tracing/printing). Alternatively, the smoke/full-suite commands can use `bun --env-file=.env test ...`.

| Command | Exit | Result / evidence |
| --- | --- | --- |
| `bun install --frozen-lockfile` | 0 | Lockfile unchanged; `78-install.log`. |
| `bun run --cwd apps/server start` (via nohup) | Running service | Local port 8787; startup-only `78-server.log`; no permanent hosting implied. |
| `curl --fail --silent http://localhost:8787/` | 0 | `OK` local health check, not itself HTTPS evidence. |
| `bun test apps/server/src/agent/security.test.ts` | 0 | **48 pass, 0 fail, 143 expectations**; `78-security.log`. |
| `bun test apps/server/tests/https.smoke.test.ts` | 0 | **1 pass, 0 fail, 3 expectations** over real HTTPS; `78-https-smoke.log`. |
| `bun test` | 0 | **49 pass, 0 fail, 146 expectations**, 2 test files; `78-full-suite.log`. |
| `env -u SIDEKICK_PROXY_URL -u SIDEKICK_DEMO_TOKEN bun test apps/server/tests/https.smoke.test.ts` | **1 (expected)** | **0 pass, 1 fail**; `78-missing-host-gate.log`. Clear missing-host/token message; smoke requests not run. No passing skip. |
| `bun run typecheck` | 0 | Server including smoke tests, extension; `78-typecheck.log`. |
| `bun run check` | 0 | Biome/Ultracite; `78-check.log`. |
| `bun run fix` | 0 | Final run clean; `78-fix.log`. |
| `OPENROUTER_API_KEY=DUMMY_PROVIDER_KEY_NOT_SECRET SIDEKICK_DEMO_TOKEN=DUMMY_BUILD_TOKEN_NOT_SECRET bun run build:extension` | 0 | 13 MV3 output artifacts built with **dummy nonsecret** build sentinels; `78-build-extension.log`. |
| `bun run verify:secrets` | 0 | Scans actual private env-secret values in tracked product files, plus extension output/evidence logs; checks dummy build/live-log sentinels in outputs/logs. Never prints matches; `78-secret-scan.log`. |
| Authenticated HTTPS request with a seeded dummy sensitive body and valid shell envelope | 0 | 501 because adapter is intentionally absent; `78-live-log-sentinel.log`. The server log contains no request body or seeded sentinel. |
| `git check-ignore .env apps/extension/.env` | 0 | Both private env files ignored. |
| `git diff --check` | 0 | No whitespace errors. |

## Sanitized test tails

```text
48 pass
0 fail
143 expect() calls
Ran 48 tests across 1 file.

1 pass
0 fail
3 expect() calls
Ran 1 test across 1 file.

49 pass
0 fail
146 expect() calls
Ran 49 tests across 2 files.
```

Missing host/token intentionally fails:

```text
HTTPS hosting gate FAILED: smoke requests not run; privately supply SIDEKICK_PROXY_URL (HTTPS) and SIDEKICK_DEMO_TOKEN. An absent HTTPS host is a failing gate, not a passing skip.
0 pass
1 fail
```

Sanitized server log sample after the smoke and live body-sentinel requests:

```text
nohup: ignoring input
$ bun --env-file=../../.env src/index.ts
Started server: http://0.0.0.0:8787
```

No request/response log entries were emitted. The in-process sentinel test also captures console methods across 200/400/401/413/429/500, including a fake adapter error carrying dummy sensitive values; the captured array must be empty and the 500 body is fixed generic text.

## Scope and tooling notes

Auth is the required single static bearer check only: no accounts, DB, or provider adapter. The turn shell validates only the `goal`/`messages`/`snapshot` envelope; #79 must validate its full protocol before a provider call. Actual streamed UTF-8 bytes are bounded even with a false small Content-Length. The rate budget is a bounded, process-local fixed window shared by the one demo token; spoofed Origin/IP headers cannot create a new quota.

The mandatory checker initially failed on the existing scaffold: obsolete `useTailwindSortedClasses`, generated `.wxt` files, WXT auto-import globals, formatting, and placeholder-popup lint issues. Compatibility fixes rename the rule, exclude generated outputs, declare WXT globals, run the prescribed formatter, and correct only the baseline popup's callback/root assertion/logo metadata. No extra product features or UI work were added. The #77 manifest changes remain separate; #78 adds only public proxy URL build configuration/export.
