# Scaffold answers — issue #27

Ran the exact `scaffold/02-flopside.sh` stack command in tmux (PTY), from `/home/ubuntu/wt/flopside-i27-scaffold/products/`. Target argument `flopside` resolves to `products/flopside/`. The only flag substitution was `--no-git` for `--git`; no `--yes`, no omitted or added stack flags. Exact command is saved in `scaffold-command.sh`.

| Prompt | Answer |
| --- | --- |
| Ultracite linter | Biome (recommended) |
| Editors | None |
| Agent files | None |
| Agent hooks | None |
| Fumadocs template | Next.js: Fumadocs MDX (default) |
| Fumadocs search | Default local Orama (no cloud provider) |
| Open Graph image generation | Built-in next/og (default, no new renderer) |
| Fumadocs AI Chat | No |
| WXT template | React |
| Skills scope | Project |
| Skills to install | None (deselected all 27 optional defaults) |
| MCP scope | Project |
| MCP servers to install | None (deselected all 7 optional defaults) |

With no skills/MCP selections, their third agent-target prompts were skipped by the CLI. No global configuration was selected or written by these addons.

The CLI reported `Project ready` and `SCAFFOLD_EXIT=0`. WXT's nested initializer unexpectedly produced `apps/extension/.git`; removed it immediately after generation. No nested `.git` remains in this product.

Issue #27's original wording says to scaffold outside the source repository with a nested git repository. The explicit builder assignment and swarm prompt §3 supersede that location instruction: this is an independent Bun workspace and lockfile **inside** the source repo, on a worktree branch, with no nested git metadata. No issue acceptance text was edited.
