# Patchbay: Local AI Agent Harness

**Builder:** Jia Wei Ng · **Delivery:** eight focused hours for P0; P1 follow-on · **MVP platform:** Linux CLI; small loopback web UI at P1

## 1. Overview

**Patchbay** is a local agent harness with a tiny kernel and everything else supplied by plugins. The host ships with **zero built-in tools**: model access, agent orchestration, and approval policy are independently installed packages. Users preview executable code before trusting it, inspect/configure packages, and hot-enable capabilities without rebuilding or restarting the host.

## 2. Problem statement and the original brief

Agent prototypes entangle orchestration, tools, and privileges. Patchbay makes extension boundaries inspectable and demonstrates that unfamiliar behavior requires no host changes.

The requirement checklist preserves the original brief and adds explicit architectural gates:

- [ ] **R1:** Build a local AI agent harness.
- [ ] **R2:** Support independently packaged plugins.
- [ ] **R3:** Let users install plugins.
- [ ] **R4:** Let users inspect plugins.
- [ ] **R5:** Let users configure plugins.
- [ ] **R6:** Let users enable and disable plugins.
- [ ] **R7:** Let users run plugin capabilities.
- [ ] **R8:** Give developers a clear extension protocol.
- [ ] **R9:** Provide a CLI and P1 local web UI.
- [ ] **R10:** Supply two meaningfully different capability plugins.
- [ ] **R11:** Prove extensions are not hard-coded.
- [ ] **R12:** Define a plugin manifest.
- [ ] **R13:** Define capabilities and permission grants.
- [ ] **R14:** Address process isolation and JSON-RPC/MCP compatibility.
- [ ] **R15:** Define lifecycle and schema-based configuration.
- [ ] **R16:** Address sandboxing and version compatibility.
- [ ] **R17:** Test a third plugin with zero host changes.
- [ ] **R18:** Keep tools, model adapter, and permission policy outside the kernel.
- [ ] **R19:** Unwind registrations and react to service dependencies live.
- [ ] **R20:** Define hooks, exposure modes, and layered configuration provenance.
- [ ] **R21:** Preview installation commands and support pinned, versioned installs.

## 3. Goals and non-goals

Ship generic dispatch, reversible registrations, real inference, and a developer template usable in fifteen minutes. Disabling a plugin must remove every contribution, not merely hide its tools. Management supports readable output and `--json`.

Non-goals: hostile-code containment, marketplace, desktop packaging, remote workers, multi-agent delegation, and unattended automation. Plugins may use any installed language runtime; Patchbay does not provision runtimes. Local describes execution/storage, not necessarily inference: default to a pre-existing local endpoint; remote inference requires disclosure and consent. Never simulate model responses in the demo.

## 4. Target users and key user stories

**Operator:** “Find repository TODOs and save tasks.” Acceptance: Scout supplies actual citations, Ledger persists tasks, and the policy plugin asks before writes.

**Trust-conscious user:** “Show what installation will execute.” Acceptance: static preview/inspection exposes source/ref/hash, build/startup commands, schemas, permissions, and the unsandboxed warning before any package execution.

**Developer:** “Add behavior without host knowledge.” Acceptance: a standalone third package installs and runs; host source/build hashes remain unchanged and host `git diff` is empty.

**Maintainer:** “Swap providers while working.” Acceptance: disabling a provider deactivates dependents; unrelated plugins remain usable; re-enabling restores dependencies without host restart.

## 5. Core user flows

1. **Bootstrap:** `patchbay serve` starts the supervisor. Explicitly install/enable the supplied policy, model, and agent-runner packages; no implicit privileged plugins. Configure an existing Ollama-compatible endpoint or approved HTTPS provider. `doctor` probes runtime compatibility and model tool calling.
2. **Trust gate:** `plugin install <path|git-url> [--ref <commit|tag>]` resolves an immutable revision and statically previews source/hash, every build command, startup hooks, and requested permissions. Confirm before builds execute; `--yes` explicitly accepts this preview, never grants capabilities. Copy/build in staging, then atomically register disabled. Reject traversal, escaping symlinks, duplicate IDs, and incompatible manifests.
3. **Configure:** `plugin config <id> get|set|edit` validates the whole effective configuration before committing. Inspect permissions, grant only named host-mediated capabilities, then enable. Startup/handshake failures unwind registrations.
4. **Use:** Invoke a tool directly or the plugin-contributed `agent` command. Display calls and policy decisions. Denials become structured tool errors; never retry writes automatically.
5. **Change live:** Disable Ledger during a session: remove new dispatch routes immediately; drain in-flight work. Link Text Metrics, enable it, and use its newly discovered tool. `plugin reload <id>` and interactive `/reload` replace effects without restarting the host.

