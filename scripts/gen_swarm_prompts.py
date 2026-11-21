#!/usr/bin/env python3
"""Generate docs/swarm-prompts/NN-<slug>.md from docs/issue-specs + docs/issue-map.json + PRDs.
Run after scripts/sync_issues.py so issue numbers are final.
"""
import glob
import json
import os
import re

REPO = "jiaweing/manus-interview"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs/swarm-prompts")
os.makedirs(OUT, exist_ok=True)
imap = json.load(open(os.path.join(ROOT, "docs/issue-map.json")))

PRD = {
    "caret": "01-desktop-voice-input.md", "flopside": "02-multiplayer-web-game.md", "patchbay": "03-local-agent-harness.md",
    "sidekick": "04-chrome-agent-sidepanel.md", "tetherterm": "05-mcp-terminal-controller.md",
    "glassroom": "06-p2p-encrypted-chat.md", "session-seven": "07-promo-video.md",
}
NAME = {"caret": "Caret", "flopside": "Flopside", "patchbay": "Patchbay", "sidekick": "Sidekick", "tetherterm": "TetherTerm", "glassroom": "Glassroom", "session-seven": "Session Seven"}
NUM = {k: f"{i+1:02d}" for i, k in enumerate(PRD)}

SPECIFIC = {
    "caret": dict(
        what="a Windows desktop voice-input utility: press Ctrl+Alt+Space in any app, speak, press again, and cleaned text is pasted into the focused control.",
        env="Electron + TypeScript React renderer + a C++ Win32 helper. The Win32 helper, the global shortcut, tray, focus capture and paste can ONLY be verified on a real Windows 11 desktop. The Linux sandbox may run unit tests and the renderer, but the Notepad native-loop gate and the final computer-use walkthrough need a Windows computer. If no Windows computer is attached to the task, finish every Linux-verifiable issue, then STOP at the Windows gate and ask the user to attach one. Never mock the native loop and never mark a Windows gate passed from Linux.",
        rules=[
            "Order matters: the packaged Windows Notepad native-loop gate must pass BEFORE any cloud STT/cleanup work starts.",
            "AI provider is OpenRouter: `OPENROUTER_API_KEY` from `.env` in development, entered once in setup for the packaged app. STT is an audio-input chat/Responses call (candidate `google/gemini-3.5-flash-lite`; Responses API accepts wav/mp3 only). Freeze one model per step after a smoke test; no model selector in the UI.",
            "Audio and transcripts stay in RAM; nothing sensitive is logged or persisted; the clipboard is restored only if Caret still owns it.",
            "Out of scope: macOS/Linux delivery, local Whisper, streaming, push-to-talk, dictionary UI, per-app profiles, history, analytics, accounts, payments.",
        ],
    ),
    "flopside": dict(
        what="a simple 2.5D browser multiplayer Texas Hold'em (play money, 2-4 seats, heads-up supported) with a server-authoritative engine and hidden hole cards.",
        env="Hono on Bun native WebSockets, in-memory rooms, Next.js client. Fully verifiable in the Linux sandbox with Playwright using 2-4 browser contexts, and with computer use on real browser windows. Self-hosted: ship a production build (`bun run build && bun run start`) plus a Dockerfile. No Manus webdev, no polling fallback.",
        rules=[
            "The server is the only authority. Hole cards must never be sent to anyone but their owner; add a test that inspects every outbound message for every seat.",
            "The hand evaluator needs exhaustive/property tests (known hand rankings, ties, split pots, side pots, all-in, heads-up blind rules).",
            "Normal deployment has no deterministic deck; a deterministic deck exists only behind a test flag that is verified off in the production build.",
            "Rooms are in-memory: a backend restart loses them and clients show `Room lost — create again`.",
            "Out of scope: accounts, real money, matchmaking, persistence, tournaments, mobile app, the 'poker with a twist' variant (an open user question; do not invent a twist).",
        ],
    ),
    "patchbay": dict(
        what="a local, CLI-only agent harness with a tool-free kernel and plugins over JSON-RPC on stdio, inspired by Pi, DeepSeek Harness and Herdr.",
        env="Bun + TypeScript, Better-T-Stack scaffold with only the CLI/package parts active. Fully verifiable in the Linux sandbox. Real inference needs `OPENROUTER_API_KEY` in `.env` (default endpoint https://openrouter.ai/api/v1; any OpenAI-compatible endpoint must also work).",
        rules=[
            "The kernel is tool-free: all capabilities arrive through plugins. Ship exactly two production plugins (`workspace-scout`, `model-openai-compat`) plus a third, independent conformance-fixture plugin used only by tests.",
            "Plugins speak JSON-RPC over stdio; the kernel must survive plugin crashes, hangs, malformed output and oversized output with clear errors.",
            "CLI only: no web UI, no TUI beyond plain terminal output, no extra plugins.",
            "Read `docs/research/03-inspiration-pi-dsh-herdr.md` before designing the plugin contract; borrow ideas, do not copy code.",
        ],
    ),
    "sidekick": dict(
        what="a Chrome side-panel agent built with WXT: the user types a task, sees a plan, presses Run, and the agent acts on the page one supervised step at a time.",
        env="WXT (React template) with a hand-added side-panel entrypoint (the scaffold generates none), plus a Hono proxy using OpenRouter. Verify in headed Chromium with the unpacked extension (xvfb in the Linux sandbox works) driven by computer use; Playwright can load the extension for automated tests.",
        rules=[
            "The extension never holds the OpenRouter key. The Hono proxy reads `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` from `.env` (default candidate `anthropic/claude-sonnet-5.5`), authenticates the extension with a static token over HTTPS (localhost allowed in dev), and uses one server-fixed model with no provider picker.",
            "Only the extension executes browser tools. Page content is untrusted data and must never override user instructions; a deterministic policy outside the model blocks forbidden actions.",
            "Plan-before-Run, one action per loop turn, a working Stop, and every error surfaced to the user.",
            "Out of scope: multiple providers, accounts, payments, sync, store publishing, Firefox/Safari.",
        ],
    ),
    "tetherterm": dict(
        what="an MCP server that lets an AI client control real live terminal sessions (PTY) over stdio and authenticated Streamable HTTP.",
        env="Bun + Hono. PTY via `Bun.Terminal` (present in Bun 1.4.5) with node-pty under Node as the documented fallback. Fully verifiable in the Linux sandbox with a real MCP client (for example MCP Inspector, plus a scripted client). A Manus MCP connection needs a reachable HTTPS URL plus bearer token; if the user cannot supply one, record the limitation precisely and prove the same flow with an independent authenticated HTTPS client. Never claim Manus connected without evidence.",
        rules=[
            "Real PTYs only: interactive shells, signals, resize and process-tree cleanup must work and be tested; no fake terminals.",
            "Authentication is never relaxed, not for demos and not when Manus is unavailable. Tokens never appear in logs, screenshots or committed files.",
            "Headless product: no UI beyond what the PRD lists. The 'UI' for verification is a real MCP client plus a terminal.",
            "Out of scope: a web terminal UI, multi-user accounts, session persistence across server restarts.",
        ],
    ),
    "glassroom": dict(
        what="a peer-to-peer end-to-end-encrypted, memory-only chat over a WebRTC data channel with WebCrypto and encrypted signaling.",
        env="Next.js client + Hono signaling on Bun. Verifiable in the Linux sandbox with two isolated Chromium contexts on localhost; real WebRTC works headless. A cross-network check is a bonus, not a gate.",
        rules=[
            "No relay fallback: if the WebRTC preflight fails, delivery is blocked and the UI says so. Do not add TURN or server relay.",
            "evlog must log no message payloads, keys or secrets; add a test that greps the logs after a chat session.",
            "Memory-only: nothing is persisted to disk, storage or the server.",
            "Signaling payloads are encrypted; the server must be unable to read messages or keys.",
            "Out of scope: accounts, history, file transfer, groups, push notifications.",
        ],
    ),
    "session-seven": dict(
        what="a 60-second, 1920x1080, 16:9 cartoon 2.5D flat-art promo film covering the six products, made in Remotion with pure JavaScript.",
        env="Remotion + React + SVG/CSS, ffmpeg/ffprobe in the Linux sandbox. Authoring uses Claude Opus 5.5 via OpenRouter model ID `anthropic/claude-opus-5.5` (verified in the catalog). Music candidates: `google/lyria-3-clip-preview` or `google/lyria-3-pro-preview` via OpenRouter chat completions (audio output requires streaming); if unavailable or rejected, use the pure-JS synth fallback. Start this swarm after at least a demo build of the other six products exists so scenes can use real UI; until then use the PRD's concept layouts and say so in the evidence.",
        rules=[
            "Pure JavaScript/TypeScript: no AI video or image generation, no stock footage. Visuals are authored as code (React/SVG/CSS) in a cartoon 2.5D flat style.",
            "The rendered MP4 must be exactly 60 s, 1920x1080, with an audio track. Rendering must not depend on any model call; model output is reviewed code patches only, recorded in `authoring/reviews.md`.",
            "Never commit or log `OPENROUTER_API_KEY`. Cache accepted generated audio; rights and model are recorded.",
            "Out of scope: problem 7 ('Almost'), voiceover, subtitles in other languages, additional cuts.",
        ],
    ),
}


