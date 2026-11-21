# Sidekick: swarm build prompt (product 04)

> Paste this whole document as the first message of a fresh Manus task (or any agent platform with sub-agents). It is self-contained.

## 0. Mission

You are the **Lead orchestrator** of a swarm of agents that builds **Sidekick** from start to finish and proves it works. Sidekick is a Chrome side-panel agent built with WXT: the user types a task, sees a plan, presses Run, and the agent acts on the page one supervised step at a time.

The scoping and discovery is finished. Your job is to **build it, verify it completely, and hand it over**. Success is not "code written"; success is every gate in section 1 met with evidence.

## 1. Definition of done (every item is a hard gate)

You are finished only when ALL of these are true and each is backed by evidence in the repo and in the issue comments. Anything less is "in progress", never "done".

1. **Issues:** every sub-issue of the epic is closed by its verifier with an evidence comment, and the epic's "Done when" boxes are all checked.
2. **Tests:** the full automated suite (lint, typecheck, unit, integration, e2e) passes from a **clean clone** with `bun install --frozen-lockfile`. Logs are saved under `evidence/tests/`.
3. **Computer use:** the finished product is driven the way a user drives it (real mouse, keyboard and windows, not only scripted API calls) through **every** element, state, command or tool in `evidence/inventory.md`.
4. **Video:** one continuous screen recording of that computer-use session shows each inventory row being exercised. `evidence/coverage.md` maps row id -> video timestamp -> screenshot -> covering test -> result.
5. **Screenshots:** at least one screenshot per inventory row (plus the error state where one exists), committed as `evidence/screens/<row-id>.png`.
6. **Independent verification:** an agent that did not write the code re-runs the suites and replays the walkthrough from a clean clone and attaches its own screenshots and verdict. Disagreements are resolved, not hidden.
7. **Reproducible handover:** README with exact setup/run/test commands, `.env.example` (no secrets), a known-limitations list, and the evidence manifest (video URL + sha256).

Evidence rules: videos are uploaded as a GitHub release asset (`gh release create evidence-<slug> <file>`) and referenced by URL + sha256 in `evidence/manifest.json`; screenshots and logs are committed. Screenshots must show the real running product, not mockups. Never include secrets in any capture.

## 2. Sources of truth

- Repo: https://github.com/jiaweing/manus-interview (private, branch `main`). Authenticate with `gh` (the user's token is configured in the sandbox).
- PRD (the contract): `docs/prds/04-chrome-agent-sidepanel.md`. Stack: `docs/stack.md`. Handover and decisions: `docs/handover.md`. Scaffold script: `scaffold/04-sidekick.sh`.
- Epic: https://github.com/jiaweing/manus-interview/issues/75 with 25 atomic sub-issues (list in section 5). Issue bodies contain tasks, acceptance criteria, a Verification section and `Blocked by` links. Issue specs: `docs/issue-specs/04-sidekick.json`.
- Labels: `priority:*`, `type:*`, `product:sidekick`, `area:*`. Add `status:verified` and `status:blocked` as you go.

Epic "Done when":
- An independent Bun-based Sidekick scaffold builds an unpacked MV3 extension; its toolbar opens chrome.sidePanel and its authenticated HTTPS proxy uses a single server-fixed OpenRouter model model without exposing the provider key.
- The panel presents task input, selected-tab context, token configuration, provider disclosure, a pre-execution plan, Run, labelled step states, confirmation, and Stop; it meets the prescribed borderless monochrome design and keyboard/320-pixel requirements.
- Indexed, bounded, redacted top-frame snapshots ground read/find, scroll, click, ordinary fill, and open/switch-tab tools; every action validates its target identity and receives fresh observation, and unsafe actions cannot bypass extension-side policy.
- Runs enforce 15 turns, 120 active seconds excluding approvals, a 20-second model deadline, one read retry, no uncertain mutation replay, cancellation on Stop/panel closure, and evidence-based Success versus Failed, Stopped, or Unverified.
- The Wikipedia and httpbin acceptances each pass twice; regression tests prove stale-index handling, malformed-tool rejection, network failure, Stop, denied submission, and injected-page-instruction handling with zero failures.
- Installation/preflight instructions are usable and the exact four-part PRD demo completes in under five minutes with live evidence and passing safety/error tests.
- Final gate passed: tests, a continuous computer-use video covering every element, per-element screenshots and an independent verifier's rerun are attached.

