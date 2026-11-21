# Scaffold boot evidence (issue #76)

Environment: Bun 1.4.5, create-better-t-stack 3.49.2, Chromium 156 under xvfb, 2026-11-21.

| Check | Result | Log |
| --- | --- | --- |
| Raw scaffold, `wxt build` | exit 0 (React popup/background/content, no sidepanel) | baseline-extension-build.log |
| Raw scaffold, server `bun run dev` | FAILS: varlock reports POLAR_ACCESS_TOKEN and GOOGLE_GENERATIVE_AI_API_KEY required (also BETTER_AUTH/DATABASE_URL). Confirms the unused parts had to be removed | baseline-server-dev.log |
| Trimmed, `bun install --frozen-lockfile` | exit 0 | install.log |
| Trimmed, `bun run typecheck` | exit 0 | typecheck.log |
| Trimmed, `bun run build:extension` | exit 0, `apps/extension/.output/chrome-mv3/manifest.json` exists | build-extension.log |
| Trimmed, `bun run dev:server` | listens on :8787, `GET /` returns `OK`, no auth/db/payment/native env needed | dev-server.log, dev-server-curl.log |
| Trimmed, `bun run dev:extension` (xvfb-run, CHROME_PATH=/usr/bin/chromium) | WXT dev server on :5555, built extension, "Opened browser" | dev-extension.log |

## Scaffold run notes (undocumented prompts)
The scaffold script was run in a tmux TTY with `--no-git` (so no repo of its own; the WXT addon still created a nested `apps/extension/.git`, which was deleted). Besides the documented answers (Biome; editors/agent files/hooks none; WXT React; skills Project) it also prompted for: Fumadocs template/search/OG/AI chat (defaults accepted, app deleted afterwards), skills selection and agent targets (defaults), MCP scope Project, MCP server and agent selection (defaults). Total scaffold time 347.7 s.

## Trimming
Removed apps/web, apps/native, apps/fumadocs, packages/auth, packages/db, packages/ui, turbo.json, varlock env schema, the scaffold's agent/editor config (.agents, .claude, .cursor, .vscode, .mcp.json, skills-lock.json) and the Gemini /ai route. Retained: apps/extension (WXT React), apps/server (Hono on Bun), packages/config, Biome/Ultracite config (Next preset dropped). `bts.jsonc` kept as scaffold provenance.

## Discrepancy
Issue #76 text says to scaffold at /home/ubuntu/sidekick as its own git repo; the swarm prompt (section 3) says products/sidekick inside this repo with --no-git. The swarm prompt was followed.