def layers(issues):
    keys = [i["key"] for i in issues]
    dep = {i["key"]: [d for d in i.get("depends_on", []) if d in keys] for i in issues}
    level = {}
    for k in keys:  # specs are already ordered
        level[k] = 1 + max([level[d] for d in dep[k]] + [0])
    waves = {}
    for k in keys:
        waves.setdefault(level[k], []).append(k)
    return waves


COMMON_DOD = """## 1. Definition of done (every item is a hard gate)

You are finished only when ALL of these are true and each is backed by evidence in the repo and in the issue comments. Anything less is "in progress", never "done".

1. **Issues:** every sub-issue of the epic is closed by its verifier with an evidence comment, and the epic's "Done when" boxes are all checked.
2. **Tests:** the full automated suite (lint, typecheck, unit, integration, e2e) passes from a **clean clone** with `bun install --frozen-lockfile`. Logs are saved under `evidence/tests/`.
3. **Computer use:** the finished product is driven the way a user drives it (real mouse, keyboard and windows, not only scripted API calls) through **every** element, state, command or tool in `evidence/inventory.md`.
4. **Video:** one continuous screen recording of that computer-use session shows each inventory row being exercised. `evidence/coverage.md` maps row id -> video timestamp -> screenshot -> covering test -> result.
5. **Screenshots:** at least one screenshot per inventory row (plus the error state where one exists), committed as `evidence/screens/<row-id>.png`.
6. **Independent verification:** an agent that did not write the code re-runs the suites and replays the walkthrough from a clean clone and attaches its own screenshots and verdict. Disagreements are resolved, not hidden.
7. **Reproducible handover:** README with exact setup/run/test commands, `.env.example` (no secrets), a known-limitations list, and the evidence manifest (video URL + sha256).

Evidence rules: videos are uploaded as a GitHub release asset (`gh release create evidence-<slug> <file>`) and referenced by URL + sha256 in `evidence/manifest.json`; screenshots and logs are committed. Screenshots must show the real running product, not mockups. Never include secrets in any capture."""

