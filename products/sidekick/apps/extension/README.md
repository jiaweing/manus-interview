# Sidekick extension

From `products/sidekick`, run `bun install --frozen-lockfile` and
`bun run build:extension`. Load `apps/extension/.output/chrome-mv3` unpacked at
`chrome://extensions` with Developer mode enabled (Chrome 116 or later). Pin
Sidekick in the toolbar, then click **Open Sidekick** to open the Side Panel.
The worker only configures that toolbar behavior; it does not run browser tasks.

## Proxy and site access

`SIDEKICK_PROXY_URL` is a build-time configuration value, read by WXT. It defaults
to `http://localhost:8787` for local development. Configure the published HTTPS
proxy before building, for example:

```sh
SIDEKICK_PROXY_URL=https://proxy.example.com bun run build:extension
```

You can also set it in `apps/extension/.env.local`. Rebuild and reload the
extension after changing it. Only that URL's origin is added to required
`host_permissions`. Remote HTTP, embedded credentials, and wildcard hosts are
rejected. Chrome host match patterns are origin-scoped, not path-scoped; Chrome
also ignores port restrictions for permission matching.

The only optional demo origins are `https://en.wikipedia.org/*` and
`https://httpbin.org/*`. They are not silently granted on install. The visible
panel must request any needed optional origin in a user gesture, or check for a
usable temporary `activeTab` grant. Do not assume opening the Side Panel grants
`activeTab`: in the Chromium 156 check, Wikipedia injection was denied after the
toolbar opener, so an explicit optional-origin prompt is needed before dispatch.
No `<all_urls>` access exists.
The packaged content script is not auto-injected. Panel dispatch can pass
`contentScriptInjection(tabId)` to `browser.scripting.executeScript` after
checking access; its target is frame 0 and its execution world is `ISOLATED`.

This issue registers the panel only. Task controls, permission prompts, snapshots,
and browser-action orchestration are implemented in their respective later issues.

## Manifest checks

```sh
bun run build:extension
bun test apps/extension/tests/manifest.test.ts
```

The test validates the generated production manifest and packaged entrypoints.
It builds the extension if the generated manifest does not exist yet.
