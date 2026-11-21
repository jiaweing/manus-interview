# Almost — A museum of unfinished things

**Builder:** Jia Wei Ng · **Build environment:** Manus Studio · **Budget:** one session, approximately 6–8 hours

## 1. Overview

**Almost** is a private, browser-local museum of unfinished creative projects. It frames abandoned stories, illustrations, and prototypes as exhibits worth keeping. Solo makers choose an exhibit, receive a five-, fifteen-, or thirty-minute restart card, and record tangible progress. The gallery lights up when something moves again—not when everything is finished. For people tired of productivity guilt, its promise is: **“Unfinished is not the same as failed.”**

### Ideation log

Subjective judgments, not market validation. Scores run from 1, weak, to 5, strong: **O** originality, **D** delight/demo potential, **F** single-session feasibility, **U** usefulness, **X** differentiation. Equal weights; maximum 25. Feasibility assumes narrow local-first implementations.

| Candidate: one-line concept | O | D | F | U | X | Total |
|---|---:|---:|---:|---:|---:|---:|
| **Almost:** turn abandoned creative work into a private museum with tiny restart cards. | 5 | 5 | 5 | 4 | 5 | **24** |
| Borrowed Shelf: a visual map of belongings lent to friends and graceful return requests. | 3 | 4 | 4 | 4 | 5 | 20 |
| Quiet Credits: make invisible household labor visible without competitive scorekeeping. | 4 | 4 | 4 | 4 | 5 | 21 |
| Enough Jar: park tempting purchases beside what you already own and reconsider them later. | 3 | 4 | 5 | 4 | 5 | 21 |
| Future Fridge: arrange soon-to-expire ingredients into a visual use-next dinner board. | 3 | 4 | 3 | 5 | 4 | 19 |
| Memory Margins: preserve family recipes alongside handwritten memories and substitutions. | 4 | 5 | 4 | 4 | 5 | 22 |
| Pocket Observatory: collect small neighborhood discoveries into a growing illustrated field guide. | 4 | 4 | 5 | 3 | 5 | 21 |
| Oops Atlas: convert everyday mistakes into reusable, nonjudgmental repair cards. | 4 | 4 | 4 | 4 | 4 | 20 |

**Decision:** Almost’s before/after reveal demonstrates emotional resonance and usefulness. Memory Margins depends more heavily on meaningful family material. Almost avoids all seven neighboring briefs: voice input, multiplayer game, plugin-agent harness, Chrome side-panel agent, MCP terminal controller, P2P encrypted chat, and promo video. Its museum-and-restart interaction differentiates it; project tracking itself is not new.

## 2. Problem statement and the original brief

People often retain abandoned work but lose the context needed to restart it. Task lists emphasize obligations; blank canvases erase what already exists. Almost preserves the artifact, the reason it stalled, and a bounded next action. WIP emphasizes makers shipping together and accountability through incremental progress; Almost deliberately chooses private re-entry without a public feed or daily streak. [1]

The original brief gives Jia Wei complete creative freedom, provided a genuinely new product is built inside this Studio session and its journey remains visible.

- [ ] **R1:** Choose an original, personally motivated product rather than another assigned problem.
- [ ] **R2:** Decide the product form, domain, and stack freely.
- [ ] **R3:** Build from scratch; reuse no existing project.
- [ ] **R4:** Build inside Manus Studio during this session.
- [ ] **R5:** Make the whole journey from idea to finished product visible, including ideation.
- [ ] **R6:** Brainstorm at least eight candidates, one line each.
- [ ] **R7:** Score originality, delight/demo potential, feasibility, usefulness, and differentiation from the seven other briefs.
- [ ] **R8:** Select one winner and produce its full PRD with an Overview ideation table.
- [ ] **R9:** Prefer something novel, emotionally resonant, and visually demoable.

## 3. Goals and non-goals

**Goals:** Add an exhibit in under two minutes; produce a believable next action immediately; preserve before/after evidence; demonstrate the entire loop without login or network dependencies after loading. Ship a polished artifact, not a planning dashboard with a museum-themed background.

**Non-goals:** Completing users’ projects, diagnosing procrastination, providing therapy, collaboration, streaks, scheduled reminders, source-code execution, repository imports, cloud sync, or automatic image interpretation. Manus assists development; runtime AI is not required. No autonomous agent features are hidden inside the MVP.

## 4. Target users and key user stories

**Primary:** an illustrator, writer, or indie builder returning to work after losing momentum. **Secondary:** a hackathon judge evaluating a visibly original, functional product.