COMMON_ROLES = """## 4. Swarm topology

Run one swarm for this product only. Roles (separate agents; a verifier is never the builder of the same issue):

- **Lead / orchestrator (you):** owns the plan, the wave schedule, branch/merge order, the evidence ledger and the final report. You do not write feature code except to unblock.
- **Builders (parallel, one per issue in a wave):** each works in its own git worktree/branch `<slug>/<issue-key>-<short-name>` and opens a PR that says `Closes #<n>`. A builder must read the issue and the PRD sections it cites, implement only that issue, add the tests the issue names, run the issue's Verification section itself, and attach its output to the PR.
- **Verifiers (parallel, different agents from the builders):** check out the PR in a clean worktree and run the issue's **Verification** section verbatim, then the issue's acceptance criteria one by one. They post an evidence comment (commands, exit codes, output tails, screenshot paths) and set the label `status:verified` or `status:blocked`. Verifiers do not edit product code.
- **Reviewer (one):** scope and security review of each PR against the PRD scope fence, the secrets rules and the stack rules. Rejects scope creep.
- **Integrator (one):** merges verified PRs to `main` in dependency order, resolves conflicts, keeps `main` green (the full suite must pass after every merge).
- **QA / computer-use agent:** owns `evidence/inventory.md`, the recording and screenshots for the final gate; works on the real environment named in section 3.
- **Final auditor (one, fresh context):** clean-clone replay of the whole definition of done at the end.

How to run it in Manus: use the `workflow` MCP `run` tool (or background `agent` calls) to fan out each wave: one agent per issue for builders, then one per issue for verifiers. Use `sandbox=isolated` for parallel agents that touch a browser or desktop; isolated agents cannot see each other's files, so they share work only through git branches/PRs, GitHub issue comments and release assets. Give every agent a self-contained prompt: repo, issue number, PRD path, rules from this document, the evidence format and the exact output you expect back. Keep agent count within the plan's concurrency limit (batch waves if needed)."""