## 6. Functional requirements

**P0 — mandatory MVP**

- **F01, R1/R3–R9/R15/R21:** Host lifecycle CLI: `plugin install`, `link <path>` (development), `unlink`, `uninstall`, `update [--ref]`, `list`, `inspect`, `config get|set|edit`, `enable`, `disable`, `reload`, `run`, `invoke`, `logs`; plus `serve`, `doctor`, and `dump-config`. Unlink removes only the registration, never developer files.
- **F02, R12/R16/R21:** Declarative manifests, previews, immutable versioned install directories, atomic update switching, persistent separate config/state directories. Update previews changed commands/permissions and requires renewed grants where necessary; retain old versions until their processes finish.
- **F03, R8/R14/R18/R19:** Generic subprocess protocol, service dependency activation, scoped reversible effects, hot reload, crash/timeout cleanup, and no application-specific kernel routing.
- **F04, R7/R13/R20:** Schema-validated dispatcher, waterfall hooks, direct/deferred/hidden exposure, annotation-based policy plugin, and audit trail.
- **F05, R10/R18:** Ship `workspace-scout`, `task-ledger`, `permission-policy`, `model-openai-compat`, and `agent-runner` as ordinary packages. Scout performs bounded read-only search; Ledger owns durable storage, `/tasks`, and a `turn/stopping` hook that records turn summaries. Model supplies `llm@1`; policy supplies `permission.decision@1`; runner consumes both and supplies the agent command/loop and `discover_tools` tool.
- **F06, R5/R20:** Layered plugin tree, JSON Schema validation, and per-value provenance in `dump-config`.
- **F07, R11/R17/R19:** Template, protocol guide, independent third-plugin conformance, and complete unregister/dependency tests.

**P1 — committed follow-on:** **F08, R9** delivers a small local web UI with plugin list, inspect, configure, enable/disable, and run screens, plus live logs. Schema-generated forms and CLI share the same lifecycle API. This is not stretch scope.

**P2 — stretch:** hardened sandbox providers, signed distribution, broader MCP integration, and a Herdr-inspired `plugin new` creator that asks the agent to scaffold and verify a package; installation still requires preview.

## 7. Non-functional requirements

**Performance:** status targets 300 ms; five-plugin startup targets three seconds. Cap manifests at 32 tools/plugin, messages at 256 KB, model-visible results at 8 KB with explicit truncation, and Scout at 100 UTF-8 files of 256 KB each. Measure inference separately.

**Reliability:** initialize within three seconds, calls within ten, inference within thirty, runs within ninety. Serialize lifecycle mutations, not entire agent runs. Dispatch uses an activation-generation snapshot; disable removes future routes, drains existing calls within deadline, then terminates workers. Atomic file writes protect state; cancellation escalates from graceful shutdown to kill.

**Security/privacy:** plugins run as the current user and are **not sandboxed**. Declared permissions constrain only host-mediated dispatch/services; arbitrary plugin filesystem, network, and subprocess access cannot be contained. Installation preview is the trust gate. No telemetry; user-only state; redact secrets and log hashes/decisions rather than content. Credentials reach only their explicitly configured adapter. Model/plugin text cannot override policy decisions.

**Accessibility:** keyboard-only CLI/UI, `NO_COLOR`, stable exit codes, visible focus, and explicit approval surfaces. Noninteractive `ask` fails closed unless a scoped approval is supplied; installation `--yes` is not blanket execution approval.

## 8. Proposed architecture and tech stack

Use Node.js 22+, TypeScript, Commander, a TOML parser, Ajv, native subprocess/fetch, and `bun test`. Store registry/config/logs locally; use React, Tailwind, Radix/shadcn primitives for P1. Launch argv with `spawn(..., {shell:false})`; sanitize inherited environment. Separate processes provide failure isolation, not security isolation.

