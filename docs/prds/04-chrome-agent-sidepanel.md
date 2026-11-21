# Sidekick — Chrome Agent PRD

Builder: Jia Wei Ng. Delivery: 5.5 focused hours. Release: unpacked WXT extension and authenticated Hono proxy.

## 1. Overview (one-paragraph pitch, product name suggestion, target user)

**Sidekick** accepts natural-language tasks in a Chrome Side Panel and performs supervised browser actions. Researchers and operations workers can read, find, scroll, click, fill ordinary forms, and open/switch tabs while seeing intent, execution, and verified results. Delivery covers two real-site tasks, not universal autonomy.

## 2. Problem statement and the original brief

Bridge website understanding and execution without hiding automation. Preserve the brief’s checklist; technical considerations require decisions, not adoption of every technology.

- [ ] **R1:** Deliver a working Chrome extension.
- [ ] **R2:** Accept natural-language tasks inside the Side Panel.
- [ ] **R3:** Understand the current page and relevant browser state.
- [ ] **R4:** Read necessary information from the current page.
- [ ] **R5:** Complete several consecutive actions on real webpages: finding content, scrolling, clicking, filling forms, or managing tabs.
- [ ] **R6:** Show what the agent is about to do.
- [ ] **R7:** Show what it is currently doing.
- [ ] **R8:** Explain whether the task ultimately succeeded.
- [ ] **R9:** Account for Manifest V3.
- [ ] **R10:** Use `chrome.sidePanel`.
- [ ] **R11:** Account for content scripts.
- [ ] **R12:** Provide an accessibility-tree/DOM snapshot with element indexes.
- [ ] **R13:** Decide how `chrome.scripting` and `chrome.debugger` are used.
- [ ] **R14:** Account for tab management.
- [ ] **R15:** Implement an LLM tool-calling loop.
- [ ] **R16:** Decide where the LLM key/proxy lives.
- [ ] **R17:** Preview and confirm risky actions.
- [ ] **R18:** Provide a step timeline.
- [ ] **R19:** Provide a stop button.
- [ ] **R20:** Verify success.
- [ ] **R21:** Address safety, particularly page prompt injection.

## 3. Goals and non-goals

Demonstrate Wikipedia research with a reference tab and dummy-form preparation at `https://httpbin.org/forms/post`. Complete three consecutive actions without manual target selection; make progress and evidence visible.

**Explicitly out of scope:** arbitrary-site guarantees, workflow libraries, checkpoints/history/export, accounts/Better Auth, databases, payments, analytics/dashboards, web pages, extra providers/platforms, screenshot/debugger control, templates, animations, background runs, uploads/downloads, messaging, authentication, CAPTCHA bypass, and Web Store submission. Support ordinary top-frame DOM controls only; no iframe, shadow-root, canvas, or PDF control.

## 4. Target users and key user stories (with acceptance criteria)

**U1 — Researcher:** “Find Ada Lovelace’s published work, scroll there, and open a reference.” Acceptance: consecutive actions, live passage evidence, and verified reference tab.

**U2 — Operations worker:** “Fill three example fields, then ask before submitting.” Acceptance: dummy values match locally; confirmation names destination and outbound fields; rejection prevents submission.

**U3 — Cautious user:** “Show your steps and let me stop.” Acceptance: about-to-do, doing, and success/failure per action; Stop prevents later dispatches; uncertain completion is Unverified.

## 5. Core user flows (step-by-step, include edge cases)

**Research:** Open panel → disclose provider-bound page text → enter task → observe selected tab/indexed elements → show plan and Run → preview/execute/re-observe one action at a time → open/switch reference → show evidence.

**Form:** Supply dummy values on httpbin → fill three fields → verify locally → preview submission → approve/reject → verify response if approved; missing evidence means Unverified.

**Recovery:** Re-observe stale indexes; never guess. Missing origin access pauses for permission. Closed targets or unexpected user tab switches stop execution. Network failure never replays mutations. Panel closure interrupts; reopening starts fresh. Stop cannot undo dispatched actions.

## 6. Functional requirements (prioritized P0/P1/P2, each with ID)

