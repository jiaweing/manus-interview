#!/usr/bin/env bash
# Scaffold for Flopside (2.5D multiplayer poker).
# Same Better-T-Stack command for every product (user directive: same stack for consistency), but each
# product is its OWN independent scaffold/repo, never one shared monorepo.
# Run from a workspace folder OUTSIDE this repo.  Usage: ./02-flopside.sh [target-dir]  (default: ./flopside)
# Needs bun >= 1.3 and an interactive TTY: the ultracite, wxt, skills and mcp addons ask questions.
# Answers used when verified: Ultracite linter = Biome; editors / agent files / hooks = none;
# WXT template = React; skills scope = Project.
set -euo pipefail
TARGET="${1:-flopside}"
bun create better-t-stack@latest "$TARGET" \
  --frontend next native-uniwind --backend hono --runtime bun --api none \
  --auth better-auth --payments polar --database mongodb --orm mongoose --db-setup none \
  --package-manager bun --git --web-deploy none --server-deploy none --install \
  --addons biome evlog fumadocs mcp skills turborepo ultracite wxt --examples ai
