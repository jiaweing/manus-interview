# Patchbay: Local AI Agent Harness

**Builder:** Jia Wei Ng · **Delivery:** 5.5 focused hours · **MVP platform:** Linux CLI only

## 1. Overview

**Patchbay** is a local AI agent harness with a small kernel and **zero built-in tools**. Independently packaged plugins supply workspace search and model access. Users preview installation, inspect/configure packages, enable/disable them, and run capabilities. One CLI agent loop composes the plugins; a third-package test proves extension without host changes.

## 2. Problem statement and the original brief

Agent prototypes entangle tools, orchestration, and privileges. Patchbay makes the extension boundary inspectable. This R-ID checklist retains the original requirement mapping while explicitly narrowing architectural extras:

- [ ] **R1:** Local AI agent harness.
- [ ] **R2:** Independently packaged plugins.
- [ ] **R3:** Install plugins.
- [ ] **R4:** Inspect plugins.
- [ ] **R5:** Configure plugins.
- [ ] **R6:** Enable and disable plugins.
- [ ] **R7:** Run plugin capabilities.
- [ ] **R8:** Document the extension protocol.
- [ ] **R9:** CLI only; local web UI removed.
- [ ] **R10:** Exactly two meaningfully different shipped plugins.
- [ ] **R11:** No hard-coded extension routing.
- [ ] **R12:** Declarative plugin manifest.
- [ ] **R13:** Capabilities and host-enforced permission grants.
- [ ] **R14:** Subprocess isolation; JSON-RPC over stdio; documented MCP boundary.
- [ ] **R15:** Lifecycle and schema-validated configuration.
- [ ] **R16:** Explicit unsandboxed boundary and version checks.
- [ ] **R17:** Independent third-plugin, zero-host-change proof.
- [ ] **R18:** Tools/model adapter outside kernel; simple allow/deny enforced by host.
- [ ] **R19:** Reversible registrations; disabled adapter stops agent execution.
- [ ] **R20:** Defaults plus user override only; hooks/exposure/provenance removed.
- [ ] **R21:** Preview before execution; record installed version and package hash.

## 3. Goals and non-goals

Deliver the checklist with real inference, generic dispatch, reversible registration, and verifiable failures. A developer uses the manifest/protocol guide and fixture to add behavior without editing host code.

**Explicitly out of scope:** web/desktop/mobile UI, additional platforms/providers, task storage, history/export, analytics/dashboards, accounts/payments, permission-policy plugin, hooks/exposure modes, layered configuration, reload beyond enable/disable, link/update/build hooks, creator mode, marketplace, remote workers, bots, hardened sandboxing, and animation/polish extras. No follow-on commitments.

Local means execution/storage on the user's machine. Use one pre-existing local model endpoint; do not simulate inference or add a remote-provider fallback.

## 4. Target users and key user stories

**Operator:** Real model inference finds repository TODOs with actual file/line citations.

**Trust-conscious user:** Preview shows source, version/hash, runtime argv, schemas, permissions, and unsandboxed warning before execution.

**Developer:** Independent Text Metrics fixture installs/runs with unchanged host source/build hashes and empty host working-tree diff.

## 5. Core user flows

1. **Start:** Open a foreground CLI session with no registered tools. Prepared packages require no dependency download or build during installation.
2. **Install:** `plugin install <path>` validates and previews a local package. Confirmation copies the reviewed snapshot and registers it disabled; cancellation executes nothing.
3. **Inspect/configure:** `plugin inspect <id>` shows declarations, effective config, grants, and state. `plugin config <id> get|set` validates defaults plus user overrides atomically. Grant only declared permissions before enabling.
4. **Run:** `plugin run <id> <capability> --json <arguments>` dispatches directly. `agent <prompt>` uses the enabled model adapter and registered tools, displaying calls/results. Denials become explicit errors.
5. **Disable/extend:** Disable Scout; its tools disappear immediately. Re-enable through a fresh handshake. Install/enable/run the independent fixture without rebuilding or restarting the host.

## 6. Functional requirements

