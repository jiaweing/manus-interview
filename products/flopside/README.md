# Flopside — scaffold, WebSocket ingress and rooms (#27 / #28 / #36)

Independent Better-T-Stack Bun workspace at `products/flopside/`, with its own `bun.lock` and no nested Git repository. Next.js remains the browser client; Hono on Bun owns native WebSockets. In-memory room creation/joining and host-controlled store start are implemented; authenticated gameplay transport and the lobby UI remain subsequent milestones.

## In-memory rooms (#36)

`POST /api/rooms {nickname}` creates a room (201); `POST /api/rooms/:code/join {nickname}` joins it (200). Both return `{seat, state}` with only the caller's crypto seat token and an allowlisted lobby view. Nicknames are trimmed before Zod's 1–16-unit validation. HTTP seats begin disconnected; socket integration will call `markConnected`/`markDisconnected`. The four-seat lobby rejects a fifth with `ROOM_FULL`, and host start with 2–4 connected players locks admission with `MATCH_STARTED`. Unknown/expired codes share `ROOM_EXPIRED`; idle expiry is exactly 30 minutes on an injectable clock.

See [the server room contract](apps/server/ROOMS.md) for response/error schemas, synchronous `RoomStore` methods, host transfer, connected match participants, revision/activity semantics, privacy boundaries and downstream integration notes (#37/#38/#39/#41). Production constructs `new RoomStore()` with no deterministic deck source or env selector; deck-function injection exists only in the store constructor for isolated tests. No engine files are changed. Run `bun test apps/server/src/rooms.test.ts`; evidence lives under `evidence/i36/`.

## Setup and commands

Use Bun 1.4.5. From the repository root:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd products/flopside
bun install --frozen-lockfile
# Optional public configuration only; no credentials/services are required:
cp .env.example .env
```

### Production: one Bun process / one origin

```bash
bun run build
WEB_PORT=3280 bun run start
# Equivalent continuous command:
WEB_PORT=3280 bun run build && WEB_PORT=3280 bun run start
# Open http://127.0.0.1:3280/; its socket is ws://127.0.0.1:3280/api/ws.
```

`bun run build` statically exports the existing Next app to `apps/web/out/` and bundles Hono for Bun at `apps/server/dist/index.js`. **`bun run start` resolves the root `start.ts` Bun entrypoint**, which sets runtime production mode and imports that built bundle in the same process. There is intentionally **no package-shell `start` script**: wrapping `bun ...` in one would leave an extra Bun launcher process. Production has one `Bun.serve`, one listener on `WEB_PORT`, no Next runtime server, no supervisor, no cluster and no second backend instance. `SERVER_PORT` is ignored in production. A missing export fails startup rather than starting a dev server or substitute game.

**Decision and rationale:** Next static export served by Hono/Bun is the least invasive way to keep both scaffold frameworks while satisfying PRD R12. All authority will live behind Hono HTTP/WebSocket routes; the lobby/table client does not need Next SSR. Native `upgradeWebSocket` from `hono/bun` and Bun's `websocket` handler own `/api/ws` directly on the browser origin. Next rewrites are deliberately **not** used: they cannot proxy WebSocket upgrades. A reverse-proxy/second Next server was rejected because it adds a second runtime process. Keep future pages export-compatible (room invitations can use query parameters); Next server actions, SSR, and unknown dynamic server-rendered routes are not available with this setup. This does not replace or regenerate the scaffold.

Bun's bundler folds `process.env.NODE_ENV`; the backend uses `Bun.env.NODE_ENV` so the built entry reads deployment mode at runtime. `start-single-instance.txt` under `evidence/ingress/` records a real `bun run start` PID with no child processes and only the production listener.

### Development: hot-reload client and WS server

```bash
WEB_PORT=3280 SERVER_PORT=3281 bun run dev
# Browser: http://127.0.0.1:3280/ -> socket: ws://127.0.0.1:3281/api/ws
```

`bun run dev` runs **only** `apps/web` and `apps/server`, both with hot reload. Ctrl-C stops both; if either exits, the supervisor stops its sibling and returns a nonzero status. Dev intentionally uses two listeners. The browser's **dev-only** public server origin is derived from `HOST` / `SERVER_PORT` (or `PORT`); `NEXT_PUBLIC_SERVER_URL` can override it for externally reachable dev hosts. Production ignores that override and always uses the page origin. There are no hard-coded builder ports in the client and no polling/reconnection/local-game fallback.

Individual dev commands: `bun run dev:web` and `bun run dev:server`, using the same environment values for both. `bun run --cwd apps/web start` delegates to the product's production entry rather than unsupported `next start` after export.

### Checks and browser test

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bunx playwright install chromium
# Exact issue #28 command from this product root (auto-starts production):
WEB_PORT=3280 bunx playwright test apps/web/tests/ingress.spec.ts --project=chromium
# Root script, same production configuration:
WEB_PORT=3280 bun run test:e2e
# Or explicitly use an already-running production build:
E2E_BASE_URL=http://127.0.0.1:3280 bun run test:e2e
```

The full Playwright config lives in `apps/web/playwright.config.ts`; the root config composes it so the issue's exact command works. Playwright is declared in both the product root and apps/web (root for the exact CLI invocation, web for the Biome dependency boundary) because its CLI is invoked from this root (Bun isolated workspace installs otherwise expose the binary only in the web workspace). `bun run test` discovers all Bun unit/integration tests except `apps/web/tests/**`, which belong to Playwright. `check-types` aliases `typecheck`, `check` aliases `lint`, and `fix` applies safe Biome fixes.

The e2e creates two **independent browser contexts** on the built origin. It observes both HTTP **101** upgrade statuses through Chromium CDP `Network.webSocketHandshakeResponseReceived`, requires same-origin `/api/ws`, checks both real server frames contain the same boot marker and count **2**, and verifies closing one context reduces the surviving count to **1**. No headers, credentials or incoming payloads are recorded. It writes real-page screenshots and sanitized `marker-config.json` under `evidence/ingress/`; server count output is in the command log. The screenshot labels report the WebSocket's real open state; the exact HTTP status is recorded in CDP JSON, not invented by the page.

`bunx playwright install chromium` succeeded here; the builder used downloaded Chromium. If downloads are unavailable, the config automatically uses `/usr/bin/chromium` when present, or explicitly set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. Browser contexts and auto-started servers are closed by the test; there are no retries that hide failures.

## Public environment configuration

Bun loads the optional product-root `.env`; shell values take precedence. Commit only `.env.example`, never `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEB_PORT` | `3000` | Production browser + WS listener; dev Next listener |
| `SERVER_PORT` | `3001` | Dev-only Hono/Bun listener; ignored in production |
| `PORT` | unset | Fallback when the relevant listener variable is unset |
| `HOST` | `127.0.0.1` | Listener address; use `0.0.0.0` when external access is required |
| `NEXT_PUBLIC_SERVER_URL` | derived in dev | Dev-only browser-reachable Hono origin; ignored by production build |
| `ALLOWED_ORIGINS` | unset | Comma-separated exact additional allowed browser origins |
| `E2E_BASE_URL` | derived loopback origin | Explicitly use an already-running production build instead of auto-start |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | downloaded, then system fallback | Optional browser executable override |
| `TEST_SERVER_PORT` | `3286` | Override port used by the native Bun integration test |

Only `/api/ws` upgrades are Origin-checked. Same request origin is allowed automatically; missing/foreign Origin returns **403** before upgrading. Dev additionally allows the configured Next origin. For TLS termination, set `ALLOWED_ORIGINS=https://your-host.example` if the upstream request URL is HTTP, preserve WebSocket `Upgrade` / `Connection`, forward `/` and `/api/ws` to this **same one instance**, and terminate TLS for HTTPS/WSS. The server does not blindly trust forwarded headers. Rate/payload/schema/authentication hardening remains #40 and the later protocol issues.

## Docker

Build context is the product root:

```bash
docker build -t flopside .
docker run --rm -p 3280:3000 -e ALLOWED_ORIGINS=http://localhost:3280 flopside
```

The multi-stage Dockerfile installs/builds with Bun, copies only the bundled backend and static Next export into the runtime image, runs as `bun`, and executes **one Bun process** on port 3000. Do not scale it to multiple containers/replicas: future rooms are in-memory. `.dockerignore` excludes dependencies, caches, evidence and local env files. TLS is the operator's reverse-proxy responsibility.

**docker build: not run, no docker in sandbox.** The container image/tag/build/runtime are not claimed verified.

## Layout and dormant scaffold

```text
products/flopside/
├── apps/
│   ├── web/             # Active Next client, static export, Playwright config/tests
│   ├── server/          # Active Hono/Bun, isolated ingress-probe.ts, unit/integration tests
│   ├── native/          # Dormant Expo/Uniwind generated example
│   ├── extension/       # Dormant WXT React example
│   └── fumadocs/        # Dormant generated docs app
├── packages/
│   ├── config/          # Shared active TypeScript configuration
│   ├── ui/              # Dormant generated shadcn/AI examples
│   ├── auth/            # Dormant Better Auth / Polar
│   └── db/              # Dormant Mongo/Mongoose
├── scripts/run-apps.ts  # Development-only supervisor
├── start.ts             # Single-process production Bun entrypoint
├── Dockerfile
├── evidence/boot/       # Historical #27 scaffold checks (two-process starter then)
├── evidence/ingress/    # #28 production/browser/process/dev checks
├── .env.example
└── bun.lock
```

The exact original scaffold command/metadata remain in `evidence/boot/scaffold-command.sh` and `bts.jsonc`. Generated packages remain installed but unused. Active imports do not initialize auth, Mongo, Polar, AI, native, WXT, Varlock or evlog; the #27 integration unwiring remains intact. The local neutral font and borderless monochrome placeholder remain, with only a transport evidence panel added for this issue.

Biome retains Ultracite core/React/Next rules. Lint/typecheck include maintained web/server, the runner, entrypoint, Playwright tests and configuration; generated output/caches and the **dormant** native/extension/Fumadocs/auth/db/UI trees are excluded. Dormant code is not green-certified; if later activated, include it in checks. No active diagnostic is suppressed to pass a check.

## Verification boundaries and limitations

See `evidence/ingress/README.md` for commands, exit codes and screenshots. The isolated server smoke probe `apps/server/src/ingress-probe.ts` is **temporary / transport-only**: on open it broadcasts only a non-secret random boot marker and current live count; joins/closes update the count. It ignores all incoming messages and contains no gameplay. Its matching isolated web panel exists only to show real transport evidence. **#38 must remove/replace both when authenticated gameplay sockets arrive; #49 must repeat the release ingress check. This unauthenticated probe must not survive release.**

Local production HTTP/WS and development connectivity are builder-tested. Published HTTPS/WSS ingress, real TLS reverse-proxy configuration, container build/runtime, production authentication and gameplay are **not verified** at #28. A failed published upgrade or multi-instance setup blocks release; polling and local substitutes are forbidden. No independent-verifier verdict is claimed. AI calls: not run, no key; AI is dormant and unnecessary for Flopside. All builder-started servers are stopped before handoff.