COMMON_LOOP = """## 6. Per-issue loop (repeat for every issue, in wave order)

1. Lead assigns issue #N to a builder (only when every `Blocked by` issue is closed).
2. Builder: branch -> implement -> write/extend tests -> run the issue's Verification section -> push -> open PR (`Closes #N`) with the verification output.
3. Reviewer: scope/security check; request changes if the PR adds anything outside the issue or PRD.
4. Verifier (different agent): clean worktree, run Verification verbatim, check each acceptance box, capture screenshots where the issue says so, comment evidence, label `status:verified` (or `status:blocked` with the exact failure).
5. Integrator merges, runs the full suite on `main`, and only then does the Lead close the issue (reference the evidence comment).
6. After each wave, the Lead updates the evidence ledger (`evidence/ledger.md`: issue, PR, verifier, result, date) and re-plans.

Failures: a failed verification sends the issue back to a builder with the verifier's exact output; after two failed rounds the Lead re-reads the PRD, simplifies the approach, and if still stuck marks `status:blocked` and escalates (section 8). Do not weaken acceptance criteria or verification to get a pass."""

COMMON_RULES = """## 3 (cont.). Non-negotiable rules

- **Scope fence:** the PRD is the contract. Build the main requirements and nothing else; do not add features, settings, pages, providers or polish that no issue asks for. If something seems missing, comment on the epic instead of building it.
- **Stack:** the same Better-T-Stack scaffold for every product, but this product is its OWN independent scaffold. Use Bun everywhere (`bun install`, `bun run`, `bunx`, `bun test`) and Playwright for browser e2e. Remove or leave inactive any scaffold part the PRD does not use; do not expand the stack.
- **From scratch:** build it yourselves with this repo's tooling. Do not use Manus webdev, Manus Studio game/video builders or any hosted app builder.
- **AI provider:** any AI call goes through OpenRouter (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` in `.env`). Commit `.env.example` only. The user will put the real key in `.env`; until then, tests use a fake adapter and the real-API checks are reported as "not run: no key", never as passed.
- **Secrets:** never print, log, screenshot or commit a key or token. Add a secret-scan check to CI/verification.
- **Honesty:** do not claim a check passed unless you ran it and kept the output. Things you could not verify must be listed as unverified, with the reason, in the final report.
- **Atomic commits:** one issue per PR, conventional commit messages, author `Jia Wei Ng <jiaweing@users.noreply.github.com>` via `git -c user.name=... -c user.email=...`."""