**All requirements below are MVP release gates; there are no P1/P2 items.**

- **F01, R1/R3–R9/R15/R21:** CLI session implements install, inspect, config, enable, disable, run, and one agent command. Return stable exit/error codes; failed operations leave prior state intact.
- **F02, R2/R12/R16/R21:** Validate manifests, local package paths, schemas, versions, and runtime argv. Reject traversal, escaping symlinks, duplicate IDs, and incompatible packages. Installation preview runs no package code; execute only after enable.
- **F03, R8/R14/R19:** Generic JSON-RPC supervisor owns registrations per activation. Failed initialization, disable, crash, and timeout dispose all tool/provider routes. No special-case plugin IDs.
- **F04, R5/R13/R18/R20:** Validate configuration and arguments; host denies capabilities whose declared permissions are not granted. No approval heuristics or policy provider.
- **F05, R10/R18:** Ship only `workspace-scout` (bounded read-only repository search) and `model-openai-compat` (inference adapter for one local endpoint). The CLI orchestration layer—not the kernel—owns one bounded agent loop.
- **F06, R11/R17:** Publish a concise manifest/protocol guide and independent Text Metrics conformance fixture. The fixture is test material, not a third bundled production plugin.

## 7. Non-functional requirements

**Reliability:** initialize within three seconds; tool calls time out after ten seconds, inference after thirty, agent runs after ninety or six steps. Disable blocks new dispatch immediately, drains existing calls to their deadline, then terminates the worker. Serialize lifecycle mutations; write registry/config atomically.

**Bounds:** cap protocol messages at 256 KB and model-visible results at 8 KB with explicit truncation. Scout searches only the configured workspace, at most 100 UTF-8 files of 256 KB each; reject paths outside that root.

**Trust:** plugins run as the current user and are **not sandboxed**. Host allow/deny protects host-mediated dispatch, not arbitrary plugin filesystem/network access. Review source before enable. Launch argv without a shell; minimize inherited environment, pass credentials only to the configured adapter, redact secrets, and collect no telemetry. Model/plugin text cannot change grants.

**CLI usability:** keyboard-only, readable errors, `NO_COLOR`, and no secret values in inspection output.

## 8. Proposed architecture and tech stack

Use Bun + TypeScript, TOML parsing, Ajv, native subprocess/fetch, and `bun test`, within Appendix B's scaffold. Kernel responsibilities are registry/config validation, subprocess supervision, generic capability routing, permission enforcement, and activation cleanup. It contains no tool implementation, model implementation, or agent loop.

The CLI agent loop obtains the enabled adapter's `llm@1` capability, supplies registered tool schemas, dispatches requested calls, and returns results until completion or a bound. Missing adapter stops the loop with an actionable error. Do not build a dependency graph, event bus, UI API, or persistent session log.

### Prior art and what we borrow

