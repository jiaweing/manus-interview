# Glassroom

Memory-only, two-person, end-to-end encrypted chat over a WebRTC data channel, with WebCrypto and encrypted signaling. Scope contract: [`docs/prds/06-p2p-encrypted-chat.md`](../../docs/prds/06-p2p-encrypted-chat.md). This is a demo build, not an audited secure messenger.

## Layout

- `apps/web` Next.js client (owns WebCrypto and WebRTC)
- `apps/server` Bun + Hono: one HTTPS origin, a `/signal` WebSocket endpoint, and a reverse proxy to Next
- `packages/ui`, `packages/config` shared UI primitives and TS config
- `tests/e2e` Playwright (chromium)

The Better-T-Stack scaffold was generated with `scaffold/06-glassroom.sh` (`--no-git`, Biome, no editors/agent files/hooks, WXT React, skills scope Project). Dormant parts the PRD does not use (auth, MongoDB, Polar, native, WXT extension, Fumadocs, AI example, agent/skills files) were removed.

## Run

```sh
bun install --frozen-lockfile
bun run build
bun run dev:https      # https://localhost:3443 (self-signed cert generated in .certs/)
bun run start:https    # production-mode run (after bun run build)
```

Test (with `dev:https` running or let Playwright start it):

```sh
bunx playwright install chromium
bunx playwright test tests/e2e/boot.spec.ts --project=chromium
```

Production uses one configured HTTPS origin: set `TLS_CERT_FILE` and `TLS_KEY_FILE` (see `.env.example`). There are no required secrets.
