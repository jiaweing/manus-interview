# Sidekick

Supervised Chrome side-panel agent (WXT + Hono proxy). Built from the Better-T-Stack scaffold, trimmed to the two retained apps.

- `apps/extension`: WXT (React) MV3 extension.
- `apps/server`: Hono proxy on Bun.

```bash
# Public origin only; never export a token/provider key with a WXT_ prefix.
export WXT_SIDEKICK_PROXY_URL=https://proxy.example.com # use your HTTPS host
bun install --frozen-lockfile
cp .env.example .env
# Edit the gitignored .env privately: SIDEKICK_DEMO_TOKEN must be nonempty.
bun run typecheck
bun run dev:server
bun run dev:extension
bun run build:extension   # apps/extension/.output/chrome-mv3/manifest.json
```

## Proxy security and configuration (#78)

The server explicitly loads `products/sidekick/.env`; automatic Bun environment loading stays disabled. Set a privately generated, high-entropy `SIDEKICK_DEMO_TOKEN`. No token or provider key belongs in source code, shell history, logs, screenshots, or `WXT_`/`VITE_` variables. `.env.example` contains no real secret values.

`SIDEKICK_PROXY_URL` is the public **origin**, without credentials, path, query, or fragment. Set `NODE_ENV=production` to require an explicit HTTPS origin, including for localhost. Development permits HTTP only on `localhost`, `127.0.0.1`, or `[::1]`. Bun binds locally on `PORT` (default 8787); the supplied host must terminate TLS, forward to Bun over a trusted internal connection, and prevent public access to the plain-HTTP backend. Merely setting the public URL does not create TLS hosting. No forwarded header is trusted to bypass configuration validation.

For extension builds, put **only** `WXT_SIDEKICK_PROXY_URL=<same public origin>` in `apps/extension/.env`, or export that public variable when running WXT. The extension does not read the server's root `.env`. Both the manifest's single required proxy host permission and `apps/extension/src/proxy.ts` use this same public origin and the shared validator in `packages/config/src/proxy-url.ts`; the later turn client is owned by #88. Never put a token/provider key in extension environment files. A production extension build also requires HTTPS when `NODE_ENV=production` is set. The five browser permissions are `sidePanel`, `activeTab`, `scripting`, `tabs`, and `storage`; Wikipedia and httpbin origins remain optional, user-granted permissions.

`POST /v1/agent/turn` authenticates before parsing or adapter dispatch. CORS permits transport/preflight but never authorizes a POST. Bearer tokens are compared with Node's constant-time `timingSafeEqual` on fixed-length SHA-256 digests. The endpoint validates strict shared Zod schemas for `goal`, current-run `messages` with matching call/result IDs, and the indexed `snapshot`; invalid input returns 400 before a model call. Responses are assistant `text` plus zero or one validated `toolCall`. Only the extension executes browser tools. See [the shared protocol](packages/protocol/README.md) for exact shapes and error statuses.

Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` **only in the server's gitignored `.env`**. One model is fixed at startup for every client; the fallback `anthropic/claude-sonnet-5.5` is the PRD candidate, not a live-verified availability claim. No client model/provider selector exists. With no key, a valid turn returns 501 (unconfigured adapter), while malformed input still returns 400. Every model turn has a 20-second abort deadline; Stop/request cancellation propagates to the provider request. Model responses are validated independently of OpenRouter's `parallel_tool_calls: false`, and multiple/unknown/invalid calls return 502 rather than an action. No provider request is retried. Real API check: **not run: no key**.

Request limits are explicit and configurable:

| Setting | Default | Behavior |
| --- | --- | --- |
| `SIDEKICK_MAX_BODY_BYTES` | 131072 | 413 above actual UTF-8 byte cap, including chunked streams; a small claimed Content-Length cannot bypass it. |
| `SIDEKICK_RATE_LIMIT_MAX_REQUESTS` | 60 | 429 after this many authenticated POSTs in the window. Invalid/oversized authenticated requests also count. |
| `SIDEKICK_RATE_LIMIT_WINDOW_MS` | 60000 | Fixed-window duration; 429 includes Retry-After. |

The single-demo-token budget is shared across clients/Origins/IPs in one process, with bounded in-memory state. It resets on restart and is **not** a distributed limiter: a durable host running replicas must enforce a shared quota at its ingress. Unauthorized traffic receives 401 and cannot consume the authenticated budget; the host should separately bound connection/unauthenticated traffic.

No request/response/body/header logging or evlog is mounted. The Hono error handler returns a fixed generic 500 rather than printing or serializing an adapter's raw error. The logging-sentinel test captures console output across 200/400/401/413/429/500 paths and asserts zero body, token, provider-key, or sensitive-sentinel output. Hosting-layer access/error logs must likewise exclude headers and bodies; the app cannot configure an unspecified host's logging.

## Verification and HTTPS hosting gate

```bash
WXT_SIDEKICK_PROXY_URL=https://proxy.example.com bun run build:extension
bun test apps/server/src/agent/turn.test.ts
bun run typecheck
bun test apps/server/src/agent/security.test.ts
# Environment is loaded privately, never passed as literal credentials:
bun --env-file=.env test apps/server/tests/https.smoke.test.ts
bun --env-file=.env test
bun run typecheck
bun run check
bun --env-file=.env run verify:secrets  # build extension first; scans without printing values
```

The smoke test requires `SIDEKICK_PROXY_URL` to be reachable HTTPS and `SIDEKICK_DEMO_TOKEN` to match the server. It sends `{}` only: valid token → 400, missing/incorrect token → 401. It does not spend a model turn, follow redirects, or print secrets. With either setting absent it **fails**, explicitly saying smoke requests were not run; an absent HTTPS host is a failing gate, not a passing skip. Thus bare `bun test` without host credentials is intentionally not a green release gate.

The #78 builder verification used an **EPHEMERAL sandbox forwarding URL** for local port 8787. This proves temporary authenticated HTTPS routing only, **not a durable deployment**. The durable-hosting gate remains **UNMET** until the user supplies a permanent HTTPS host, ingress/logging configuration, and private token. The sandbox may hibernate or stop forwarding; do not use its URL as a production service. See `evidence/tests/78-verification.md` for sanitized results and the temporary public origin. Real API check: **not run: no key**.

Full setup, test and demo instructions are added by issue #98.

## Tests
- `bun test` (or `bun run test`): the automated suite. It excludes the HTTPS hosting gate.
- `bun run test:https`: the HTTPS hosting gate (issue #78). Requires `SIDEKICK_PROXY_URL` (a reachable HTTPS origin) and `SIDEKICK_DEMO_TOKEN`; it FAILS by design when either is absent. It is excluded from `bun test` through `bunfig.toml` so the rest of the suite can be judged on its own, but the gate is still required for the final handover.
- The manifest test inspects `apps/extension/.output/chrome-mv3`; run `bun run build:extension` (with `WXT_SIDEKICK_PROXY_URL=https://...`) first if that directory is stale.
