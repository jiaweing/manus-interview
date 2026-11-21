# Issue #2 boot evidence (Linux sandbox, Ubuntu 24.04, bun 1.4.5, Electron 45.4.1)

Scaffold command (exact, from `products/caret/bts.jsonc` `reproducibleCommand`):

    bun create better-t-stack@latest products/caret --frontend next native-uniwind --backend hono --runtime bun \
      --database mongodb --orm mongoose --api none --auth better-auth --payments polar \
      --addons biome evlog fumadocs mcp skills turborepo ultracite wxt --examples ai --db-setup none \
      --web-deploy none --server-deploy none --no-git --package-manager bun --install

- Run once through `scaffold/01-caret.sh` with `--git` replaced by `--no-git` (swarm prompt section 3). Driver: `drive_scaffold.py`; prompts and the answers sent: `scaffold-prompts-answered.txt`; transcript: `scaffold-transcript.txt`.
- Interactive answers: Ultracite linter = Biome; editors / agent files / hooks = none (nothing toggled); WXT template = React; skills scope = Project. Prompts the instructions did not specify (Fumadocs template/search/OG/AI chat, skills selection, MCP scope/servers/agents) took their pre-selected defaults. This is why `.agents/`, `.claude/`, `.cursor/`, `.vscode/`, `.mcp.json`, `skills-lock.json` exist; they are inert scaffold artifacts.
- `apps/desktop` was hand-added (electron-vite: Electron main, preload, React renderer). Electron 45 has no postinstall and downloads its binary lazily on first run, so the root `postinstall` script was extended with `node ./apps/desktop/node_modules/electron/install.js` to make `bun install` fetch it deterministically (verifier round 1 found the binary missing after install).
- Desktop scripts: `bun run --cwd apps/desktop dev | build | typecheck`; none invoke web/server/native/extension/fumadocs.
- `desktop-boot.png`: real Electron window titled "Caret" under Xvfb 1280x720 (Linux only; Windows boot screenshot is part of #9/#24).
- The WXT addon initialises a nested git repo at apps/extension/.git even with --no-git; it was removed so the scaffold has no nested .git (git cannot add it otherwise).