- **US1 — Preserve:** “I want my unfinished thing to feel worth keeping.” Acceptance: title, domain, current-state note, blocker, and optional image create a dated exhibit; reloading preserves it.
- **US2 — Restart:** “I have five minutes, not a new life plan.” Acceptance: choosing a time budget produces one action, a tangible output, and an explicit stopping condition; the card names the user’s chosen project unit.
- **US3 — Recognize movement:** “I want proof that I touched it again.” Acceptance: a required progress note, with optional new image, creates a dated entry and changes the exhibit to “Moved again,” without claiming completion.
- **US4 — Let go:** “I may decide this project no longer matters.” Acceptance: “Keep as a memory” retires it without negative language; reopening is possible and history remains intact.
- **US5 — Keep control:** “My unfinished work is private.” Acceptance: no artifact upload requests occur; export, clear, and restore reproduce the same gallery locally.

## 5. Core user flows

**Capture:** Empty museum → “Add unfinished thing” → title, domain, current state, smallest unit, blocker, optional image → save → framed exhibit. Missing fields get inline errors; invalid images preserve the text draft. Samples require explicit opt-in and stay labeled.

**Restart:** Select exhibit → choose 5/15/30 minutes → edit and save restart card → work outside Almost → record progress → frame brightens; compare original/latest artifacts. The budget scopes an action, not verified effort; there is no countdown. Warn before discarding unsaved edits.

**Release:** Retire → Memories filter → reopen. Confirm deletion; remove images and history transactionally. Never show success after a failed write.

**Backup:** Export JSON → confirm clear → import → validate → restore atomically. Nonempty imports require explicit replacement, never silent merging. Invalid backups change nothing.

## 6. Functional requirements

### P0 — MVP

- **F01:** Responsive museum grid, exhibit detail drawer, and status filters: Resting, Moved again, Memories. Distinct typography, paper labels, and restrained frame lighting are core UI.
- **F02:** Create/edit up to 20 exhibits across writing, illustration, coding, and other; support text-only artifacts plus one original raster image.
- **F03:** Generate deterministic restart cards using domain × blocker templates and the chosen time budget. Show “Suggested from your inputs,” never “AI analyzed your work.”
- **F04:** Save progress notes and an optional latest image; show original/latest comparison and a dated text history. Replace the previous latest image rather than retaining every image.
- **F05:** Retire, reopen, and delete exhibits; every mutation persists locally with visible failure handling.
- **F06:** Versioned backup export/import, clear-data control, and local-only storage notice.
- **F07:** Opt-in sample museum with three original sample artifacts; visually mark samples and exclude them from user metrics.
- **F08:** A “Built here” panel links the ideation log, visible session evidence, checkpoint ledger, and final demo. It explains what evidence exists rather than asserting unverifiable provenance.

### P1 — Stretch, only after all P0 passes

- **F09:** Export a beautifully typeset single-exhibit PNG postcard using the same DOM design.
- **F10:** Search titles and notes; allow several saved restart cards per exhibit.

### P2 — Explicitly outside this session

- **F11:** Optional consented AI card refinement with a server-side credential and deterministic fallback.
- **F12:** Account-based encrypted backup and cross-device restoration. Do not promise this security model before designing it.

## 7. Non-functional requirements

**Latency/performance:** At 20 exhibits, target gallery readiness within two seconds and saved-state feedback within 500 ms, excluding image decoding. Rule generation: under 50 ms. Lazy-load thumbnails; no WebGL or heavyweight animation.

**Reliability:** Transaction failures preserve committed state and form drafts. Browser storage is origin-scoped and best-effort; persistence requests are not guarantees, and private-mode data may disappear. Explain limitations and offer backup. [2] Preview-to-published migration requires export/import across origins.

**Privacy/security:** No analytics, accounts, third-party fonts, or remote artifacts. Render plain text. Decode PNG/JPEG/WebP only; reject SVG/executables, bound processing, and strip metadata by raster re-encoding. Local data is not encrypted; shared-profile users can access it. Backups contain personal material.

**Accessibility:** All actions keyboard-accessible; drawer traps focus and restores it on close. Provide image descriptions, visible labels, 4.5:1 text contrast, non-color status labels, and reduced-motion support. At 375 px, use stacked cards; never require spatial dragging.

## 8. Proposed architecture and tech stack

Use **React + TypeScript + Vite, Tailwind CSS, native CSS transitions, Dexie over IndexedDB, Zod, `bun test`, and Playwright**. Initialize a fresh Studio project with framework scaffolding, not a copied application. Deploy through Studio’s standard web preview/publishing path; no backend is needed.

```text
React museum / forms / detail drawer
        | commands              | reads
        v                       v
Zod validation -------> Exhibit service
        |                 |           |
        v                 v           v
Raster normalizer   Rule engine    Dexie transactions
        |                             |
        +--------------------------> IndexedDB
                                      |
                               JSON backup adapter

Build evidence: ideation + Studio transcript/recording + checkpoints
```

