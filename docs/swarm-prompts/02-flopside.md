# Flopside: swarm build prompt (product 02)

> Paste this whole document as the first message of a fresh Manus task (or any agent platform with sub-agents). It is self-contained.

## 0. Mission

You are the **Lead orchestrator** of a swarm of agents that builds **Flopside** from start to finish and proves it works. Flopside is a simple 2.5D browser multiplayer Texas Hold'em (play money, 2-4 seats, heads-up supported) with a server-authoritative engine and hidden hole cards.

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
- PRD (the contract): `docs/prds/02-multiplayer-web-game.md`. Stack: `docs/stack.md`. Handover and decisions: `docs/handover.md`. Scaffold script: `scaffold/02-flopside.sh`.
- Epic: https://github.com/jiaweing/manus-interview/issues/26 with 25 atomic sub-issues (list in section 5). Issue bodies contain tasks, acceptance criteria, a Verification section and `Blocked by` links. Issue specs: `docs/issue-specs/02-flopside.json`.
- Labels: `priority:*`, `type:*`, `product:flopside`, `area:*`. Add `status:verified` and `status:blocked` as you go.

Epic "Done when":
- The independent Bun scaffold boots and its Manus-published HTTPS/WSS deployment demonstrably routes two browsers to the same single in-memory server instance.
- Two to four humans can create/share/join/start; a fifth seat receives ROOM_FULL, joins during play receive MATCH_STARTED, and heads-up and four-seat games use the required turn order.
- Automated poker tests pass for hand ranking, wheel/kickers/ties, total-to wagers, short raises, side pots/refunds, chip conservation and server-clock auto-fold after 12 seconds.
- Every HTTP response, WebSocket snapshot and animation event exposes only the viewer’s private cards before eligible showdown; privacy, stale-command, duplicate-command and recovery tests pass.
- Reconnect within 60 seconds preserves seat/cards/deadline; expiry, bust or ten hands produce identical results; same-room rematch resets the required state and rejects starts with fewer than two connected seats.
- The responsive, keyboard-accessible borderless monochrome UI shows rules/free chips and shared state; the Playwright two-context lifecycle, published checks, saved checkpoint and under-five-minute PRD demo all pass.
- Final gate passed: tests, a continuous computer-use video covering every element, per-element screenshots and an independent verifier's rerun are attached.

## 3. Environment and product-specific constraints

Hono on Bun native WebSockets, in-memory rooms, Next.js client. Fully verifiable in the Linux sandbox with Playwright using 2-4 browser contexts, and with computer use on real browser windows. Self-hosted: ship a production build (`bun run build && bun run start`) plus a Dockerfile. No Manus webdev, no polling fallback.

Where to build: create the independent scaffold at `products/flopside/` inside the repo by running the scaffold script with target `products/flopside` and `--no-git` instead of `--git` (the scaffold must not contain its own `.git`). Install dependencies, then boot the generated app and record that it runs BEFORE building features (the scaffold's install and boot have never been verified). Keep `products/flopside` self-contained with its own lockfile, scripts and `.env.example`. Needs an interactive TTY for the ultracite, wxt, skills and mcp addons (answers: linter Biome; editors/agent files/hooks none; WXT template React; skills scope Project); use a pty (`script`, `expect`, or a tmux session) to answer them.

Product rules:
- The server is the only authority. Hole cards must never be sent to anyone but their owner; add a test that inspects every outbound message for every seat.
- The hand evaluator needs exhaustive/property tests (known hand rankings, ties, split pots, side pots, all-in, heads-up blind rules).
- Normal deployment has no deterministic deck; a deterministic deck exists only behind a test flag that is verified off in the production build.
- Rooms are in-memory: a backend restart loses them and clients show `Room lost — create again`.
- Out of scope: accounts, real money, matchmaking, persistence, tournaments, mobile app, the 'poker with a twist' variant (an open user question; do not invent a twist).

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
| 1 | #27 | P0 | setup | Scaffold and boot the independent Bun web and server apps | - |
| 2 | #28 | P0 | verification | Prove WebSocket ingress reaches one Bun instance in a production build | #27 |
| 3 | #29 | P0 | feature | Evaluate the best five-card Hold’em hand and compare ties | #28 |
| 3 | #30 | P0 | feature | Deal server-owned hands and advance Hold’em streets and actors | #28 |
| 4 | #31 | P0 | feature | Enforce total-to wagers and full-raise reopening rules | #30 |
| 4 | #36 | P0 | feature | Create in-memory rooms and enforce lobby seating and start rules | #30 |
| 5 | #32 | P0 | feature | Settle eligible side pots and return unmatched wagers | #29, #31 |
| 6 | #33 | P0 | feature | Expire turns against an authoritative 12-second deadline | #32 |
| 6 | #34 | P0 | feature | Finish matches and reset eligible same-room rematches | #32 |
| 7 | #35 | P0 | test | Prove the poker reducer’s edge cases with deterministic regressions | #29, #30, #31, #32, #33, #34 |
| 7 | #37 | P0 | feature | Project viewer-specific snapshots and redact every card event | #36, #31, #32, #34 |
| 8 | #38 | P0 | feature | Serialize authenticated socket commands with revisions and deduplication | #28, #33, #37 |
| 9 | #39 | P0 | feature | Resume reserved seats and settle matches after connection expiry | #38, #34 |
| 10 | #40 | P0 | feature | Bound transport input and prevent secret logging | #38, #39 |
| 11 | #41 | P0 | feature | Build the nickname lobby and shareable room invitation | #38, #40 |
| 11 | #46 | P0 | test | Assert private-card redaction across real HTTP and socket paths | #37, #38, #39, #40 |
| 11 | #47 | P0 | test | Test room capacity and queued recovery and completion boundaries | #39, #40, #35 |
| 12 | #42 | P0 | feature | Reconcile client snapshots and recover without replaying betting intent | #39, #41 |
| 13 | #43 | P0 | feature | Render legal poker controls and the free-chip rules summary | #42, #31 |
| 13 | #45 | P0 | feature | Display shared results and host-controlled same-room replay | #42, #34, #39 |
| 14 | #44 | P0 | feature | Render the responsive 2.5D table with accessible card labels | #43, #37 |
| 15 | #48 | P0 | test | Automate the two-context lifecycle with refresh and timeout | #44, #45, #46, #47 |
| 16 | #49 | P0 | verification | Verify the release build over real WebSockets and record the tested commit | #28, #35, #46, #47, #48 |
| 17 | #50 | P0 | verification | Rehearse and capture the PRD’s timed two-browser demo | #49 |
| 18 | #176 | P0 | verification | Final gate: full-coverage computer-use verification with video and screenshots | #50 |

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
3. Scaffold `products/flopside/`, boot it, commit the verified-boot evidence as the first PR.
4. Run wave 1 and continue wave by wave until section 1 is fully met, then post the final report.
