# Sidekick — Chrome Agent PRD

Builder: Jia Wei Ng. Delivery: one Manus Studio session, approximately 8–12 focused hours. Release: unpacked extension plus model proxy; stretch goals are excluded from the demo commitment.

## 1. Overview (one-paragraph pitch, product name suggestion, target user)

**Sidekick** turns natural-language requests into visible, supervised browser actions beside the current page. It reads relevant content, finds indexed controls, clicks links, scrolls, fills ordinary forms, and manages tabs, then reports evidence rather than simply claiming completion. Target users are researchers and operations workers doing repetitive, low-stakes web tasks. The MVP prioritizes transparency and two reliable real-site workflows over universal autonomy.

## 2. Problem statement and the original brief

Chatbots explain websites without doing the work; blind automation acts without revealing intent. Build a native Chrome companion bridging understanding and execution while leaving consequential decisions with the user. Track mandatory outcomes and named technical considerations below; a consideration requires an explicit decision, not necessarily adoption.

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

Ship Wikipedia research with a reference tab, and form preparation on `https://httpbin.org/forms/post`. Support three consecutive browser mutations without manual target selection. Make execution and final evidence judge-visible.

Exclude arbitrary-site guarantees, purchases, messaging, account changes, CAPTCHA bypass, authentication, uploads/downloads, background runs, and Web Store approval. Cross-origin frames, closed shadow roots, canvas controls, PDF viewers, and trusted-event-only widgets are unsupported. Never execute arbitrary model-generated JavaScript.

## 4. Target users and key user stories (with acceptance criteria)

**U1 — Researcher:** “Find Ada Lovelace’s published work, scroll to the relevant section, and open a reference.” Acceptance: read the live article; show a matching passage; execute three actions; link the verified reference tab.

**U2 — Operations worker:** “Fill this example form, then ask before submitting.” Acceptance: three fields visibly match supplied values; submission requires specific confirmation; rejection leaves it unsubmitted.

**U3 — Cautious user:** “Let me inspect and interrupt automation.” Acceptance: each action has preview/status; Stop prevents later dispatches; unsupported or unverifiable outcomes never appear as success.

## 5. Core user flows (step-by-step, include edge cases)

**Research:** (1) Click the toolbar icon to open the panel. (2) Accept disclosure that relevant page text leaves the browser. (3) Enter a task. (4) Capture the active tab, permitted metadata, relevant text, and indexed elements. (5) Review an editable plan and click Run. (6) Preview, execute, observe, and replan one tool at a time. (7) Open a validated reference; request origin access before reading a new site. (8) Show verified passage/tab evidence.

**Form:** (1) Open the public form and provide dummy values. (2) Review planned fields. (3) Fill using native value setters and input/change events. (4) Verify values locally. (5) Separately confirm destination, submit button, and outbound fields. (6) Approve or cancel. (7) Inspect the response; missing receipt means Unverified.

**Recovery:** Stale indexes trigger re-observation, never guessed clicks. Missing origin access pauses behind Allow this site. Closing the target ends the run. Unexpected user tab switching pauses; agent-driven switching is tracked separately. Stop aborts model requests and prevents later actions, but cannot undo a dispatched click. Reopening the panel shows an interrupted checkpoint and requires restart without replaying mutations.

## 6. Functional requirements (prioritized P0/P1/P2, each with ID)

**P0-F1 — Panel/context:** Prompt, target-tab chip, connectivity, consent, plan, and Run. Capture current-window tab IDs/titles/origins; send only selected tab metadata. Covers R1–R3, R9–R10, R14.

**P0-F2 — Observation:** Inject a packaged isolated-world content script. Return relevant rendered text and indexed links, buttons, inputs, selects, headings, and labels, with visibility, enabled state, bounding boxes, and snapshot identity. Covers R4, R11–R13.

**P0-F3 — Execution:** Bounded observation, tool call, validation, preview, execution, and re-observation. Support read/find, scroll, click, fill/select, and open/switch/close tab. One action per model turn. Covers R5, R15–R16.

**P0-F4 — Control:** Timeline: Planned, Awaiting approval, Running, Observed, Failed, Skipped. Show target outline and cancellable 800-ms preview before mutations. Keep Stop sticky. Covers R6–R7, R17–R19.

