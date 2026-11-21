#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.bun/bin:$PATH"
cd /home/ubuntu/wt/flopside-i27-scaffold/products
# cwd is products/; flopside resolves to the required products/flopside target.
bun create better-t-stack@latest flopside \
  --frontend next native-uniwind --backend hono --runtime bun --api none \
  --auth better-auth --payments polar --database mongodb --orm mongoose --db-setup none \
  --package-manager bun --no-git --web-deploy none --server-deploy none --install \
  --addons biome evlog fumadocs mcp skills turborepo ultracite wxt --examples ai
printf '\nSCAFFOLD_EXIT=0\n'