All retained requirements are P0; no P1/P2 work.

- **P0-F1 — Panel/context:** Input, selected-tab label, token configuration, disclosure, plan, Run, timeline, Stop. Observe selected-tab metadata only. Covers R1–R3, R9–R10, R14.
- **P0-F2 — Observation:** Packaged content script returns rendered text and indexed visible/enabled controls, headings, and labels with snapshot/document identity. Covers R4, R11–R13.
- **P0-F3 — Tools:** Read/find, scroll, click, fill, open/switch tab; one validated action per turn, then fresh observation. Covers R5, R15–R16.
- **P0-F4 — Control:** About to do, Doing, Success/Failure, Awaiting confirmation, Stopped. Stop remains available; no timed animation or editable-plan UI. Covers R6–R7, R17–R19.
- **P0-F5 — Safety:** Confirm consequential submissions or actions with unclear consequences. Routine navigation, reads, scrolling, ordinary fills, and requested tab operations need no confirmation. Block password/payment/file/hidden-field editing, non-HTTP(S) URLs, and model-generated JavaScript. Covers R17, R21.
- **P0-F6 — Completion:** Fresh evidence establishes Success; otherwise explain Failed, Stopped, or Unverified. Covers R8, R20.

## 7. Non-functional requirements (latency, reliability, privacy/security, performance, accessibility as relevant)

Bound runs to 15 turns/120 active seconds, excluding approvals. Model deadline: 20 seconds. Stop aborts requests and invalidates queued actions. Cap snapshots at 20,000 characters/300 controls; mark truncation and allow targeted search. Retry reads once, never uncertain mutations.

Exclude cookies, storage, passwords, hidden DOM, and existing sensitive values from payloads. Verify fills locally. Keep provider keys server-side; disable body logging. Require HTTPS, token authentication, and request limits. Runs are memory-only. Disclose provider retention before real-data use. Controls must be labelled, keyboard reachable, and usable at 320-pixel width.

## 8. Proposed architecture and tech stack (include an ASCII or mermaid diagram, key technical decisions with rationale, and rejected alternatives)