**P0-F5 — Safety:** Deterministic checks precede execution. Auto-allow reads, scrolling, validated navigation links, ordinary fills, and requested tab opening/switching. Confirm submits, unknown buttons, cross-origin navigation, and tab closure. Block password/payment/file/hidden-field editing, non-HTTP(S) destinations, and forbidden tasks. Covers R17, R21.

**P0-F6 — Completion:** Fresh observations must satisfy structured predicates. Show Success, Partial, Failed, Stopped, or Unverified with passage, field-check result, destination, or receipt. Covers R8, R20.

**P1-F7 — Stretch:** Same-origin iframe/open-shadow traversal, local templates, sanitized trace export, and consented additional-tab reading.

**P2-F8 — Stretch:** Screenshot grounding and optional debugger-based trusted input behind a separate permission explanation. Neither changes MVP scope.

## 7. Non-functional requirements (latency, reliability, privacy/security, performance, accessibility as relevant)

Targets: panel opens within one second; local observation/action under 500 ms at p95; model turn under eight seconds at p95. Cap runs at 15 model turns and 120 active seconds, excluding approval waits. Navigation/model deadlines: ten/twenty seconds. Stop acknowledgment: under 250 ms; no later tool dispatch.

Cap snapshots at 20,000 characters and 300 controls; mark truncation and allow targeted text search. Avoid full-DOM serialization and continuous scanning. Retry reads once; never replay uncertain mutations. Require eight successful runs out of ten across designated workflows and zero unapproved submissions in safety tests.

Exclude cookies, storage, passwords, hidden DOM, and existing sensitive field values from model payloads. Verify filled values locally. Keep credentials server-side; disable content telemetry and proxy body logging. Use session-only checkpoints, Clear session, TLS, proxy authentication/rate limits, and bundled executable code. Disclose provider retention.

Panel controls must be keyboard reachable, labelled, and usable at 320-pixel width. Use polite live announcements and text statuses; respect reduced-motion preferences.

## 8. Proposed architecture and tech stack (include an ASCII or mermaid diagram, key technical decisions with rationale, and rejected alternatives)

