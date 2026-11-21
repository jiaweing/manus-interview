# Inspiration for Problem 3 (local harness with plugins): Pi, DeepSeek Harness (dsh), Herdr

Verified from public docs fetched on 2026-11-21.

## Pi coding agent (docs.pi.dev/latest/extensions; pi.dev/packages)
- Extensions are TypeScript modules with a factory function receiving an `ExtensionAPI` (`pi`).
- Surface: `pi.on(event, handler)` lifecycle events (startup, resources_discover, session_start, session_shutdown, agent_end, agent_settled, tool_call, input, model events); `pi.registerTool(def)`, `registerCommand`, `registerShortcut`, `registerFlag`, `registerProvider`, `registerMcpServer`, `sendMessage`, `sendUserMessage`, `appendEntry` (persisted custom session entries), `exec`, `getActiveTools/setActiveTools`, `ctx.ui` (confirm dialogs, widgets, status), `ctx.reload()` hot reload.
- Tool definition has `exposure` modes: direct, model-only, codemode, deferred (discoverable via tool_search), hidden; `namespace` grouping; MCP-style `annotations` (readOnlyHint, destructiveHint, idempotentHint, openWorldHint) which a *permission extension* uses in a `tool_call` handler to block or ask for confirmation. Permission policy is itself an extension.
- Distribution: "Pi packages" catalog at pi.dev/packages; community `pi-plugin-manager` TUI to list/search/install/remove/bulk-update. Warning shown: packages execute code, review source.
- Takeaways: tiny core + event hooks; tools/commands/providers all registered by extensions; annotation-driven approval; hot reload; package catalog; session-persisted custom entries.

## DeepSeek Harness, `dsh` (github.com/deepseek-ai/deepseek-harness, docs/architecture.md; MindStudio explainer)
- "Everything is a plugin", built on Cordis. Model adapter, tool registry, session log, even the agent loop are plugins; no privileged core.
- Plugins contribute services (`ctx.tools`, `ctx.llm`, `ctx.sessions`, `ctx.agents`, `ctx.commands`, `ctx.jobs`, `ctx.fs`, `ctx.sandbox`, `ctx.shell`, `ctx.terminals`), typed events, and reversible effects. **Temporal composability:** unloading a plugin automatically undoes every registration it made (tools, event hooks, patches). **Spatial composability:** plugins declare dependencies on services; runtime activates/deactivates them as dependencies appear/disappear.
- Config: boot tree of plugin rows composed from layers: profile -> bundles (distribution unit with a patch file, declared under a `dsh` field in package.json) -> user `cordis.patch.yml` -> home patch -> `--patch` overlays. A patch targets a row by id and replaces config or inserts rows. `dsh --profile web --dump-config` prints the exact tree booted; every row is patchable. Profiles: web, headless, sdk, sdk-minimal, acp.
- Seams: Service Definition + Service Provider + Consumer (e.g. fs/sandbox/terminal/subagent providers swappable without forking).
- Events in 3 domains: durable session events (append-only log; "model-visible means logged"), live agent events (`agent/pre-step`, `agent/request`, waterfall `tools/pre-execute|execute|post-execute`, `agent/turn-stopping`), capability events (`fs/*`, `tools/*`, `telemetry/*`).
- "Where new behavior goes" table maps each goal to one extension point. Plugin Manager package, `dsh plugin` command, marketplace by GitHub topic `dsh-plugin`, Creator mode (agent writes, installs, verifies a new plugin in-session). Safety notice: plugins unsandboxed.
- Takeaways: reversible registrations, service dependency graph, layered patchable config with a dump command, "where new behavior goes" docs, creator mode.

## Herdr (herdr.dev/tui/docs/plugins)
- Plugin = directory with `herdr-plugin.toml` + commands launched as **argv arrays (no shell)**; any language. "There is no separate plugin SDK": the host CLI/socket API *is* the plugin API.
- Manifest: required `id`, `name`, `version`, `min_herdr_version`; optional `description`, `platforms`; `[[build]]` commands, `[[startup]]` one-shot hooks, `[[actions]]` (id, title, contexts, command), `[[events]]` (on = event name, command), `[[panes]]` (placement overlay/popup/split/tab/zoomed), `[[link_handlers]]` (regex -> action). Ids are namespaced `plugin.id.action`. Everything declared statically in the manifest (no runtime registration in v1).
- Runtime contract via env vars: `HERDR_BIN_PATH`, `HERDR_SOCKET_PATH`, `HERDR_PLUGIN_ID`, `HERDR_PLUGIN_ROOT`, `HERDR_PLUGIN_CONFIG_DIR`, `HERDR_PLUGIN_STATE_DIR` (separate from root so updates don't wipe state), `HERDR_PLUGIN_CONTEXT_JSON`, `HERDR_PLUGIN_ACTION_ID`, `HERDR_PLUGIN_EVENT(_JSON)`.
- Lifecycle CLI: `plugin install owner/repo/subdir` (git clone, interactive **preview of source and every command it will run**, build in managed dir, register; `--yes`, `--ref` pin), `update`, `link <path>` (dev), `unlink`, `uninstall`, `list`, `config-dir`, `action list|invoke`, `pane open`, `log list`. Installs are versioned dirs; old install kept so running processes finish.
- Marketplace: auto-index of GitHub repos tagged `herdr-plugin`. Honest trust model: plugin runs as user, host validates manifest but does not sandbox.
- Takeaways: declarative TOML manifest + argv commands + env-injected context; install preview; link for dev; per-plugin config/state dirs; logs; host CLI as the API.

## Synthesis for Patchbay
Combine: Herdr's static manifest + argv process contract + install preview/link/logs + config/state dirs; dsh's reversible registrations, service/dependency declarations, layered patchable config with `dump-config`, and "where new behavior goes" extension-point table; Pi's event hooks (`tool_call` block/confirm with annotation hints), exposure modes (direct/deferred/hidden), hot reload, and permission policy implemented as a plugin itself. Prove "not hard-coded" by shipping the host with *no* built-in tools: even the approval policy and the model adapter are plugins.