Use Better-T-Stack with **Bun**, TypeScript, React, **WXT**, Zod, `bun test`, and **Hono**. Use **OpenRouter** only (`OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in `.env`, default candidate `anthropic/claude-sonnet-5.5`); fix one model server-side, without a provider picker.

```text
React Side Panel: loop, policy, timeline, Stop
    | chrome.scripting / chrome.tabs
    v
Packaged content script <-> page DOM
Side Panel -- HTTPS + static token --> Hono --> OpenRouter
MV3 worker: toolbar/panel setup only
```

Add WXT’s sidepanel entrypoint and generated MV3 manifest. Orchestrate in the visible panel; no background continuation. Use isolated `chrome.scripting` execution and a DOM-derived, accessibility-inspired indexed snapshot. Reject debugger, screenshot grounding, and native messaging.

Permissions: `sidePanel`, `activeTab`, `scripting`, `tabs`, `storage`; store only the demo token in session storage. Configure proxy access and user-granted demo-site access. Validate document/element identity before execution. Hono checks a server-configured static bearer token and request limits independently of CORS. No account service.

## 9. Data model / protocol / API surface (concrete: message schemas, tool signatures, manifest format, etc. as relevant)

```typescript
type Snapshot = {
  snapshotId: string; documentToken: string; tabId: number;
  url: string; title: string; text: string; truncated: boolean;
  elements: {index: number; role: string; name: string;
    inputType?: string; href?: string; enabled: boolean}[];
};
type Action = {
  runId: string; actionId: string; tabId: number;
  snapshotId: string; documentToken: string;
  tool: string; args: Record<string, unknown>; preview: string;
};
```

Tools: `observe(tabId, query?)`, `findText(query)`, `scroll(direction, pixels)`, `click(index)`, `fill(index, value)`, `openTab(url)`, `switchTab(tabId)`, `finish(summary)`. Validate arguments/destinations and clamp scrolling; only the extension executes tools.

Authenticated `POST /v1/agent/turn`: goal, current-run messages/tool results, snapshot → assistant text and at most one tool call. Preserve matching tool-call IDs. Approvals bind arguments, origin, and document/snapshot identity; target changes invalidate approval. Verify text presence, local field equality, tab destination, or submission response; send redacted check results, not sensitive values.

## 10. Risks, open questions, and mitigations

Sites/controls may change: preflight both tasks, verify each action, and stop on mismatch. Fills can trigger autosave; use dummy data.

Treat page text as untrusted data: delimit observations, reject instructions changing the user’s goal or requesting secrets, and enforce checks outside the model. These simple rules do not guarantee prompt-injection immunity.

Questions: Is unpacked installation acceptable? Can reachable HTTPS hosting and an OpenRouter key/budget be supplied? Defaults: unpacked and the two named tasks. Resolve hosting first.

## 11. Success metrics and a demo script (exactly how a judge would verify each requirement in under 5 minutes)

Preflight installation, token, proxy, and sites outside the timer. Pass: both acceptances, safety tests, and under-five-minute completion; no analytics implementation.

1. **0:00–0:30:** Open panel; show manifest, indexed snapshot, proxy configuration, debugger exclusion. Covers R1, R9–R13, R16.
2. **0:30–2:15:** Enter Wikipedia task. Show plan/statuses; read, click/scroll, open/switch reference; compare evidence with live page. Covers R2–R8, R14–R15, R18, R20.
3. **2:15–3:45:** Fill three httpbin fields; inspect confirmation and reject submission. Start scrolling; press Stop before dispatch; verify no later action. Covers R5, R17, R19.
4. **3:45–4:45:** Show passing tests for stale indexes, malformed tools, network failure, Stop, denied submission, and injected page instructions. Uncertain outcomes must not be Success. Covers R8, R20–R21 without a third task.

## 12. Milestones and build plan (ordered tasks that can be handed to a coding agent, with MVP cut line)

1. **0–0.75 hours:** Scaffold once; add panel/manifest; prove authenticated HTTPS connectivity.
2. **0.75–2 hours:** Build snapshots/index validation; manually exercise tools.
3. **2–3.25 hours:** Connect single-tool loop, budgets, re-observation, failure handling.
4. **3.25–4.5 hours:** Add timeline, confirmation, Stop, evidence checks, safety/error tests.
5. **4.5–5.5 hours:** Rehearse both tasks twice, check keyboard controls, package installation instructions, time demo.

**MVP cut line:** All P0s, both real-site tasks, passing safety/error tests, and reachable proxy. Report unmet acceptance honestly if time slips; never replace safety/evidence with claimed success. No post-cut-line features.

## 13. Promo-video hooks (3-5 shots/moments from this product that would look great in a promo video)

- Plain English becomes visible steps beside the article.
- A reference tab opens with verified passage evidence.
- Fields fill; submission waits for confirmation; Stop prevents the next action.

## Appendix A: UI Design System (user directive)

Clean, minimal, black-and-white shadcn/ui style, **no borders**. Black `#000000`, white `#FFFFFF`, neutral greys only; states use labels, weight, fill inversion.

No borders, outlines, or dividers. Separate controls with whitespace/grey surfaces; use an offset shadow-ring for keyboard focus. Required shadcn/ui/Radix primitives use Tailwind, border-width 0, radius 10px. Geist or Inter, 14px, weights 400/600. Body-text contrast at least 7:1; distinct interactive surfaces. No animation or dark-mode build work.

## Appendix B: Scaffold (Better-T-Stack, one scaffold per project)

Run `scaffold/04-sidekick.sh` outside this repo for independent `sidekick/`: **one scaffold per project**, never a mega scaffold. Preserve Better-T-Stack + Bun: `bun install`, `bun run`, `bunx`, `bun test`.

Use `apps/extension` WXT/React; add `entrypoints/sidepanel/` and permission. Use `apps/server` Hono with static-token authentication and OpenRouter only. Remove unused Better Auth, MongoDB, web pages, Polar, and native-uniwind wiring from the runnable MVP. This appendix governs stack conflicts.