COMMON_EVIDENCE = """## 7. Evidence for the final gate (computer use, video, screenshots)

Do this only after every other issue is merged and green (it is the last issue, `VX`).

1. **Inventory first.** QA agent builds `evidence/inventory.md`: one row per user-reachable element, state, command or tool. Derive it from the built product (routes/components, `--help` output, the MCP tool list, scenes) AND the PRD; do not skip hard-to-reach rows. Row ids are stable (`R-001`...).
2. **Record.** Start a continuous screen recording of the real environment (ffmpeg `x11grab` on xvfb for Linux, `gdigrab` on Windows, or the platform recorder) at >= 1280x720, 15+ fps. Then drive the product by computer use through every row. Announce the row id on screen (a visible note, window title, or terminal echo) as you go.
3. **Screenshot.** At least one PNG per row, `evidence/screens/<row-id>.png`, taken while that element is on screen; add an error-state PNG where the row has an error state.
4. **Matrix.** Fill `evidence/coverage.md` (row id, timestamp in the video, screenshot, covering automated test, PASS/FAIL).
5. **Check.** Run `bun run verify:coverage` (you create it in `VX`): it fails if any row lacks a screenshot, a timestamp inside the video duration or a result, and prints ffprobe duration/resolution.
6. **Independent replay.** The final auditor repeats steps 2-5 from a clean clone with fresh screenshots and writes `evidence/audit.md` with a verdict per row.
7. **Publish.** Upload the video(s) as a release asset, record URL + sha256 in `evidence/manifest.json`, commit screenshots/logs, comment the summary on the epic and close it."""

COMMON_ESCALATE = """## 8. Blocked work and escalation

Escalate to the user (one concise message, then continue with unblocked issues) when you need: the `OPENROUTER_API_KEY`, a Windows computer, an HTTPS URL, or a product decision the PRD does not make. State what is blocked, what you already did, and the exact thing needed. Never fake the missing input, never substitute a different provider/model silently, and never close a gate with a "should work" claim."""

COMMON_REPORT = """## 9. Reporting

After each wave, post a short status on the epic: issues verified/blocked, test counts, anything unverified. At the end, post the final report on the epic: definition-of-done checklist with links (PRs, evidence comments, release asset URL + sha256, `evidence/coverage.md`, `evidence/audit.md`), plus an honest list of limitations and anything not verified. If any item in section 1 is not met, say "NOT DONE" and name it."""