Use **WXT** (the "Next-gen Web Extension Framework", wxt.dev; confirmed by the `wxt` addon in the user's Better-T-Stack command) with TypeScript, React, Chrome MV3 APIs, Zod, `bun test`, and a Node/Express HTTPS proxy with OpenAI GPT-4.1 mini tool calling.

**Framework decision (WXT):** WXT is Vite-based and file-system-entrypoint driven, so `entrypoints/background.ts`, `entrypoints/sidepanel/` (React), and `entrypoints/content.ts` replace a hand-written build setup. It generates `manifest.json` from config (permissions: `sidePanel`, `tabs`, `activeTab`, `scripting`, `storage`; `side_panel.default_path`), gives dev-mode HMR and auto-reload of the unpacked extension in a managed Chrome instance, provides typed `browser.*` APIs, and builds a store-ready zip with `wxt zip`. Rejected: hand-rolled Vite + CRXJS (more manual manifest and HMR work), Plasmo (heavier, more opinionated). Risk: WXT's side-panel entrypoint conventions must be checked against the current WXT version in the first hour.

```text
User -> React Side Panel [planner, policy, timeline, AbortController]
             | chrome.scripting / chrome.tabs
             v
       Isolated content script <-> live page DOM
             |
       chrome.storage.session [checkpoints]

Side Panel -- authenticated HTTPS --> Node proxy --> LLM
MV3 worker: toolbar setup only; no agent loop
```

Keep orchestration/fetches in the visible panel because MV3 workers may terminate after 30 seconds idle and lose globals.[2] Native panels have Chrome API access; configure toolbar opening with `setPanelBehavior`. Minimum Chrome 116 accommodates gesture-bound `sidePanel.open` if needed.[1]

Use isolated-world `chrome.scripting` with temporary `activeTab` access.[3] Same-origin navigation retains access; chat submission alone does not grant it. New origins need an explicit permission-request button.[4] Request `tabs` for titles/URLs, not because tab creation requires it.[5]

Choose a DOM-derived accessibility-inspired snapshot, not a complete accessibility tree. Keep indexed element references in the content script; revalidate document/target before action. Reject debugger/CDP for MVP: Accessibility/Input domains are available, but attachment and DevTools-triggered detachment add complexity.[6] Reject Playwright/native messaging because controlling the existing browser needs extra setup. Reject screenshot-only control because DOM grounding is cheaper and verifiable.

Deploy the proxy at reachable HTTPS; keep provider keys in backend environment variables. Paste a short-lived server-issued demo bearer token into settings, stored in `storage.session`. Authenticate independently of CORS, allow the configured extension origin, fix provider/model, and cap spend. Studio produces downloadable `dist/`; judges load it unpacked into their Chrome. Localhost is development-only.

## 9. Data model / protocol / API surface (concrete: message schemas, tool signatures, manifest format, etc. as relevant)

The manifest is generated by WXT from `wxt.config.ts`. Substitute the deployed proxy origin through a WXT/Vite env variable at build time; bundle executable assets.

```json
{
  "manifest_version": 3,
  "name": "Sidekick",
  "version": "0.1.0",
  "minimum_chrome_version": "116",
  "permissions": ["sidePanel", "activeTab", "scripting", "storage", "tabs"],
  "host_permissions": ["https://PROXY_HOST/*"],
  "optional_host_permissions": ["https://*/*", "http://*/*"],
  "background": {"service_worker": "worker.js", "type": "module"},
  "action": {"default_title": "Open Sidekick"},
  "side_panel": {"default_path": "sidepanel.html"}
}
```

```typescript
type Snapshot = {
  snapshotId: string; documentToken: string; tabId: number;
  url: string; title: string; text: string; truncated: boolean;
  elements: {index: number; role: string; name: string;
    tag: string; inputType?: string; href?: string;
    visible: boolean; enabled: boolean;
    rect: {x: number; y: number; width: number; height: number}}[];
};
type Action = {
  runId: string; actionId: string; tabId: number;
  snapshotId: string; documentToken: string;
  tool: string; args: Record<string, unknown>; preview: string;
};
type Outcome = {
  actionId: string; ok: boolean; code: string;
  evidence?: {url: string; excerpt?: string; predicatePassed?: boolean};
};
```

Tools: `observe(tabId, query?)`, `findText(query)`, `scroll(direction, pixels)`, `click(index)`, `fill(index, value)`, `select(index, value)`, `openTab(url)`, `switchTab(tabId)`, `closeTab(tabId)`, `finish(predicateIds, summary)`. DOM tools require the Action envelope. Clamp scroll distance, validate URLs, reject unknown tools/arguments. Only the extension executes browser tools.

Authenticated `POST /v1/agent/turn` accepts `{runId, goal, history, snapshot, tools}`; returns `{assistantMessage, toolCall?}`. Preserve provider tool-call IDs and matching results. States: idle → planning → executing ↔ awaitingApproval → verifying → terminal.

Approvals bind action ID, argument hash, origin, document token, and snapshot ID; expire after 60 seconds and invalidate on relevant target changes. Predicates: `textPresent`, `fieldEquals`, `tabExists`, `receiptPresent`. Store values locally; send redacted verification results. A model summary cannot satisfy a predicate.

## 10. Risks, open questions, and mitigations

**Brittleness:** Synthetic input may fail on custom widgets. Verify values, stop on mismatch, and use ordinary top-frame demo controls. Preflight alternate public pages; never substitute fake execution.

**Prompt injection:** Page text is untrusted data, not policy or user authority. Delimit observations; refuse instructions to reveal secrets or redirect tasks. Enforce allowlists, destination checks, sensitive-input blocks, and confirmation outside the LLM. Semantic detection is imperfect; conservative confirmation limits harm without guaranteeing immunity.

**Completion:** Click success is not task success. Require fresh evidence and honest partial/unverified labels. Filling can trigger site autosave before submission; disclose this and demo with dummy data.

**Deployment:** Resolve HTTPS, extension origin, tokens, and unpacked loading first. Expire demo tokens after the event and enforce quotas against leakage.

Questions for Jia Wei: Is unpacked installation acceptable? Can you supply reachable HTTPS hosting and provider budget? Which two tasks matter most? Defaults: unpacked, capped proxy, Wikipedia research, httpbin dummy-form preparation. Store approval is off the critical path.

## 11. Success metrics and a demo script (exactly how a judge would verify each requirement in under 5 minutes)

Preflight outside the timer: load `dist/`, configure token, verify sites/proxy, and open Wikipedia’s search page. Prepare a public page with malicious visible instructions; it supplements real-site execution.

1. **0:00–0:25:** Open toolbar panel; show manifest/source summary: MV3, sidePanel, permissions, indexed content script, no debugger. Show masked token/key-free bundle. Verify R1, R9–R13, R16.
2. **0:25–1:45:** Enter “Find Ada Lovelace, scroll to her published work, read the passage, and open a reference in a new tab.” Inspect plan, tab chip, snapshot, and timeline; run. Verify live search/fill or navigation, click, scroll, reading, tab creation, and fresh evidence. Verify R2–R7, R12, R14–R15, R18.
3. **1:45–3:10:** On httpbin, request three dummy fields filled, then submission. Check fields and destination/data confirmation; reject. No submission occurs. Request scrolling; press Stop during preview; no subsequent action executes. Verify R5, R17, R19.
4. **3:10–4:05:** Request an absent passage; expect unsuccessful/unverified status. Compare successful research evidence with the live page. Verify R8, R20.
5. **4:05–4:45:** Request harmless lookup on the injection page despite instructions to disclose secrets and submit elsewhere. Inspect sanitized observation/policy refusal; no secret or unrelated action occurs. Verify R21. Use remaining seconds to show cancelled form and terminal statuses.

Record action count, runtime, approvals, outcomes, and local redacted evidence. Pass: both workflows meet acceptance, safety checks block unintended mutations, and judging finishes within five minutes.

## 12. Milestones and build plan (ordered tasks that can be handed to a coding agent, with MVP cut line)

1. **Hour 0–1:** Scaffold with the Better-T-Stack scaffold (WXT React template, `apps/extension`) plus the proxy; configure the generated manifest in `wxt.config.ts`; document unpacked install; prove authenticated HTTPS model connectivity.
2. **Hour 1–3:** Build observation/index map and typed executor; manually test live read, click, scroll, fill, and tabs before LLM integration.
3. **Hour 3–5:** Implement single-tool loop, budgets/deadlines, fresh snapshots, navigation recovery, and session checkpoints.
4. **Hour 5–7:** Add plan approval, preview, safety, Stop, timeline, verification. Unit-test stale targets, denied approval, cancellation, malformed calls.
5. **Hour 7–10:** Rehearse sites; test injection/network failure; tune extraction; finish keyboard accessibility/onboarding.
6. **Hour 10–12:** Package artifacts/README; perform ten workflow runs; record timed demo.

**MVP cut line:** All P0 requirements, two real-site flows, stop/confirmation tests, and reachable proxy pass. Cut polish before safety/verification. Attempt P1 only afterward; no P2 during the committed session.

## 13. Promo-video hooks (3-5 shots/moments from this product that would look great in a promo video)

- Plain English becomes a concise plan beside the live browser.
- Search fills, an article opens, and the page scrolls as the timeline advances.
- A reference tab opens; the result quotes the observed passage.
- Three fields fill, then “Approve submission” proves the agent knows when to stop.
- Stop turns the next pending action into Skipped; the browser stays still.

**References**

[1]: https://developer.chrome.com/docs/extensions/reference/api/sidePanel "Chrome Side Panel API"
[2]: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle "Extension service worker lifecycle"
[3]: https://developer.chrome.com/docs/extensions/reference/api/scripting "Chrome Scripting API"
[4]: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab "Chrome activeTab permission"
[5]: https://developer.chrome.com/docs/extensions/reference/api/tabs "Chrome Tabs API"
[6]: https://developer.chrome.com/docs/extensions/reference/api/debugger "Chrome Debugger API"

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

Run `scaffold/04-sidekick.sh` from a workspace folder outside this repo. It creates `sidekick/` as its own independent project and git repo, using the same Better-T-Stack command as every other product (user directive: same stack for consistency, never one mega scaffold). The command was validated against the live CLI on 2026-11-21. **Where this appendix conflicts with Section 8, this appendix wins.** Bun is the package manager and runtime throughout: `bun install`, `bun run`, `bunx`, and `bun test` for unit tests (replacing any npm, pnpm, npx or Vitest reference elsewhere in this PRD; Playwright stays for browser end-to-end tests).

`apps/extension` is the WXT project (React template). The scaffold ships popup, background and content entrypoints only, so `entrypoints/sidepanel/` and the `sidePanel` permission are hand-added in hour one. `apps/server` Hono replaces the PRD's Express proxy, with Better Auth + MongoDB issuing per-user tokens so the proxy is not an open relay. `apps/web` is landing/sign-in/options. The generated `ai` example uses Vercel AI SDK with Google Gemini; the PRD named OpenAI GPT-4.1 mini, so the provider is an open decision (a one-line swap). Dormant: Polar, native-uniwind.
