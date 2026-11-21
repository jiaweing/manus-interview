#!/usr/bin/env bash
# Scaffold for Session Seven (promo video).
# Same Better-T-Stack command for every product (user directive: same stack for consistency), but each
# product is its OWN independent scaffold/repo, never one shared monorepo.
# Run from a workspace folder OUTSIDE this repo.  Usage: ./08-session-seven.sh [target-dir]  (default: ./session-seven)
# Needs bun >= 1.3 and an interactive TTY: the ultracite, wxt, skills and mcp addons ask questions.
# Answers used when verified: Ultracite linter = Biome; editors / agent files / hooks = none;
# WXT template = React; skills scope = Project.
set -euo pipefail
TARGET="${1:-session-seven}"
bun create better-t-stack@latest "$TARGET" \
  --frontend next native-uniwind --backend hono --runtime bun --api none \
  --auth better-auth --payments polar --database mongodb --orm mongoose --db-setup none \
  --package-manager bun --git --web-deploy none --server-deploy none --install \
  --addons biome evlog fumadocs mcp skills turborepo ultracite wxt --examples ai
