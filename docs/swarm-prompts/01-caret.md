# Caret: swarm build prompt (product 01)

> Paste this whole document as the first message of a fresh Manus task (or any agent platform with sub-agents). It is self-contained.

## 0. Mission

You are the **Lead orchestrator** of a swarm of agents that builds **Caret** from start to finish and proves it works. Caret is a Windows desktop voice-input utility: press Ctrl+Alt+Space in any app, speak, press again, and cleaned text is pasted into the focused control.

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
- PRD (the contract): `docs/prds/01-desktop-voice-input.md`. Stack: `docs/stack.md`. Handover and decisions: `docs/handover.md`. Scaffold script: `scaffold/01-caret.sh`.
- Epic: https://github.com/jiaweing/manus-interview/issues/1 with 25 atomic sub-issues (list in section 5). Issue bodies contain tasks, acceptance criteria, a Verification section and `Blocked by` links. Issue specs: `docs/issue-specs/01-caret.json`.
- Labels: `priority:*`, `type:*`, `product:caret`, `area:*`. Add `status:verified` and `status:blocked` as you go.

Epic "Done when":
- A portable Windows 11 x64 build runs as one tray instance, accepts a protected provider key, and registers Ctrl+Alt+Space while another application remains active.
- Packaged dictation inserts meaning-preserving neutral plain text in both Notepad and Chrome email compose, leaves the target focused, never sends Enter or clicks Send, and restores the unchanged plain-text clipboard sentinel.
- Recording is activation-only, capped at 60 seconds and 10 MB, and cancellation, silence, device loss, deadlines, invalid cleanup, or a changed target cannot produce a subsequent insertion; Windows safety evidence records zero wrong-window pastes.
- The non-focusable Starting, Listening, Transcribing, Cleaning, Done, and Error overlay and setup controls satisfy Appendix A; Done is labeled as Paste requested rather than application acceptance.
- Only activated audio, phrase hints, and transcript are sent externally; the protected key and local phrases persist, audio/transcripts do not persist, and payloads and secrets are absent from logs.
- All Linux fixture checks, Windows native and packaged smoke checks, and the 4:30 requirement-linked demo rehearsal have recorded passing outcomes, including unsupported-clipboard rejection and newer-copy preservation.
- Final gate passed: tests, a continuous computer-use video covering every element, per-element screenshots and an independent verifier's rerun are attached.

## 3. Environment and product-specific constraints

Electron + TypeScript React renderer + a C++ Win32 helper. The Win32 helper, the global shortcut, tray, focus capture and paste can ONLY be verified on a real Windows 11 desktop. The Linux sandbox may run unit tests and the renderer, but the Notepad native-loop gate and the final computer-use walkthrough need a Windows computer. If no Windows computer is attached to the task, finish every Linux-verifiable issue, then STOP at the Windows gate and ask the user to attach one. Never mock the native loop and never mark a Windows gate passed from Linux.