**Decisions:** Framed cards convey a museum without 3D navigation. Twelve domain/blocker templates produce bounded, testable actions. Local-first removes authentication and API failure risks. Backups protect emotionally valuable work.

**Rejected:** Three.js consumes time on navigation/accessibility. Runtime LLMs add privacy, latency, and evaluation work. Public galleries require moderation and consent. LocalStorage is unsuitable for binary image records.

## 9. Data model / protocol / API surface

No network API in P0. Persist these records:

```ts
type Domain = 'writing' | 'illustration' | 'coding' | 'other';
type Blocker = 'too-big' | 'unclear-next-step' | 'perfection';
type Exhibit = {
  id: string; title: string; domain: Domain; blocker: Blocker;
  currentState: string; nextUnit: string;
  status: 'resting' | 'moved' | 'memory'; sample: boolean;
  originalImageId?: string; latestImageId?: string;
  createdAt: string; updatedAt: string;
};
type RestartCard = {
  id: string; exhibitId: string; budget: 5 | 15 | 30;
  action: string; output: string; stopWhen: string;
  templateId: string; createdAt: string;
};
type Progress = {
  id: string; exhibitId: string; cardId: string;
  note: string; createdAt: string;
};
```

`images` stores `{id, blob, mime, width, height}` separately; dates are ISO-8601, IDs are UUIDs. Required title: 1–80 characters; notes: 1–1,000; next unit: 1–120. Input images: maximum 5 MiB and 16 megapixels; normalize to at most 1,024 px on the longest side and 250 KiB, otherwise reject cleanly.

Service signatures: `createExhibit(input): Promise<Exhibit>`, `generateCard(exhibit, budget): RestartCard`, `saveCard(card): Promise<void>`, `recordProgress(cardId, note, image?): Promise<void>`, `setStatus(id, status): Promise<void>`, `exportMuseum(): Promise<Blob>`, `importMuseum(file, replaceConfirmed): Promise<void>`.

Example: illustration + perfection + five minutes + unit “the bird’s wing” produces “Draw one intentionally rough wing variation,” output “one labeled rough variation,” stop “one variation exists; do not polish.” Each template has three budget-specific variants; all 36 combinations receive unit tests. User edits remain bounded by field limits.

Backup envelope: `{format:"almost", version:1, exportedAt, exhibits:[], cards:[], progress:[], images:[{id,mime,base64}]}`. Validate a maximum 20 MiB file, record counts, unique IDs, references, enum values, and decoded image limits before the replacement transaction. Return typed errors: `INVALID_INPUT`, `INVALID_BACKUP`, `UNSUPPORTED_VERSION`, `STORAGE_FULL`, `STORAGE_UNAVAILABLE`.

## 10. Risks, open questions, and mitigations

**Generic cards:** Require a smallest unit, allow editing, and test three different projects. **Decorative productivity:** Require concrete progress, not a celebration button. **Shame:** No “overdue,” rankings, or inactivity judgments; retiring is legitimate.

**Data loss:** Explain eviction/profile/origin risks and backups. **Scope creep:** Cut P1, not durability or accessibility. **Evidence gaps:** Capture before initialization; retain the complete visible transcript and checkpoint references, not just a montage.

Nonblocking questions: Which personal project may appear publicly? Default to fictional original samples. Is the tone too sentimental? Default to restrained editorial styling. Makers or artists first? Default to both, using four domains.

## 11. Success metrics and a demo script

MVP gate: all P0 tests pass; no external runtime calls; add/restart/progress/restore works in one take. In five informal user trials, target four people creating an exhibit within two minutes and four rating the restart card actionable. Track these manually; do not add telemetry. Later value metric: voluntary return with real progress within seven days, not an obligation or MVP claim.

**Judge walkthrough, total 4:45:**

1. **0:00–0:45 — R1, R2, R6, R7, R8:** Open Built here and the PRD: eight scored candidates, five dimensions, one selected product, freely chosen stack, and all thirteen sections.
2. **0:45–1:15 — R3, R4, R5:** Show the fresh workspace initialization in the Studio session capture, then ideation, implementation, test, and publishing checkpoints. Link the complete visible capture/transcript; summaries alone do not prove the whole journey.
3. **1:15–2:05 — R9; F01–F03:** Add “Bird zine,” upload an original sample sketch, enter “three rough pages,” unit “the bird’s wing,” and perfection blocker. Generate the five-minute card and read its stopping condition.
4. **2:05–2:45 — F04–F05:** Add “Drew one rough wing variation” and an updated image. Compare before/after, observe “Moved again,” reload, then retire and reopen it. This is a compressed workflow demonstration, not proof of five minutes of work.
5. **2:45–3:45 — F06:** Export, clear, and restore. Verify the exhibit and note survive; attempt an invalid backup and show unchanged data.
6. **3:45–4:45 — F07–F08 and quality gates:** Toggle labeled samples, inspect the network panel for no artifact uploads, navigate the drawer by keyboard, and show the passing test summary.

