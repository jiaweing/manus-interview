# Glassroom: swarm build prompt (product 06)

> Paste this whole document as the first message of a fresh Manus task (or any agent platform with sub-agents). It is self-contained.

## 0. Mission

You are the **Lead orchestrator** of a swarm of agents that builds **Glassroom** from start to finish and proves it works. Glassroom is a peer-to-peer end-to-end-encrypted, memory-only chat over a WebRTC data channel with WebCrypto and encrypted signaling.

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
- PRD (the contract): `docs/prds/06-p2p-encrypted-chat.md`. Stack: `docs/stack.md`. Handover and decisions: `docs/handover.md`. Scaffold script: `scaffold/06-glassroom.sh`.
- Epic: https://github.com/jiaweing/manus-interview/issues/125 with 25 atomic sub-issues (list in section 5). Issue bodies contain tasks, acceptance criteria, a Verification section and `Blocked by` links. Issue specs: `docs/issue-specs/06-glassroom.json`.
- Labels: `priority:*`, `type:*`, `product:glassroom`, `area:*`. Add `status:verified` and `status:blocked` as you go.

Epic "Done when":
- Two desktop Chromium profiles on the demo network create/join without login, reject a third participant, mutually verify fingerprints, and exchange acknowledged text in both directions over an ordered reliable WebRTC data channel.
- Automated tests pass for authenticated signaling, transcript confirmation, verification gating, directional nonces/counters, tamper/replay rejection, wrong-secret failure, fresh-session keys, the 4 KiB UTF-8 limit, and backpressure.
- Leave, refresh, or transport loss terminates the room and clears transcript, drafts, keys, membership, and inspector state; storage checks find no application persistence or old-key reconnection.
- Production headers enforce the PRD CSP and privacy policies; HTML is rendered as text, dependencies are local, and application logs contain no bodies, URLs, or payloads.
- The development-only inspector shows actual current-room signaling ciphertext/metadata, contains no chat marker, and records no additional signaling ingress frame when a verified chat message and acknowledgement are exchanged.
- The threat table states endpoint, IP/metadata, hosting, TURN, link-leakage, and forward-secrecy limits, and the 4-minute-30-second walkthrough completes with captured release evidence.
- Final gate passed: tests, a continuous computer-use video covering every element, per-element screenshots and an independent verifier's rerun are attached.

## 3. Environment and product-specific constraints

Next.js client + Hono signaling on Bun. Verifiable in the Linux sandbox with two isolated Chromium contexts on localhost; real WebRTC works headless. A cross-network check is a bonus, not a gate.

Where to build: create the independent scaffold at `products/glassroom/` inside the repo by running the scaffold script with target `products/glassroom` and `--no-git` instead of `--git` (the scaffold must not contain its own `.git`). Install dependencies, then boot the generated app and record that it runs BEFORE building features (the scaffold's install and boot have never been verified). Keep `products/glassroom` self-contained with its own lockfile, scripts and `.env.example`. Needs an interactive TTY for the ultracite, wxt, skills and mcp addons (answers: linter Biome; editors/agent files/hooks none; WXT template React; skills scope Project); use a pty (`script`, `expect`, or a tmux session) to answer them.

Product rules:
- No relay fallback: if the WebRTC preflight fails, delivery is blocked and the UI says so. Do not add TURN or server relay.
- evlog must log no message payloads, keys or secrets; add a test that greps the logs after a chat session.
- Memory-only: nothing is persisted to disk, storage or the server.
- Signaling payloads are encrypted; the server must be unable to read messages or keys.
- Out of scope: accounts, history, file transfer, groups, push notifications.

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

Run waves in order. Issues within a wave have no dependency on each other and may be built in parallel (max parallelism here: 5; respect your concurrency limit). Do not start a wave until every issue in the previous wave is merged and verified. Each issue's full text, acceptance criteria and Verification are in GitHub; read them there, they are the source of truth.

| Wave | Issue | Pri | Type | Title | Blocked by |
|---|---|---|---|---|---|
| 1 | #126 | P0 | setup | Scaffold the independent Bun project and boot one HTTPS/WSS origin | - |
| 2 | #127 | P0 | verification | Gate the demo network with a two-profile direct-WebRTC preflight | #126 |
| 2 | #128 | P0 | feature | Implement invitation-derived authenticated signaling encryption | #126 |
| 2 | #129 | P0 | feature | Derive fresh ECDH session keys and a confirmed shared fingerprint | #126 |
| 2 | #132 | P0 | feature | Enforce two-person admission and ciphertext-only server forwarding | #126 |
| 3 | #130 | P0 | feature | Implement authenticated data envelopes with directional sequence rejection | #129 |
| 3 | #133 | P0 | feature | Create and consume fragment invitations entirely in the client | #132 |
| 4 | #131 | P0 | test | Prove the cross-module crypto release invariants with regression tests | #128, #129, #130 |
| 5 | #134 | P0 | feature | Exchange the authenticated handshake over encrypted WSS signaling | #131, #133 |
| 6 | #135 | P0 | feature | Establish the ordered reliable WebRTC channel without fallback | #127, #134 |
| 7 | #136 | P0 | feature | Lock sending until both participants confirm the shared fingerprint | #135 |
| 8 | #137 | P0 | feature | Send size-limited encrypted text and mark delivery only on peer acknowledgement | #136 |
| 9 | #138 | P0 | feature | Render authenticated incoming text and return encrypted acknowledgements | #137 |
| 10 | #139 | P0 | feature | Terminate sessions and discard all local state on leave or transport loss | #138 |
| 11 | #140 | P0 | feature | Apply the borderless monochrome UI and keyboard-accessible security states | #139 |
| 12 | #141 | P0 | feature | Expose bounded actual current-room ingress in a development-only inspector | #140 |
| 12 | #142 | P0 | feature | Enforce production CSP and no-store same-origin privacy headers | #140 |
| 12 | #146 | P0 | test | Automate the two-profile verified messaging release flow | #140 |
| 13 | #143 | P0 | feature | Disable scaffold payload logging and redact application failures | #141 |
| 13 | #144 | P0 | docs | Publish the threat-model table and verifiable security boundaries | #141 |
| 13 | #145 | P0 | test | Test admission abuse and server termination against real Bun sockets | #141 |
| 13 | #147 | P0 | test | Automate storage, teardown, and production privacy release checks | #142, #146 |
| 13 | #148 | P0 | test | Prove that acknowledged chat adds no actual server ingress frame | #141, #146 |
| 14 | #149 | P1 | verification | Rehearse the 4-minute-30-second judge walkthrough with release evidence | #143, #144, #145, #147, #148 |
| 15 | #180 | P0 | verification | Final gate: full-coverage computer-use verification with video and screenshots | #149 |

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
3. Scaffold `products/glassroom/`, boot it, commit the verified-boot evidence as the first PR.
4. Run wave 1 and continue wave by wave until section 1 is fully met, then post the final report.