The kernel has exactly seven responsibilities: **plugin registry** (lifecycle/effect ownership), **event bus** (ordered delivery), **service registry** (dependency/routing), **tool registry** (schemas/dispatch), **session log** (append-only entries), **config layering** (merge/validate/provenance), and **process supervisor** (stdio, limits, cleanup). CLI/API/UI are thin control surfaces; the kernel contains no model loop, model adapter, tool implementation, or approval heuristics.

Every registration—tool, command, hook, service, UI panel—belongs to an activation scope. Disposal removes all effects, including partial startup effects. Required services use name/major-version matching; activate only when all exist, cascade deactivation when providers disappear, and reactivate when dependencies return. Reject cycles and ambiguous providers unless configuration selects one. Live UI panels are optional declarative contributions, never injected arbitrary browser code.

### Prior art and what we borrow

| Source/mechanism | Patchbay use | Deliberately skip |
|---|---|---|
| Pi: tools, hooks, permission extension, exposure, reload | Annotation-driven policy plugin; direct/deferred/hidden; hot reload | In-process TypeScript API, shortcuts, other exposure modes |
| dsh/Cordis: services, reversible effects, patchable boot tree | Dependency-driven activation and disposal; layered provenance | Identical profiles/patch syntax; dsh makes even registries/logs plugins, while our seven mechanisms remain kernel infrastructure |
| Herdr: TOML, argv, preview, versioned dirs, injected context | Static packaging and trusted-code lifecycle | Pane placements, link handlers, marketplace; our long-lived RPC is an addition, not Herdr v1 behavior |

### Where new behavior goes

| Goal | Extension point |
|---|---|
| Add search or task operations | Tool declaration/handler |
| Change model or agent strategy | `llm@1` provider or agent-runner replacement |
| Change approvals | `permission.decision@1` provider |
| Rewrite/block execution | `tools/pre-execute` waterfall hook |
| Persist domain state or react to turns | Plugin state directory and event hook |
| Add commands, panels, filesystem backend | Command/panel effect or service provider |

## 9. Data model / protocol / API surface

Choose **TOML** for readable, reviewable repeated command/hook blocks, borrowing Herdr's packaging style. JSON remains the schema, configuration-patch, and wire format. `patchbay-plugin.toml` contains required identity/compatibility fields and optional declaration arrays:

```toml
manifest_version = 1
id = "task-ledger"
name = "Task Ledger"
version = "0.1.0"
min_host_version = "0.1.0"
platforms = ["linux"]
permissions = ["state.read", "state.write"]
config_schema = "config.schema.json"
runtime = ["node", "dist/worker.js"]

[[build]]
command = ["node", "scripts/build.js"]
[[startup]]
command = ["node", "scripts/check-state.js"]
[[tools]]
name = "add_task"
input_schema = "schemas/add-task.json"
method = "tools/call"
exposure = "direct"
annotations = { readOnlyHint = false, destructiveHint = true, openWorldHint = false }
[[commands]]
name = "tasks"
command = ["node", "dist/tasks.js"]
[[events]]
on = "turn/stopping"
method = "events/handle"
priority = 50
[[services]]
name = "ledger"
version = 1
role = "provided"
[[services]]
name = "permission.decision"
version = 1
role = "required"
```

All executable `command`/`runtime` values are argv arrays, never shell strings. Tools/events may instead declare a one-shot `command`; exactly one command or RPC method is allowed. Static schemas/descriptions are authoritative; runtime discovery must match. One-shot stdout is one JSON result, stderr is logs, exit zero means success.

Inject `PATCHBAY_BIN_PATH`, `PLUGIN_ID`, `PLUGIN_ROOT`, `PLUGIN_CONFIG_DIR`, `PLUGIN_STATE_DIR`, `PLUGIN_CONTEXT_JSON`, and, for hooks, `EVENT_JSON`/`EVENT_NAME`; include command ID and a scoped local API token where needed. Context includes workspace/session/turn IDs, not secrets. Builds receive staging paths; startup runs on activation. No dependency download is hidden from preview.

**Long-lived protocol:** `patchbay/1` uses UTF-8 newline-delimited JSON-RPC 2.0 over stdio; stdout is protocol only. `initialize` receives `{protocolVersion,pluginId,config,context}` and returns the same version plus capabilities; host sends `notifications/initialized`. Reject incompatible versions. Support `tools/list`, `tools/call`, `commands/call`, `events/handle`, `services/call`, `shutdown`, and `notifications/cancelled`. Bidirectional service requests use distinct host/plugin ID prefixes and kernel routing. Shutdown drains then closes transport.