def main():
    for f in sorted(glob.glob(os.path.join(ROOT, "docs/issue-specs/0*.json"))):
        spec = json.load(open(f))
        prod = spec["product"]
        sp = SPECIFIC[prod]
        st = imap[prod]
        nn = NUM[prod]
        name = NAME[prod]
        num = {k: v["number"] for k, v in st["issues"].items()}
        by = {i["key"]: i for i in spec["issues"]}
        waves = layers(spec["issues"])
        rows = []
        for w in sorted(waves):
            for k in waves[w]:
                i = by[k]
                deps = ", ".join(f"#{num[d]}" for d in i.get("depends_on", []) if d in num) or "-"
                rows.append(f"| {w} | #{num[k]} | {i['priority']} | {i['type']} | {i['title']} | {deps} |")
        table = "| Wave | Issue | Pri | Type | Title | Blocked by |\n|---|---|---|---|---|---|\n" + "\n".join(rows)
        maxpar = max(len(v) for v in waves.values())
        done_when = "\n".join(f"- {x}" for x in spec["epic_done_when"])
        rules = "\n".join(f"- {r}" for r in sp["rules"])
        text = f"""# {name}: swarm build prompt (product {nn})

> Paste this whole document as the first message of a fresh Manus task (or any agent platform with sub-agents). It is self-contained.

## 0. Mission

You are the **Lead orchestrator** of a swarm of agents that builds **{name}** from start to finish and proves it works. {name} is {sp['what']}

The scoping and discovery is finished. Your job is to **build it, verify it completely, and hand it over**. Success is not "code written"; success is every gate in section 1 met with evidence.

{COMMON_DOD}

## 2. Sources of truth

- Repo: https://github.com/{REPO} (private, branch `main`). Authenticate with `gh` (the user's token is configured in the sandbox).
- PRD (the contract): `docs/prds/{PRD[prod]}`. Stack: `docs/stack.md`. Handover and decisions: `docs/handover.md`. Scaffold script: `scaffold/{nn}-{prod}.sh`.
- Epic: https://github.com/{REPO}/issues/{st['epic']} with {len(spec['issues'])} atomic sub-issues (list in section 5). Issue bodies contain tasks, acceptance criteria, a Verification section and `Blocked by` links. Issue specs: `docs/issue-specs/{nn}-{prod}.json`.
- Labels: `priority:*`, `type:*`, `product:{prod}`, `area:*`. Add `status:verified` and `status:blocked` as you go.

Epic "Done when":
{done_when}

## 3. Environment and product-specific constraints

{sp['env']}

Where to build: create the independent scaffold at `products/{prod}/` inside the repo by running the scaffold script with target `products/{prod}` and `--no-git` instead of `--git` (the scaffold must not contain its own `.git`). Install dependencies, then boot the generated app and record that it runs BEFORE building features (the scaffold's install and boot have never been verified). Keep `products/{prod}` self-contained with its own lockfile, scripts and `.env.example`. Needs an interactive TTY for the ultracite, wxt, skills and mcp addons (answers: linter Biome; editors/agent files/hooks none; WXT template React; skills scope Project); use a pty (`script`, `expect`, or a tmux session) to answer them.

Product rules:
{rules}

{COMMON_RULES}

{COMMON_ROLES}

## 5. Work plan (waves computed from the dependency graph)

Run waves in order. Issues within a wave have no dependency on each other and may be built in parallel (max parallelism here: {maxpar}; respect your concurrency limit). Do not start a wave until every issue in the previous wave is merged and verified. Each issue's full text, acceptance criteria and Verification are in GitHub; read them there, they are the source of truth.

{table}

{COMMON_LOOP}

{COMMON_EVIDENCE}

{COMMON_ESCALATE}

{COMMON_REPORT}

## 10. Start now

1. Read the PRD, `docs/stack.md`, `docs/handover.md` and the epic; list unknowns.
2. Create the labels `status:verified` and `status:blocked` if missing.
3. Scaffold `products/{prod}/`, boot it, commit the verified-boot evidence as the first PR.
4. Run wave 1 and continue wave by wave until section 1 is fully met, then post the final report.
"""
        text = text.replace("## 3 (cont.). Non-negotiable rules", "### Non-negotiable rules")
        open(os.path.join(OUT, f"{nn}-{prod}.md"), "w").write(text)
        print(nn, prod, len(text.split()), "words", len(waves), "waves")
    readme = """# Swarm build prompts

One self-contained prompt per product. Start each in its own fresh Manus task so every product has its own swarm, context and evidence ledger. They can run in parallel except where noted.

| # | Product | Prompt | Epic |
|---|---|---|---|
""" + "\n".join(
        f"| {NUM[p]} | {NAME[p]} | [{NUM[p]}-{p}.md]({NUM[p]}-{p}.md) | [#{imap[p]['epic']}](https://github.com/{REPO}/issues/{imap[p]['epic']}) |" for p in PRD
    ) + """

Before you start any of them:

1. Put `OPENROUTER_API_KEY` (and optionally `OPENROUTER_MODEL`) in each product's `.env` once the product folder exists. Without a key, real-API checks are reported as "not run".
2. Caret needs a Windows computer attached to its task for the native gate and the final walkthrough.
3. Start Session Seven (07) after the other six have a demo build, so the film can show real UI.
4. Regenerate the prompts with `python3 scripts/gen_swarm_prompts.py` if issues change.
"""
    open(os.path.join(OUT, "README.md"), "w").write(readme)


if __name__ == "__main__":
    main()
