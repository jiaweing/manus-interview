# Swarm build prompts

One self-contained prompt per product. Start each in its own fresh Manus task so every product has its own swarm, context and evidence ledger. They can run in parallel except where noted.

| # | Product | Prompt | Epic |
|---|---|---|---|
| 01 | Caret | [01-caret.md](01-caret.md) | [#1](https://github.com/jiaweing/manus-interview/issues/1) |
| 02 | Flopside | [02-flopside.md](02-flopside.md) | [#26](https://github.com/jiaweing/manus-interview/issues/26) |
| 03 | Patchbay | [03-patchbay.md](03-patchbay.md) | [#51](https://github.com/jiaweing/manus-interview/issues/51) |
| 04 | Sidekick | [04-sidekick.md](04-sidekick.md) | [#75](https://github.com/jiaweing/manus-interview/issues/75) |
| 05 | TetherTerm | [05-tetherterm.md](05-tetherterm.md) | [#100](https://github.com/jiaweing/manus-interview/issues/100) |
| 06 | Glassroom | [06-glassroom.md](06-glassroom.md) | [#125](https://github.com/jiaweing/manus-interview/issues/125) |
| 07 | Session Seven | [07-session-seven.md](07-session-seven.md) | [#150](https://github.com/jiaweing/manus-interview/issues/150) |

Before you start any of them:

1. Put `OPENROUTER_API_KEY` (and optionally `OPENROUTER_MODEL`) in each product's `.env` once the product folder exists. Without a key, real-API checks are reported as "not run".
2. Caret needs a Windows computer attached to its task for the native gate and the final walkthrough.
3. Start Session Seven (07) after the other six have a demo build, so the film can show real UI.
4. Regenerate the prompts with `python3 scripts/gen_swarm_prompts.py` if issues change.