| Source | Borrow |
|---|---|
| [Pi](https://docs.pi.dev/latest/extensions) | Plugin-defined tools and providers. |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/architecture.md) | Ownership and reversal of registrations. |
| [Herdr](https://herdr.dev/tui/docs/plugins) | Declarative TOML, argv execution, installation preview. |

## 9. Data model / protocol / API surface

`patchbay-plugin.toml` declares manifest version, ID/name/package version, minimum host version, Linux compatibility, runtime argv, permissions, config schema/defaults, and tool/provider declarations. Every capability has a name, description, input schema, RPC method, and required declared permissions. Static declarations are authoritative; initialization must match them. No build/startup hooks or dynamic executable downloads.

Persist installed path/version/hash, enabled state, user overrides, and grants beneath `~/.patchbay`; no conversation history. Configuration is **defaults → user override**, recursively merging objects and replacing arrays/scalars. Reject unknown fields and invalid updates without partial writes.

`patchbay/1` is UTF-8 newline-delimited JSON-RPC 2.0 over stdio. Stdout contains protocol only; stderr contains diagnostics. `initialize` receives protocol version, plugin ID, effective config, and workspace context; incompatible replies fail activation. Support `tools/list`, `tools/call`, `services/call` for the adapter, and `shutdown`. Correlate request IDs; reject malformed/oversized messages and terminate hung workers.

Invalid arguments return `-32602`; handler/permission failures return structured errors. Tool results use text `content` and `isError`; tool names/descriptions/input schemas follow MCP-style data. This is **not full MCP wire compatibility**. Namespaced capability lookup is exact, never shell parsing. Disposing an activation removes every registration, including partial initialization effects.

## 10. Risks, open questions, and mitigations

**Model readiness:** tool-calling support and latency may block the demo. Preflight the chosen local endpoint before building the loop; direct calls diagnose failures but do not replace real-inference acceptance.

**Trust/lifecycle:** manifests cannot prove containment; show the warning. Registration leaks are release blockers, covered by disable/crash/timeout tests.

**User question:** which existing local endpoint and tool-capable model will be available for the demo? Linux and trusted local packages are fixed MVP decisions.

## 11. Success metrics and a demo script

Release gates: checklist tests pass; real Scout/model workflow completes; denied search executes no handler; invalid config preserves prior config. Disable and partial-startup tests leave zero owned registrations. Crash/timeout fixtures do not break healthy plugins. Third-plugin conformance records a known result, empty host diff, and unchanged host source/build hashes.

**4:30 judge demo; prepared packages and preflighted model:**

1. **0:00–0:50:** Show empty kernel; preview/install the two packages and inspect their different declarations.
2. **0:50–1:30:** Reject invalid config; configure endpoint/workspace, show denied search, grant declared permissions, enable.
3. **1:30–2:30:** Real agent finds TODOs; display tool calls and verify file/line citations.
4. **2:30–3:10:** Disable Scout; show it is unavailable, then re-enable and run directly.
5. **3:10–4:30:** Drop in Text Metrics, install/enable/run its known input; show unchanged host hashes/diff and disable cleanup. State the unsandboxed boundary.

## 12. Milestones and build plan

1. **0–1 hour:** CLI, manifest/schema validation, preview/install, config/grants.
2. **1–2.5 hours:** Stdio supervisor, generic dispatch, reversible enable/disable, failure tests.
3. **2.5–4 hours:** Two plugins, bounded CLI agent loop, real endpoint preflight/workflow.
4. **4–5.5 hours:** Independent fixture/hash proof, requirement tests, short protocol guide, timed rehearsal.

**MVP cut line:** F01–F06 and all release gates. Freeze scope after direct dispatch works. Protect real inference, permission denial, cleanup, and zero-host-change proof; build no removed work.

## 13. Promo-video hooks

- Empty kernel; two installed packages supply different capabilities.
- Real inference turns repository TODOs into cited answers.
- New capability, unchanged host; disable removes its registrations.

## Appendix A: UI Design System (user directive)

Retain the design directive, but **no UI is built in this CLI-only MVP**: clean, minimal, black-and-white shadcn/ui style, **NO borders**. Black/white and neutral surfaces only; distinguish state through text, weight, and fill. Separate components with whitespace, not borders, outlines, or dividers. Borderless shadcn/Radix components use 10px radius, Geist/Inter typography, and a visible offset shadow-ring for keyboard focus. No animation work is scheduled.

## Appendix B: Scaffold (Better-T-Stack, one scaffold per project)

Run `scaffold/03-patchbay.sh` outside this repo. It creates `patchbay/` as an independent project/git repo using the same Better-T-Stack command: **one scaffold per project, never a shared mega scaffold**. This appendix governs stack conflicts. Bun is package manager/runtime throughout: `bun install`, `bun run`, `bunx`, `bun test`.

Implement kernel/CLI in `apps/server` with Bun + TypeScript. Leave generated Next.js/mobile/extension surfaces, Hono management API, MongoDB, Better Auth, Polar, and unrelated addons dormant; scaffold presence is not MVP scope. No browser tests are needed. Existing prior-art notes: `docs/research/03-inspiration-pi-dsh-herdr.md`.