Where to build: create the independent scaffold at `products/caret/` inside the repo by running the scaffold script with target `products/caret` and `--no-git` instead of `--git` (the scaffold must not contain its own `.git`). Install dependencies, then boot the generated app and record that it runs BEFORE building features (the scaffold's install and boot have never been verified). Keep `products/caret` self-contained with its own lockfile, scripts and `.env.example`. Needs an interactive TTY for the ultracite, wxt, skills and mcp addons (answers: linter Biome; editors/agent files/hooks none; WXT template React; skills scope Project); use a pty (`script`, `expect`, or a tmux session) to answer them.

Product rules:
- Order matters: the packaged Windows Notepad native-loop gate must pass BEFORE any cloud STT/cleanup work starts.
- AI provider is OpenRouter: `OPENROUTER_API_KEY` from `.env` in development, entered once in setup for the packaged app. STT is an audio-input chat/Responses call (candidate `google/gemini-3.5-flash-lite`; Responses API accepts wav/mp3 only). Freeze one model per step after a smoke test; no model selector in the UI.
- Audio and transcripts stay in RAM; nothing sensitive is logged or persisted; the clipboard is restored only if Caret still owns it.
- Out of scope: macOS/Linux delivery, local Whisper, streaming, push-to-talk, dictionary UI, per-app profiles, history, analytics, accounts, payments.

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

Run waves in order. Issues within a wave have no dependency on each other and may be built in parallel (max parallelism here: 4; respect your concurrency limit). Do not start a wave until every issue in the previous wave is merged and verified. Each issue's full text, acceptance criteria and Verification are in GitHub; read them there, they are the source of truth.

| Wave | Issue | Pri | Type | Title | Blocked by |
|---|---|---|---|---|---|
| 1 | #2 | P0 | setup | Scaffold an independent Bun project and boot the Electron desktop shell | - |
| 2 | #3 | P0 | feature | Restrict renderer privileges and validate the preload message boundary | #2 |
| 2 | #4 | P0 | feature | Implement single-instance tray startup and the fixed toggle shortcut | #2 |
| 2 | #5 | P0 | feature | Render the six-state overlay without taking application focus | #2 |
| 2 | #6 | P0 | feature | Add the bounded Win32 helper protocol and target snapshot operation | #2 |
| 3 | #7 | P0 | feature | Request one Unicode paste only when the captured Windows target is unchanged | #6 |
| 4 | #8 | P0 | feature | Restore owned clipboard text conditionally and reject unsupported formats | #7 |
| 5 | #9 | P0 | verification | Pass the packaged Windows Notepad native-loop gate before cloud work | #4, #5, #8 |
| 6 | #10 | P0 | feature | Implement the bounded session state machine and stale-response invalidation | #3, #4, #5, #6, #9 |
| 6 | #21 | P0 | test | Run native Windows clipboard regression tests with preservation evidence | #8, #9 |
| 7 | #11 | P0 | feature | Capture bounded WebM audio and release the microphone on every exit | #3, #10 |
| 7 | #12 | P0 | feature | Send one abortable OpenRouter audio-input transcription request with phrase hints | #10 |
| 7 | #13 | P0 | feature | Apply one neutral cleanup request and reject invalid or renumbered output | #10 |
| 7 | #15 | P0 | feature | Persist the protected provider key and disclose cloud processing in setup | #3, #4, #10 |
| 8 | #14 | P0 | feature | Connect capture, transcription, cleanup, and one guarded paste attempt | #7, #8, #10, #11, #12, #13 |
| 8 | #16 | P0 | feature | Load local phrase configuration and pass it only as transcription hints | #12, #15 |
| 9 | #17 | P0 | feature | Remove transient content on termination and exclude sensitive data from logs | #11, #14, #15, #16 |
| 9 | #19 | P0 | test | Test neutral cleanup fidelity and embedded-instruction rejection | #13, #14 |
| 9 | #20 | P0 | test | Test IPC and insertion rejection paths with Linux protocol fixtures | #3, #6, #14 |
| 10 | #18 | P0 | test | Prove recording and cancellation release invariants with Linux fixtures | #14, #17 |
| 10 | #22 | P0 | verification | Verify Windows cancellation and target-switch safety without wrong-window pastes | #14, #17 |
| 11 | #23 | P0 | docs | Document the selected alternatives and Linux-to-Windows verification runbook | #12, #13, #15, #16, #18, #20, #21, #22 |
| 11 | #24 | P0 | verification | Package the portable Windows release and pass both application smoke checks | #14, #15, #16, #17, #18, #19, #20, #21, #22 |
| 12 | #25 | P1 | verification | Rehearse the 4:30 PRD demo and capture requirement-linked pass evidence | #23, #24 |
| 13 | #175 | P0 | verification | Final gate: full-coverage computer-use verification with video and screenshots | #25 |

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
3. Scaffold `products/caret/`, boot it, commit the verified-boot evidence as the first PR.
4. Run wave 1 and continue wave by wave until section 1 is fully met, then post the final report.
