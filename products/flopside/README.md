# Flopside — scaffold milestone (#27)

Independent Better-T-Stack Bun workspace at `products/flopside/`, with its own `bun.lock` and no nested Git repository. This milestone boots Next.js and Hono on Bun; it does **not** implement poker rooms or gameplay.

## Setup and commands

Use Bun 1.4.5 (the scaffold's pinned package manager). From the repository root:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd products/flopside
bun install --frozen-lockfile
# Optional; no credentials or external services are required:
cp .env.example .env
bun run dev
```

`bun run dev` runs **only** `apps/web` and `apps/server`. Both have hot reload. Ctrl-C stops both; if either exits, the Bun supervisor stops its sibling and returns a nonzero status.

```bash
# Example for parallel builders (issue #27's assigned ports):
WEB_PORT=3270 SERVER_PORT=3271 bun run dev
bun run lint
bun run typecheck
bun run test
bun run build
WEB_PORT=3270 SERVER_PORT=3271 bun run start
```

`bun run build` creates the Next production build and a Bun-targeted Hono bundle. `bun run start` starts those two built apps; stop it with Ctrl-C. Individual app commands are `bun run dev:web` and `bun run dev:server`. `bun run check-types` aliases `typecheck`; `bun run check` aliases `lint`; `bun run fix` applies safe Biome fixes.

### Public environment configuration

Bun loads the optional product-root `.env` when running the root scripts. Shell environment values take precedence. Commit only `.env.example`, never `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEB_PORT` | `3000` | Next.js browser listener |
| `SERVER_PORT` | `3001` | Hono/Bun listener |
| `PORT` | unset | Server-only fallback when `SERVER_PORT` is unset |
| `HOST` | `127.0.0.1` | Listener address for both apps; use `0.0.0.0` only when external access is needed |
| `NEXT_PUBLIC_SERVER_URL` | optional | Reserved browser-safe endpoint for future client work; not read at this milestone |

Root checks:

```bash
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3270/
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3271/
```

Each returned `200` in development and after a production build. The server returns `OK`. No Mongo service, credentials, authentication or payment provider is needed.

## Layout and dormant scaffold

```text
products/flopside/
├── apps/
│   ├── web/          # Active Next.js / placeholder and Tailwind
│   ├── server/       # Active Hono app.ts, Bun index.ts, app.test.ts
│   ├── native/       # Dormant Expo/Uniwind generated example
│   ├── extension/    # Dormant WXT React generated example
│   └── fumadocs/     # Dormant generated documentation app
├── packages/
│   ├── config/       # Shared active TypeScript configuration
│   ├── ui/           # Dormant generated shadcn and AI component examples
│   ├── auth/         # Dormant Better Auth / Polar packages
│   └── db/           # Dormant Mongo/Mongoose package
├── scripts/run-apps.ts # Bun development/production supervisor
├── evidence/boot/    # Sanitized commands, answers, logs and actual results
├── .env.example
└── bun.lock
```

The exact stack command and its original metadata are retained in `evidence/boot/scaffold-command.sh` and `bts.jsonc`. Generated packages remain installed but do not imply enabled product features. Do not run dormant apps as Flopside services.

### What was unwired

- Removed web login, dashboard, AI chat and payment-success routes, auth client/components/providers, request proxy, and evlog instrumentation.
- Replaced the server entry point; removed its generated auth/Mongo services initializer, identity/request logging, `/api/auth/*`, `/polar/success`, and `/ai` handlers.
- Removed active web/server Varlock environment accessors, Next Varlock plugin, global `@next/env` override, installation-time Varlock code generation, and generated credential-bearing local `.env` files. The active apps have no credential schema validation.
- Removed remote Google font loading. The scaffold root uses a local neutral font stack and a borderless monochrome placeholder, without extra controls/features.
- Filtered startup/build/checks to active product code instead of starting native, extension or Fumadocs alongside the game.
- WXT created `apps/extension/.git` despite the parent `--no-git`; removed it. No `.git` file/directory exists anywhere under this product.

`hono/bun`'s native `websocket` handler is attached to `Bun.serve`; the smoke test confirms `upgradeWebSocket` is available. No socket route is invented for #27; transport and production ingress belong to #28.

### Check boundaries

Biome preserves the generated Ultracite core/React/Next rule presets, with the obsolete `useTailwindSortedClasses` rule migrated to its supported `useSortedClasses` name. Lint checks maintained web/server source, scripts and project configuration, excluding build caches and the **dormant** generated native/extension/Fumadocs/auth/db/UI trees. Typecheck checks web, server (including the smoke tests) and the root runner. The dormant examples are not green-certified or runtime-tested; if a later issue activates one, it must enter the corresponding check boundary. No active source diagnostic is suppressed to pass a check.

## Verification and limitations

See `evidence/boot/README.md` for command outputs. Builder checks: exact scaffold success, install and frozen install success, both development roots `200`, lint/typecheck exit `0`, three Bun smoke tests passed, production build exit `0`, both production roots `200`, and listeners closed after Ctrl-C.

This is a **two-process** local production starter, not the one-process deployment required by #28. Published HTTPS/WSS, multi-browser WebSockets, single-instance ingress and poker/e2e correctness remain unverified and are separate issues. Docker build: not run, no docker in sandbox. AI calls: not run, no key (AI is dormant and not needed for Flopside). No independent-verifier verdict is claimed by this builder.