## 3. Environment and product-specific constraints

WXT (React template) with a hand-added side-panel entrypoint (the scaffold generates none), plus a Hono proxy using OpenRouter. Verify in headed Chromium with the unpacked extension (xvfb in the Linux sandbox works) driven by computer use; Playwright can load the extension for automated tests.

Where to build: create the independent scaffold at `products/sidekick/` inside the repo by running the scaffold script with target `products/sidekick` and `--no-git` instead of `--git` (the scaffold must not contain its own `.git`). Install dependencies, then boot the generated app and record that it runs BEFORE building features (the scaffold's install and boot have never been verified). Keep `products/sidekick` self-contained with its own lockfile, scripts and `.env.example`. Needs an interactive TTY for the ultracite, wxt, skills and mcp addons (answers: linter Biome; editors/agent files/hooks none; WXT template React; skills scope Project); use a pty (`script`, `expect`, or a tmux session) to answer them.

Product rules:
- The extension never holds the OpenRouter key. The Hono proxy reads `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` from `.env` (default candidate `anthropic/claude-sonnet-5.5`), authenticates the extension with a static token over HTTPS (localhost allowed in dev), and uses one server-fixed model with no provider picker.
- Only the extension executes browser tools. Page content is untrusted data and must never override user instructions; a deterministic policy outside the model blocks forbidden actions.
- Plan-before-Run, one action per loop turn, a working Stop, and every error surfaced to the user.
- Out of scope: multiple providers, accounts, payments, sync, store publishing, Firefox/Safari.

### Non-negotiable rules

- **Scope fence:** the PRD is the contract. Build the main requirements and nothing else; do not add features, settings, pages, providers or polish that no issue asks for. If something seems missing, comment on the epic instead of building it.
- **Stack:** the same Better-T-Stack scaffold for every product, but this product is its OWN independent scaffold. Use Bun everywhere (`bun install`, `bun run`, `bunx`, `bun test`) and Playwright for browser e2e. Remove or leave inactive any scaffold part the PRD does not use; do not expand the stack.
- **From scratch:** build it yourselves with this repo's tooling. Do not use Manus webdev, Manus Studio game/video builders or any hosted app builder.
- **AI provider:** any AI call goes through OpenRouter (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` in `.env`). Commit `.env.example` only. The user will put the real key in `.env`; until then, tests use a fake adapter and the real-API checks are reported as "not run: no key", never as passed.
- **Secrets:** never print, log, screenshot or commit a key or token. Add a secret-scan check to CI/verification.
- **Honesty:** do not claim a check passed unless you ran it and kept the output. Things you could not verify must be listed as unverified, with the reason, in the final report.
- **Atomic commits:** one issue per PR, conventional commit messages, author `Jia Wei Ng <jiaweing@users.noreply.github.com>` via `git -c user.name=... -c user.email=...`.

## 4. Swarm topology

Run one swarm for this product only. Roles (separate agents; a verifier is never the builder of the same issue):

- **Lead / orchestrator (you):** owns the plan, the wave schedule, branch/merge order, the evidence ledger and the final report. You do not write feature code except to unblock.
- **Builders (parallel, one per issue in a wave):** each works in its own git worktree/branch `<slug>/<issue-key>-<short-name>` and opens a PR that says `Closes #<n>`. A builder must read the issue and the PRD sections it cites, implement only that issue, add the tests the issue names, run the issue's Verification section itself, and attach its output to the PR.
- **Verifiers (parallel, different agents from the builders):** check out the PR in a clean worktree and run the issue's **Verification** section verbatim, then the issue's acceptance criteria one by one. They post an evidence comment (commands, exit codes, output tails, screenshot paths) and set the label `status:verified` or `status:blocked`. Verifiers do not edit product code.
- **Reviewer (one):** scope and security review of each PR against the PRD scope fence, the secrets rules and the stack rules. Rejects scope creep.
- **Integrator (one):** merges verified PRs to `main` in dependency order, resolves conflicts, keeps `main` green (the full suite must pass after every merge).
- **QA / computer-use agent:** owns `evidence/inventory.md`, the recording and screenshots for the final gate; works on the real environment named in section 3.
- **Final auditor (one, fresh context):** clean-clone replay of the whole definition of done at the end.

How to run it in Manus: use the `workflow` MCP `run` tool (or background `agent` calls) to fan out each wave: one agent per issue for builders, then one per issue for verifiers. Use `sandbox=isolated` for parallel agents that touch a browser or desktop; isolated agents cannot see each other's files, so they share work only through git branches/PRs, GitHub issue comments and release assets. Give every agent a self-contained prompt: repo, issue number, PRD path, rules from this document, the evidence format and the exact output you expect back. Keep agent count within the plan's concurrency limit (batch waves if needed).

## 5. Work plan (waves computed from the dependency graph)

Run waves in order. Issues within a wave have no dependency on each other and may be built in parallel (max parallelism here: 3; respect your concurrency limit). Do not start a wave until every issue in the previous wave is merged and verified. Each issue's full text, acceptance criteria and Verification are in GitHub; read them there, they are the source of truth.

| Wave | Issue | Pri | Type | Title | Blocked by |
|---|---|---|---|---|---|
| 1 | #76 | P0 | setup | Scaffold the independent Bun workspace and boot only extension and proxy | - |
| 2 | #77 | P0 | setup | Register the MV3 Side Panel and scoped browser permissions | #76 |
| 2 | #78 | P0 | setup | Secure and publish the Hono proxy over authenticated HTTPS | #76 |
| 3 | #79 | P0 | feature | Implement the OpenRouter model single-tool turn endpoint and validated protocol | #78 |
| 3 | #80 | P0 | feature | Build the borderless panel shell with context, token, and disclosure | #77 |
| 3 | #81 | P0 | feature | Capture indexed top-frame DOM snapshots with document identity | #77 |
| 4 | #82 | P0 | feature | Redact and bound snapshots while supporting targeted text observation | #81, #79 |
| 4 | #83 | P0 | feature | Reject stale actions before isolated content-script dispatch | #81, #79 |
| 5 | #84 | P0 | feature | Implement validated observe, find-text, and clamped scroll tools | #82, #83 |
| 5 | #85 | P0 | feature | Execute ordinary click and fill tools with local value checks | #83, #82 |
| 6 | #86 | P0 | feature | Manage requested tabs and pause or stop on browser-target changes | #77, #83, #84 |
| 7 | #87 | P0 | feature | Enforce extension-side action safety and untrusted-page boundaries | #79, #82, #83, #85, #86 |
| 8 | #88 | P0 | feature | Connect plan-before-Run to a one-action OpenRouter execution loop | #79, #80, #84, #85, #86, #87 |
| 9 | #89 | P0 | feature | Bound run duration and prevent uncertain mutation retries | #88 |
| 9 | #90 | P0 | feature | Render explicit intent, execution, and outcome states in the timeline | #80, #88 |
| 10 | #91 | P0 | feature | Cancel pending requests and queued actions on Stop or panel closure | #89, #90 |
| 11 | #92 | P0 | feature | Bind risky-action confirmation to exact outbound data and target identity | #87, #90, #91, #85 |
| 12 | #93 | P0 | feature | Determine completion from fresh local and destination evidence | #84, #85, #86, #89, #92 |
| 13 | #94 | P0 | test | Prove stale-index, malformed-tool, and injection defenses across boundaries | #87, #92, #93 |
| 13 | #95 | P0 | test | Prove cancellation, denied submission, and network uncertainty end to end | #89, #91, #92, #93, #86 |
| 14 | #96 | P0 | verification | Verify consecutive Wikipedia research actions and the reference tab | #93, #94, #95 |
| 14 | #97 | P0 | verification | Verify dummy-form preparation, rejection, approved evidence, and Stop | #93, #94, #95 |
| 14 | #98 | P1 | docs | Document unpacked installation and the required demo preflight | #77, #78, #79, #80, #94, #95 |
| 15 | #99 | P0 | verification | Rehearse the exact release demo twice within five minutes | #96, #97, #98 |
| 16 | #178 | P0 | verification | Final gate: full-coverage computer-use verification with video and screenshots | #99 |

## 6. Per-issue loop (repeat for every issue, in wave order)

1. Lead assigns issue #N to a builder (only when every `Blocked by` issue is closed).
2. Builder: branch -> implement -> write/extend tests -> run the issue's Verification section -> push -> open PR (`Closes #N`) with the verification output.
3. Reviewer: scope/security check; request changes if the PR adds anything outside the issue or PRD.
4. Verifier (different agent): clean worktree, run Verification verbatim, check each acceptance box, capture screenshots where the issue says so, comment evidence, label `status:verified` (or `status:blocked` with the exact failure).
5. Integrator merges, runs the full suite on `main`, and only then does the Lead close the issue (reference the evidence comment).
6. After each wave, the Lead updates the evidence ledger (`evidence/ledger.md`: issue, PR, verifier, result, date) and re-plans.

Failures: a failed verification sends the issue back to a builder with the verifier's exact output; after two failed rounds the Lead re-reads the PRD, simplifies the approach, and if still stuck marks `status:blocked` and escalates (section 8). Do not weaken acceptance criteria or verification to get a pass.

## 7. Evidence for the final gate (computer use, video, screenshots)

Do this only after every other issue is merged and green (it is the last issue, `VX`).

1. **Inventory first.** QA agent builds `evidence/inventory.md`: one row per user-reachable element, state, command or tool. Derive it from the built product (routes/components, `--help` output, the MCP tool list, scenes) AND the PRD; do not skip hard-to-reach rows. Row ids are stable (`R-001`...).
2. **Record.** Start a continuous screen recording of the real environment (ffmpeg `x11grab` on xvfb for Linux, `gdigrab` on Windows, or the platform recorder) at >= 1280x720, 15+ fps. Then drive the product by computer use through every row. Announce the row id on screen (a visible note, window title, or terminal echo) as you go.
3. **Screenshot.** At least one PNG per row, `evidence/screens/<row-id>.png`, taken while that element is on screen; add an error-state PNG where the row has an error state.
4. **Matrix.** Fill `evidence/coverage.md` (row id, timestamp in the video, screenshot, covering automated test, PASS/FAIL).
5. **Check.** Run `bun run verify:coverage` (you create it in `VX`): it fails if any row lacks a screenshot, a timestamp inside the video duration or a result, and prints ffprobe duration/resolution.
6. **Independent replay.** The final auditor repeats steps 2-5 from a clean clone with fresh screenshots and writes `evidence/audit.md` with a verdict per row.
7. **Publish.** Upload the video(s) as a release asset, record URL + sha256 in `evidence/manifest.json`, commit screenshots/logs, comment the summary on the epic and close it.

## 8. Blocked work and escalation

Escalate to the user (one concise message, then continue with unblocked issues) when you need: the `OPENROUTER_API_KEY`, a Windows computer, an HTTPS URL, or a product decision the PRD does not make. State what is blocked, what you already did, and the exact thing needed. Never fake the missing input, never substitute a different provider/model silently, and never close a gate with a "should work" claim.

## 9. Reporting

After each wave, post a short status on the epic: issues verified/blocked, test counts, anything unverified. At the end, post the final report on the epic: definition-of-done checklist with links (PRs, evidence comments, release asset URL + sha256, `evidence/coverage.md`, `evidence/audit.md`), plus an honest list of limitations and anything not verified. If any item in section 1 is not met, say "NOT DONE" and name it.

## 10. Start now

1. Read the PRD, `docs/stack.md`, `docs/handover.md` and the epic; list unknowns.
2. Create the labels `status:verified` and `status:blocked` if missing.
3. Scaffold `products/sidekick/`, boot it, commit the verified-boot evidence as the first PR.
4. Run wave 1 and continue wave by wave until section 1 is fully met, then post the final report.
