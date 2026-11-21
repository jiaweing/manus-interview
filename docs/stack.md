# Stack: one command, seven independent scaffolds

The user's directive is the same stack for consistency, run through the Better-T-Stack CLI, with **each product as its own scaffold** (not one mega scaffold, because these are seven unrelated projects), and **Bun** as runtime and package manager.

```bash
bun create better-t-stack@latest <name> \
  --frontend next native-uniwind --backend hono --runtime bun --api none \
  --auth better-auth --payments polar --database mongodb --orm mongoose --db-setup none \
  --package-manager bun --git --web-deploy none --server-deploy none --install \
  --addons biome evlog fumadocs mcp skills turborepo ultracite wxt --examples ai
```

`scaffold/NN-<name>.sh` wraps this command once per product. Each one creates its own directory and git repo; run them from a workspace folder outside this repo.

## What was verified in this session (2026-11-21, create-better-t-stack 3.49.2, Bun 1.4.5)

| Check | Result |
| --- | --- |
| Every per-product command validated with `--dry-run` | Passed (all flags valid together) |
| Exact command without `--dry-run` | Generates `apps/web` (Next.js), `apps/native` (Expo + Uniwind), `apps/server` (Hono on Bun), `packages/{auth,config,db,ui}`, `turbo.json`, `biome.json`, `bts.jsonc` |
| `--yes` combined with stack flags | Rejected by the CLI (do not use `--yes`) |
| Non-interactive run | **Blocks**: the `ultracite`, `wxt`, `skills` and `mcp` addons ask questions, so a TTY is required |
| WXT addon output | `apps/extension` with React template and `popup`, `background`, `content` entrypoints. **No side panel entrypoint**, so Sidekick adds `entrypoints/sidepanel/` and the `sidePanel` permission by hand |
| `ai` example | Hono `/ai` route using Vercel AI SDK with Google Gemini (`gemini-2.5-flash`) by default |
| Install step and a full end-to-end boot of a scaffold | **Not verified** (dry-run and partial generation only; dependency install and `bun run dev` were not exercised) |

Answers given at the prompts during the verification run: Ultracite linter = Biome; editors, agent files and hooks = none; WXT template = React; skills scope = Project (the remaining `skills` and `mcp` prompts were not reached).

## What each product actually uses

Using the same scaffold does not mean wiring every part into every product. Unused parts stay dormant (present but not wired, not part of the MVP cut line). The per-product details are in Appendix B of each PRD.

| Product | Used in MVP | Hand-added | Dormant |
| --- | --- | --- | --- |
| 01 Caret | Next (minimal), Hono (not required by the trimmed PRD) | Electron `apps/desktop`, Win32 helper | Everything else |
| 02 Flopside | Next (lobby + 2.5D table client), Hono + Bun WebSockets (authoritative poker server) | Poker engine, redaction | Mongo, auth, Polar, wxt, native |
| 03 Patchbay | Bun CLI and kernel in `apps/server` | Plugin kernel, two plugins, conformance fixture | Next (UI cut), Mongo, auth, Polar, wxt, native |
| 04 Sidekick | WXT (`apps/extension`), Hono proxy with static token | `entrypoints/sidepanel/` | Next, Mongo, Better Auth, Polar, native |
| 05 TetherTerm | Hono (Streamable HTTP MCP endpoint), Bun PTY | stdio entrypoint, session manager | Next, auth, Mongo, Polar, native, wxt |
| 06 Glassroom | Next (crypto + WebRTC client), Hono (encrypted signaling) | Handshake and crypto code | evlog must be locked down; auth, Mongo, Polar, native, wxt |
| 07 Session Seven | Next (optional preview) | Remotion `apps/video` | Auth, Mongo, Polar, native, wxt |

## Known conflicts the stack introduces

- Several PRDs were drafted for Node, Express, Vite or Redis. Appendix B of each PRD overrides Section 8 where they conflict, and says so.
- TetherTerm needs a PTY under Bun. Bun 1.4.5 exposes `Bun.Terminal`; a spike must confirm it, with node-pty under Node as the fallback.
- Glassroom's privacy claims conflict with a default logging addon (evlog). Payload, URL and body logging must be off.
- Caret's Electron app and the Remotion video are not Better-T-Stack targets.