## 12. Milestones and build plan

1. **0:00–0:30:** Begin visible session capture; save this ideation table; initialize the fresh project; record dependency setup and first checkpoint.
2. **0:30–1:30:** Implement Zod schemas, Dexie stores, transactions, raster limits, backup validation, and service tests.
3. **1:30–2:30:** Build museum grid, empty state, capture form, drawer, and local persistence. Verify reload and storage-error behavior.
4. **2:30–3:30:** Author twelve templates with three budget variants; test 36 combinations; implement editable card saving.
5. **3:30–4:30:** Implement progress history, image comparison, retirement/reopening, deletion, and backup UI.
6. **4:30–5:30:** Add three original sample artifacts, responsive styling, keyboard handling, reduced motion, and Built here evidence links.
7. **5:30–6:30:** Run Playwright happy path and invalid-backup/upload cases; test network independence after load; publish and verify backup migration.
8. **6:30–8:00:** Rehearse the judge walkthrough, fix defects, and retain the complete process evidence. Only then attempt F09.

**MVP cut line:** Steps 1–7 plus a successful walkthrough; every P0 stays. If behind, remove animation embellishments and P1, not persistence, validation, or visible process evidence. A coding agent receives these tasks in order and must checkpoint after each milestone.

## 13. Promo-video hooks

- A folder of abandoned sketches becomes a warmly framed gallery labeled “Still yours.”
- “I only have five minutes” produces one precise restart card instead of an overwhelming task list.
- A rough wing sketch appears beside its earlier version; the exhibit light changes as “Moved again” appears.
- “Keep as a memory” releases a project gently, without a red failure state.
- A rapid Studio timeline shows the scored ideation table, empty project, first functional frame, passing tests, and finished museum.

### References

[1]: https://wip.co/ "WIP: makers shipping together"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria "MDN: storage quotas and eviction criteria"

## Appendix A: UI Design System (user directive)

Style: clean, minimal, black and white, shadcn/ui look and feel, with **no borders**.

- **Palette:** pure black `#000000`, white `#FFFFFF`, and a neutral grey ramp (`#FAFAFA`, `#F4F4F5`, `#E4E4E7`, `#71717A`, `#18181B`) for surfaces and text. No accent colour. State is conveyed by weight, fill inversion (black on white or white on black), icons and labels, never by hue alone.
- **No borders:** no `border`, `outline` or divider lines on cards, inputs, buttons, tables or panels. Separate elements with whitespace, a subtle surface tone (`#F4F4F5` on white) and, when elevation is needed, a very soft shadow. Focus rings are replaced by a 2px offset shadow-ring in `#18181B`, which keeps keyboard focus visible and accessible.
- **Components:** shadcn/ui primitives (Button, Input, Card, Dialog, Tabs, Sheet, Tooltip, Badge, Switch, Toast) with Tailwind and Radix, restyled with border-width 0. Radius 10px (`--radius: 0.625rem`).
- **Typography:** Geist or Inter, 14px base, tight tracking on headings, two weights (400 and 600).
- **Motion:** 150ms ease-out opacity and translate only. Respect `prefers-reduced-motion`.
- **Dark mode:** an inverted pair (`#000` background, `#FAFAFA` text) with the same no-border rule.
- **Accessibility:** contrast of at least 7:1 for body text. Because borders are absent, every interactive control needs a distinct filled surface or a visible hover and focus state. Verify this in the demo checklist.

## Appendix B: Scaffold (Better-T-Stack, one scaffold per project)

Run `scaffold/07-almost.sh` from a workspace folder outside this repo. It creates `almost/` as its own independent project and git repo, using the same Better-T-Stack command as every other product (user directive: same stack for consistency, never one mega scaffold). The command was validated against the live CLI on 2026-11-21. **Where this appendix conflicts with Section 8, this appendix wins.** Bun is the package manager and runtime throughout: `bun install`, `bun run`, `bunx`, and `bun test` for unit tests (replacing any npm, pnpm, npx or Vitest reference elsewhere in this PRD; Playwright stays for browser end-to-end tests).

Next.js is the whole MVP (browser-local IndexedDB); the PRD's Vite is replaced. This is the product where the full stack pays off as stretch: Better Auth + MongoDB/Mongoose for cloud sync of the museum, native-uniwind for a mobile capture companion, Polar for an optional paid tier, fumadocs for the public docs. Keep these out of the MVP cut line.