```json
{"jsonrpc":"2.0","id":"h3","method":"tools/call","params":{"name":"add_task","arguments":{"title":"Fix TODO"}}}
{"jsonrpc":"2.0","id":"h3","result":{"content":[{"type":"text","text":"Saved t1"}],"isError":false}}
```

Tool shapes follow MCP: name, description, JSON Schema `inputSchema`, annotations, and content/isError results. Invalid params return `-32602`; handler failures return `isError:true`. This is MCP-compatible tool data, **not a claim of full MCP wire compatibility**; native lifecycle/service methods are Patchbay-specific. Namespaced aliases use exact lookup, never shell parsing.
Direct CLI forms are `plugin run <id> <tool> --json <arguments>` and `plugin invoke <id> <command> --json <arguments>`.

Events include `session/start`, `session/end`, `turn/start`, `agent/pre-step`, `agent/request`, `tools/pre-execute`, `tools/post-execute`, `turn/stopping`, `plugin/loaded`, `plugin/unloaded`, `plugin/failed`, `service/available`, and `service/unavailable`. Payloads carry event/version/session/turn/plugin IDs and data. Lifecycle notifications are observational; `agent/pre-step`, `tools/pre-execute`, and `turn/stopping` use ordered request handlers. Pre-execute is a waterfall returning `{action:"continue"|"rewrite"|"block",arguments?,reason?}`; order by priority then plugin ID, revalidate rewrites, and run authorization last. Post-execute cannot reverse side effects. Model-visible messages/results are appended to the session log.

Direct tools enter model schemas; deferred tools enter only after the runner's plugin-provided `discover_tools({query})` finds their schemas; hidden tools are operator-only and excluded from discovery. Policy uses `readOnlyHint`, `destructiveHint`, `openWorldHint` and grants to allow/ask/block; hints are untrusted, not proof. Kernel only enforces the provider's decision and blocks dispatch if no policy service exists.

Config precedence: **defaults → plugin config → user patch file → project patch → CLI overlay**. Merge objects recursively; replace arrays/scalars; reject unknown fields. Patches target plugin IDs/config or enabled/provider selections. `dump-config` prints the effective plugin tree and every leaf's source file/layer; redact secrets. Invalid patches never partially activate.

Persist plugin version/hash/path, desired-enabled versus active state, grants, generation/errors, and audit/session entries beneath `~/.patchbay`; keep plugin state outside install roots. Loopback API exposes plugin list/inspect/config/enable/disable/run/logs using the same dispatcher; token authentication, same-origin requests, no permissive CORS.

## 10. Risks, open questions, and mitigations

**Scope:** plugin-first orchestration adds work; build direct execution and service disposal before agent polish. P1 UI remains a follow-on, not discarded stretch.

**Trust:** manifests and annotations can lie; show source and unsandboxed limitations prominently. Host-mediated denials do not prove filesystem containment.

**Lifecycle:** dependency churn and partial activation can leak effects; generation snapshots, disposal tests, and bounded draining are release gates. Policy unload must block new calls.

**Model/config:** preflight real tool calling, cap loops, diagnose direct calls; schema-check all layers. Open questions: local-only inference, demo model availability, additional platforms, and provider conflict policy. Defaults: disclosed optional remote inference, Linux, explicit provider selection.

## 11. Success metrics and a demo script

Release gates: all P0 checks pass; real two-plugin workflow succeeds in four of five preflights; denied writes create zero tasks. Third-plugin test records **empty host git diff** and unchanged source/build hashes. Disable test compares tools/hooks/commands/services/panels before/after, proves none remain callable, and tests dependency reactivation. Crash/hang fixtures leave healthy plugins usable.

**4:45 demo, with preflighted model and prepared packages:**

1. **0:00–0:35:** Show bare kernel's empty tools, then enable policy/model/runner; `doctor` reports real inference and plugin providers.
2. **0:35–1:25:** Preview/install Scout and Ledger; inspect commands/permissions, reject invalid config, enable, and show `dump-config` provenance.
3. **1:25–2:30:** Agent finds TODOs and saves tasks after policy approval; show Ledger storage, `/tasks`, and its turn hook.
4. **2:30–3:10:** Disable Ledger live; tools, command, hook, and service disappear. Re-enable without host restart.
5. **3:10–4:10:** Drop in independent Text Metrics; install/enable/run. Conformance prints known result, empty host git diff, unchanged hashes, and unregister assertions.
6. **4:10–4:45:** Disable policy to show fail-closed dispatch, restore it, and run a crash fixture while Scout remains healthy. Explain trust versus sandboxing. P1 demo adds the same management actions through Appendix A's UI.

