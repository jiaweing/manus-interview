# Handover: scoping and discovery

This thread ended at scoping and discovery. No product code has been written. Everything produced is in this repo.

## What exists

| Item | Location |
| --- | --- |
| Seven PRDs, each ~1,600-1,700 words, trimmed to the main brief requirements only (13 sections, requirement checklist, demo script, short milestones) | `docs/prds/` |
| UI design system appendix (clean, minimal, black and white, shadcn style, **no borders**) | Appendix A of PRDs 01-06 |
| Scaffold appendix (same stack, one scaffold each, Bun) | Appendix B of every PRD |
| Per-product scaffold scripts | `scaffold/` |
| Stack findings and what was verified | `docs/stack.md` |
| Research notes behind the PRDs | `docs/research/` |

## Products

| # | Problem | Product | One line |
| --- | --- | --- | --- |
| 01 | Desktop voice input | Caret | Global shortcut, speak, polished text inserted at the caret on Windows |
| 02 | Multiplayer web game | Flopside | Simple 2.5D multiplayer Texas Hold'em, play money, hidden cards enforced by the server |
| 03 | Local harness with plugins | Patchbay | Zero-built-in-tools kernel; plugins add everything (inspired by Pi, DeepSeek Harness, Herdr) |
| 04 | Chrome side-panel agent | Sidekick | Transparent, supervised browser agent built with WXT |
| 05 | MCP terminal controller | TetherTerm | Persistent PTY sessions for agents with cursor-based reads and screen snapshots |
| 06 | P2P encrypted chat | Glassroom | Two-person E2EE chat with a live "what the server sees" inspector |
| 07 | Promo video | Session Seven | 60s hero film for the six products, pure-JavaScript (Remotion), cartoon 2.5D flat style, music via OpenRouter |

## Decisions the user made in this thread

1. Scope: only the main brief requirements, nothing else (all PRDs trimmed accordingly). Problem 7 (bring your own idea) is parked in `docs/parked/` and is not built, scaffolded, or shown in the video.
2. UI: clean minimal black and white, shadcn style, no borders.
3. Game: simple 2.5D poker (replaced the original heist concept).
4. Promo video: purely JavaScript code, authored with Claude Opus 5.5, cartoon 2.5D flat art style, music generated through OpenRouter.
5. Problem 3: take inspiration from Pi, DeepSeek Harness and Herdr plugin systems.
6. Chrome extension: WXT.
7. Stack: the given Better-T-Stack command for every product, each as its own scaffold, with Bun.

## Open questions and assumptions to resolve first

| Topic | Assumption made | Needs |
| --- | --- | --- |
| "Opus 5.5" | Treated as the model that authors the video code; the exact model ID and API were not verified | Confirm model ID and where it runs |
| OpenRouter music | No key was available in the sandbox. The PRD designs a provider-abstracted script with a pure-JS synthesized fallback. What OpenRouter actually offers for music was researched from public pages only; account-level availability is unverified | `OPENROUTER_API_KEY` and a test generation |
| Build natively in Manus or from scratch | See below | Decision |
| Dependency install and boot of a scaffold | Not verified here | Run the scripts on the build machine |
| Per-PRD open questions | Listed in Section 10 of each PRD (for example Caret: cloud STT acceptable? Windows demo machine; TetherTerm: run in Studio or on the laptop; Sidekick: model provider and budget) | Answers |
| Gemini vs OpenAI | The scaffold's `ai` example defaults to Google Gemini; PRDs named OpenAI models | Pick one provider per product |
| Poker twist | The user floated "poker with a twist". Plain Hold'em is in scope; no twist was invented | Decide the twist, or keep plain |

## Build natively in Manus, or from scratch?

Manus can build web apps, games and slides itself, and it has a video-generation workflow, so this is a real choice. Recommendation, by product:

- **Flopside (game):** keep the networking, game rules and server hand-written (the brief requires a truly networked product). Manus's web-development hosting is worth a short spike for deployment only, because the PRD's biggest unknown is whether published WebSocket ingress works. Note that Manus web projects come with their own managed project template, which conflicts with the Better-T-Stack scaffold; if the spike says yes, deploy the built app rather than regenerate it.
- **Session Seven (video):** keep the pure-JavaScript Remotion path the user specified. Manus's own video tooling is FFmpeg or generative-model based, which breaks the "purely JavaScript code" constraint. Use Manus only as the authoring environment.
- **Everything else:** from scratch with the scaffold, since none of them are standard web apps (desktop app, extension, MCP server, E2EE client, plugin kernel).

## Next steps

1. Answer the open questions above.
2. Run `scaffold/NN-*.sh` for the products being built (each in its own folder and repo), with a TTY.
3. For each product, follow the PRD's Section 12 milestones, MVP cut line first.
4. Build order suggestion: 05 TetherTerm and 03 Patchbay (their output is also useful tooling), then 04, 06, 01, 02, and 07 last because it needs faithful mock-ups of the others. Work is tracked in GitHub Issues and the project board (see README).

## GitHub issues (created)

- 7 epics and 167 atomic sub-issues (174 total), see [issues-index.md](issues-index.md). Each epic has a milestone, and each child has `priority:`, `type:`, `product:` and `area:` labels, acceptance criteria, an explicit verification section and blocked-by links.
- Priorities: 169 P0 and 5 P1. The PRDs were trimmed to main requirements only, so almost everything is P0. Re-rank before sprint planning if you want a real P1 tier.
- Verification commands in the issues are planned checks. None has been run, because no product code exists yet.
- **GitHub Project (Projects v2) was NOT created.** The sandbox tokens are GitHub App user tokens and GitHub returns FORBIDDEN for `createProjectV2`. Run `GH_TOKEN=<PAT with project scope> python3 scripts/setup_project.py` (untested) to create the board and add all issues with Priority, Product and Type fields. Alternatively create the project in the UI and use "Add items" filtered by `repo:jiaweing/manus-interview`.
