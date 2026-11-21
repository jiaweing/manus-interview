# Sidekick extension

From `products/sidekick`, export the public `WXT_SIDEKICK_PROXY_URL` origin
described below, then run `bun install --frozen-lockfile` and
`bun run build:extension`. Load `apps/extension/.output/chrome-mv3` unpacked at
`chrome://extensions` with Developer mode enabled (Chrome 116 or later). Pin
Sidekick in the toolbar, then click **Open Sidekick** to open the Side Panel.
The worker only configures that toolbar behavior; it does not run browser tasks.

## Proxy and site access

`WXT_SIDEKICK_PROXY_URL` is the only public build-time configuration value read by
WXT. It must match the server's `SIDEKICK_PROXY_URL`, but the extension does not
read the server's root `.env`. Development permits `http://localhost:8787`;
production requires an explicit HTTPS origin, including during WXT preparation.
Configure the published HTTPS proxy before installation and building, for example:

```sh
export WXT_SIDEKICK_PROXY_URL=https://proxy.example.com
bun install --frozen-lockfile
bun run build:extension
```

You can also set this public origin in `apps/extension/.env`. Never put tokens or
provider keys in extension environment files. Rebuild and reload the extension
after changing it. The shared validator in `packages/config/src/proxy-url.ts`
supplies both the manifest's single required proxy `host_permissions` entry and
the existing client helper in `src/proxy.ts`. Paths, queries, fragments, remote
HTTP, embedded credentials, and wildcard hosts are rejected. Chrome host match
patterns are origin-scoped, not path-scoped; Chrome also ignores port restrictions
for permission matching.

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