## 12. Milestones and build plan

1. **Hours 0–1:** Manifest, CLI, staging/preview, versioned install/config/state, validators.
2. **Hours 1–3:** Supervisor/RPC, effect scopes, services, event ordering, live lifecycle, generic dispatch.
3. **Hours 3–4.5:** Scout/Ledger, commands/hooks/storage, policy provider and denied-write tests.
4. **Hours 4.5–6:** Model adapter and agent-runner packages; real workflow, provenance, logs/doctor.
5. **Hours 6–8:** Third-plugin proof, complete disposal/dependency/failure tests, documentation, timed rehearsal.
6. **P1 follow-on:** Loopback list/inspect/configure/enable/run UI and shared-API tests.

**MVP cut line:** F01–F07 and steps 1–5. Cut polish, creator, distribution, and sandbox experiments before conformance or real inference. F08 has a separate P1 acceptance gate; never replace plugin implementations with host shortcuts.

## 13. Promo-video hooks

“Empty kernel. Installed intelligence.” Show tools appearing from packages; TODO citations becoming approved durable tasks; registrations vanishing on disable; and “New capability. Zero host changes.” End with a policy-provider swap, not a hard-coded approval dialog.

**Prior-art sources:** [Pi extensions](https://docs.pi.dev/latest/extensions), [dsh architecture](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/architecture.md), [Herdr plugins](https://herdr.dev/tui/docs/plugins). Mechanisms above follow the verified research notes; Patchbay's protocol and precedence are deliberate design choices.

## Appendix A: UI Design System (user directive)

Apply this system to P1's small local plugin list, inspect, configure, enable, and run screens: clean, minimal, black-and-white shadcn/ui styling, **no borders**.

- **Palette:** black `#000000`, white `#FFFFFF`, neutrals `#FAFAFA`, `#F4F4F5`, `#E4E4E7`, `#71717A`, `#18181B`. No accent colour; state uses labels/icons, weight, and fill inversion, never hue alone.
- **No borders:** no border, outline, or dividers on cards, inputs, buttons, tables, panels. Separate with whitespace, neutral surfaces, optional soft shadows. Keyboard focus uses a visible 2px offset shadow-ring.
- **Components:** border-width-zero shadcn/Radix Button, Input, Card, Dialog, Tabs, Sheet, Tooltip, Badge, Switch, Toast; Tailwind; radius 10px.
- **Typography/motion:** Geist or Inter, 14px base, weights 400/600; tight headings. 150ms opacity/translate transitions; respect reduced motion.
- **Dark mode/accessibility:** inverted black/white surfaces; body contrast ≥7:1. Every interactive control needs distinct fill or visible hover/focus. Verify keyboard management and approval dialogs in P1 acceptance tests.

## Appendix B: Scaffold (Better-T-Stack, one scaffold per project)

Run `scaffold/03-patchbay.sh` from a workspace folder outside this repo. It creates `patchbay/` as its own independent project and git repo, using the same Better-T-Stack command as every other product (user directive: same stack for consistency, never one mega scaffold). The command was validated against the live CLI on 2026-11-21. **Where this appendix conflicts with Section 8, this appendix wins.** Bun is the package manager and runtime throughout: `bun install`, `bun run`, `bunx`, and `bun test` for unit tests (replacing any npm, pnpm, npx or Vitest reference elsewhere in this PRD; Playwright stays for browser end-to-end tests).

Kernel and CLI are hand-written in `apps/server` (Bun + TypeScript), replacing the PRD's Node 22 + Commander. Hono serves the local management API; Next.js is the local web UI (the P1 UI). State lives in JSON/SQLite in each plugin's state dir, so MongoDB, Better Auth, Polar, wxt and native-uniwind stay dormant. The `mcp` addon fits Patchbay's MCP-compatible tool shapes. Prior art: docs/research/03-inspiration-pi-dsh-herdr.md.
