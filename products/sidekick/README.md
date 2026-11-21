# Sidekick

Supervised Chrome side-panel agent (WXT + Hono proxy). Built from the Better-T-Stack scaffold, trimmed to the two retained apps.

- `apps/extension`: WXT (React) MV3 extension.
- `apps/server`: Hono proxy on Bun.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run build:extension   # apps/extension/.output/chrome-mv3/manifest.json
bun run dev:server
bun run dev:extension
```

Full setup, test and demo instructions are added by issue #98.
