# Issue 77 builder verification

Builder branch: `sidekick/77-sidepanel-manifest`. Base: wave-1 main `3da907c`.
All evidence is sanitized. This registers the panel only; the full panel shell,
optional-origin prompts, snapshots, and orchestration belong to later issues.

## Commands and final results

Run from `products/sidekick` with `export PATH=$HOME/.bun/bin:$PATH`:

| Command | Exit | Evidence |
| --- | --- | --- |
| `bun install --frozen-lockfile` | 0 | `install.log` |
| `bun run fix` | 0 | `bun-run-fix.log` |
| `bun run build:extension` | 0 | `bun-run-build-extension.log` |
| `bun test apps/extension/tests/manifest.test.ts` | 0 | `bun-test-apps-extension-tests-manifest.test.ts.log` |
| `bun run typecheck` | 0 | `bun-run-typecheck.log` |
| `bun test` | 0 | `bun-test.log` |
| `bun run check` | 0 | `bun-run-check.log` |
| `SIDEKICK_PROXY_URL=https://proxy.example.com/v1 bun run build:extension` | 0 | `https-proxy-build.log`, `manifest-https.json` |
| `SIDEKICK_PROXY_URL=https://proxy.example.com/v1 bun test apps/extension/tests/manifest.test.ts` | 0 | `https-proxy-build.log` |
| `git diff --check` | 0 | Run before commit |

Both test commands pass **8 tests, 0 failures, 48 assertions**. The default dev
build was restored after the configurable HTTPS-origin check. `manifest-dev.json`
and `manifest-https.json` capture both generated permission sets. The HTTPS
example is a build-config check, not a claim that this example endpoint is hosted.

## Headed Chromium and real toolbar interaction

Browser: `/usr/bin/chromium`, Chromium `156.0.8078.73` on Ubuntu. The extension was
loaded from `/home/ubuntu/wt/77/products/sidekick/apps/extension/.output/chrome-mv3`
using a Playwright persistent context with `headless: false`, `--load-extension`,
and `--disable-extensions-except`. Playwright was installed only in the external
verification directory, not added to the product dependencies.

Harness: `/home/ubuntu/verify/77-builder/chromium-check.mjs`. Final command:

```sh
cd /home/ubuntu/verify/77-builder
AUTO_TOOLBAR_CLICK=1 CHECK_RUN=3 xvfb-run -a -s "-screen 0 1440x1000x24" \
  node chromium-check.mjs
```

Exit **0**. A fresh profile must be used for each automated pin sequence (choose a
new `CHECK_RUN` value); the harness accepts `SIDEKICK_EXTENSION_DIR` for a different
worktree. The first run used external real xdotool commands on its Xvfb display;
the final run reproduced those same real mouse events inside the harness:

```sh
xdotool mousemove 1327 62 click 1  # open real extensions menu
xdotool mousemove 1257 204 click 1 # pin Sidekick
xdotool mousemove 980 110 click 1  # close menu
xdotool mousemove 1293 62 click 1  # click real Sidekick toolbar action
```

The panel **really opened** beside Wikipedia, not only as an extension tab.
`chrome.runtime.getContexts` reported `SIDE_PANEL` at
`chrome-extension://lppgoeipaphlbajgheoabiadmanoofab/sidepanel.html`.
`chrome.sidePanel.getOptions({})` returned `{enabled:true,path:"sidepanel.html"}`;
`getPanelBehavior()` returned `{openPanelOnActionClick:true}`. The extension was
`ENABLED` with empty manifest and runtime error arrays, both before and after the
real-toolbar check. `chromium-check.log`, `first-chromium-check.log`, and
`result.json` record these facts.

Screenshots were saved in `/home/ubuntu/verify/77-builder/` and copied here:

- `real-toolbar-sidepanel.png`: the real Side Panel open next to Wikipedia.
- `pinned-toolbar.png`: pinned action before the click, with the panel closed.
- `sidepanel-as-tab.png`: `sidepanel.html` rendered as the requested extension tab.
- `extensions-empty-errors.png`: unpacked extension present with Developer mode on.
- `extension-error-view.png`: empty `chrome://extensions/?errors=<id>` view.
- `final-empty-error-view.png`: error view still empty after the mouse interaction.

## Important Chrome permission finding

Neither demo origin was present in `chrome.permissions.getAll().origins`; only the
configured localhost proxy origin was granted. On this Chromium 156 build,
`setPanelBehavior({openPanelOnActionClick:true})` opening the panel did **not**
provide usable `activeTab` access to Wikipedia. A verification-only attempt to
execute the packaged script with `frameIds:[0]`, `world:"ISOLATED"` was denied
because site access was missing. This denial is recorded, not counted as a
successful content injection. The manifest and descriptor tests prove packaging
and explicit top-frame/isolated targeting. Later visible-panel dispatch must
request the optional origin through a user gesture before injection; no broad
permissions were added to bypass that requirement.

## Minimal baseline tooling repair

Untouched wave-1 main already failed `bun run check` (exit 1):
`nursery.useTailwindSortedClasses` was unknown to pinned Biome 2.5.15. See
`main-baseline-check.log` and the builder's issue comment. This PR renames it to
`useSortedClasses`, excludes generated `.output`/`.wxt`, and applies the required
formatter to the workspace manifests and the existing server export (format/key
order only; no server feature change). Explicit WXT imports avoid new lint global
exceptions. The unused scaffold popup and logos are removed, not polished.

No PRD feature ambiguity was expanded into extra work. Proxy deployment and real
HTTPS connectivity are owned by #78. Real OpenRouter API calls: **not run: no
key**. Windows/macOS Chrome and older Chrome versions were not tested.
