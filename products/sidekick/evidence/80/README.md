# Issue #80 — borderless panel shell

The panel contains selected-tab metadata, labelled task/token inputs, an always-visible OpenRouter/model-provider retention disclosure, a Radix acknowledgement checkbox, and idle Plan/Run/Timeline/Stop regions. #81's PageObserver remains wired in. Run and Stop intentionally remain disabled until subsequent control-loop issues implement them; this issue dispatches no model requests.

## Automated verification

Run from `products/sidekick`, with Bun 1.4.5:

```sh
bun install --frozen-lockfile
export WXT_SIDEKICK_PROXY_URL=https://sidekick-proxy.example.com
bun run build:extension
bun run typecheck
bun run check
bun test apps/extension/src/panel/config.test.ts
bun test
xvfb-run -a -s '-screen 0 1440x1000x24' node evidence/80/browser.mjs
```

The HTTPS URL is a non-secret example build origin, not a deployed service. Keep it set for tests: the existing manifest test reads `.output/chrome-mv3` and compares its host permission with the current configuration. An initial test attempt without the matching environment correctly failed that assertion; the configured rerun passed, without any test changes.

| Command | Exit | Result |
| --- | ---: | --- |
| `bun install --frozen-lockfile` (before setting the public URL) | 0 | No private environment required |
| `bun run build:extension` | 0 | Production MV3 extension built |
| `bun run typecheck` | 0 | Server and extension |
| `bun run check` | 0 | 44 files checked |
| `bun test apps/extension/src/panel/config.test.ts` | 0 | 22 passed; 0 failed; 64 assertions |
| `bun test` | 0 | 165 passed; 0 failed; 751 assertions across 6 files |
| Headed Chromium harness above | 0 | Real toolbar open/close/reopen and panel checks |

Logs are saved alongside this file. The browser harness uses the existing extension-workspace Playwright dependency, `/usr/bin/chromium`, `xdotool`, and `ffmpeg`. It uses a fresh temporary Chromium profile and an ordinary local HTTP page with non-sensitive fixture content. Toolbar pin/open and panel close/reopen are real mouse clicks; panel controls are operated with keyboard events.

## Browser acceptance evidence

- [320px disclosure and focused token input](panel-320-disclosure-focused-input.png) and [320px focused task](panel-320-task-focused.png): six enabled controls are reached with Tab and Shift+Tab, including #81's Observe page. Focus is visible and controls scroll into view at an 800px viewport height. The 320px viewport has a 305px content width after the vertical scrollbar; no horizontal overflow.
- [Desktop panel](panel-desktop-720.png): 720px viewport, content width at most 720px (the vertical scrollbar occupies 15px). [Real Chromium window](real-sidepanel-desktop.png) shows this is an actual Chrome Side Panel, not a mock page.
- [Computed styles and contrast](computed-styles.json): every visible element has zero border/outline widths; no animation/transition; Inter at 14px and weights 400/600; interactive/surface radii 10px; all colors monochrome; minimum measured text contrast **8.230890190480576:1**. Keyboard focus uses an offset white/black box-shadow ring.
- [Keyboard, accessible names, and storage](keyboard-and-storage.json): every checkbox/textbox/button has an accessible name; only `sidekickDemoToken` is in `chrome.storage.session`, represented as `[REDACTED]`; local/sync and page Web Storage are empty. A dummy task is typed before storage inspection.
- [Close/reopen and clear-token results](reopening.json): closing with Chrome's panel close button destroys the panel document. Reopening via the toolbar restores the session-token status, but clears task, token draft, and disclosure acknowledgement; model readiness is false. Keyboard activation of Clear token removes the session entry. [Reopened panel after clearing](reopened-panel-token-cleared.png).
- [Browser result](browser-result.json): no extension manifest/runtime errors, no observed page errors, and **zero model requests**.

## Scope and unverified checks

Only the panel shell/configuration/design requirements of #80 are implemented. Page observation implementation is retained from #81 without modification. Model orchestration, working Run/Stop, timeline states, confirmations, and action execution belong to subsequent issues.

Real OpenRouter checks: **not run: no key** (`OPENROUTER_API_KEY` is unavailable).

Authenticated deployed HTTPS smoke: **not run** because a reachable deployment and private `SIDEKICK_DEMO_TOKEN` were not supplied. The separate `bun run test:https` hosting gate is owned by #78 and was not changed or included in `bun test`.

Configured-secret comparison: an additional `bun run verify:secrets` attempt exited 1 with `Secret scan requires SIDEKICK_DEMO_TOKEN supplied privately`; it is **unverified**, not passed. No private token/key was fabricated. Browser/unit fixtures use only `test-token-not-secret`, and captured session storage is redacted.
