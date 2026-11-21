# Scaffold install and boot evidence (2026-11-21)

Environment: Ubuntu sandbox, Bun 1.4.5, Node v22.23.4, create-better-t-stack (latest at run time).

## Scaffold
- Command: `scaffold/05-tetherterm.sh` with the only change `--git` -> `--no-git` (the product must not carry its own `.git`), target `products/tetherterm`.
- Prompts answered in a tmux pty: Ultracite linter = Biome; editors, agent files, hooks = none; Fumadocs defaults (Next.js MDX, local search, next/og, no AI chat); WXT template = React; skills scope = Project (default skill selection accepted, agents Universal + Claude Code); MCP scope = Project (default servers accepted).
- Result: exit 0, "Project ready in 296.7s", `bun install` completed and wrote `bun.lock`.
- Note: the Fumadocs, skills and MCP prompts were not described in `docs/stack.md`; defaults were taken.

## Boot of the generated server (apps/server), before any TetherTerm code
- With the empty `.env` the server refuses to start: varlock reports `POLAR_ACCESS_TOKEN`, `GOOGLE_GENERATIVE_AI_API_KEY` and others as required and empty.
- With throwaway dummy values supplied through the environment (not committed), `bun run src/index.ts` stays alive but never listens on port 3000: `src/services.ts` does `await createDb(ENV)` -> `await mongoose.connect(DATABASE_URL)` at import time and no MongoDB exists. `curl http://127.0.0.1:3000/` -> connection refused.
- Conclusion: the unmodified scaffold server only boots with a reachable MongoDB plus Better Auth/Polar/Google values. TetherTerm needs none of these. Issue #101 therefore gives `apps/server` its own entrypoint that does not import `services.ts`; the auth/db/ai/web/native/extension parts stay dormant.

## Native PTY smoke check (not the issue #101 test)
`Bun.Terminal` exists in Bun 1.4.5 (`typeof Bun.Terminal === "function"`). A bash child spawned with `terminal:` printed `/dev/pts/3`, `test -t 0` was true, `stty size` printed `24 80`, and it echoed written input. The full spike test is issue #101.
- The WXT addon left a nested `.git` in `apps/extension`; it was deleted so the product has no git metadata of its own.
