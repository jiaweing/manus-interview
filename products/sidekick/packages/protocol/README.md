# Shared turn protocol (#79)

`src/index.ts` is a browser-safe Zod module, importable by both apps through a relative path (as with `packages/config/src/proxy-url.ts`). It imports only Zod, already provided by the workspace; there is no new dependency or lockfile change. Server environment/provider code must never be imported by the extension.

Exports: `snapshotSchema`, `actionSchema`, `toolArgsSchemas`, `toolCallSchema`, `toolCallIdSchema`, `toolResultSchema`, `turnMessageSchema`, `turnRequestSchema`, `turnResponseSchema`, `httpUrlSchema`, and inferred `Snapshot`, `Action`, `ToolCall`, `ToolResult`, `TurnMessage`, `TurnRequest`, `TurnResponse` types.

## Turn envelope

Authenticated `POST /v1/agent/turn` accepts exactly `{ goal, messages, snapshot }`. `goal` is a nonblank string. `snapshot` follows PRD section 9: `{ snapshotId, documentToken, tabId, url, title, text, truncated, elements }`, with unique integer element indexes, at most 20,000 text characters and 300 elements. Indexes and tab IDs are nonnegative safe integers; identity strings are preserved verbatim. Each element has `{ index, role, name, inputType?, href?, enabled }`. Snapshot redaction and truncation remain the extension's responsibility (#82), not a claim made by server validation.

Responses contain `{ text, toolCall? }`. A tool call is `{ id, name, args }`; the original provider ID is preserved, never generated or rewritten. There is **no array of calls**, model/provider selection, client system message, or browser dispatch. Strict objects reject unknown properties.

Messages are current-run entries only:

```typescript
{ role: "user", text: "A user instruction" }
{ role: "assistant", text: "Intent", toolCall: { id: "call_123", name: "findText", args: { query: "Notes" } } }
{ role: "tool", toolCallId: "call_123", result: "Redacted local evidence, not sensitive values" }
```

Assistant entries may omit `toolCall`. Every call must be immediately followed by its matching result before the next message or turn request. Reject orphan, mismatched, duplicate, interleaved, and unresolved results/calls. IDs must be unique within the current run, including the next response. A rejected or failed action should still produce its matching redacted tool result if the loop continues. The extension binds the call ID as `Action.actionId` when it constructs an identity-bound action; the server never constructs or dispatches that action.

## Allowed tools

- `observe`: `{ tabId, query? }`, nonblank optional query.
- `findText`: `{ query }`, nonblank query.
- `scroll`: `{ direction: "up" | "down", pixels }`, positive safe integer. The execution layer clamps it to its documented finite range (#84); the server does not execute scrolling.
- `click`: `{ index }`.
- `fill`: `{ index, value }`, string value including empty string for ordinary clearing. Sensitive-field policy remains local (#87).
- `openTab`: `{ url }`, credential-free HTTP(S) URL only.
- `switchTab`: `{ tabId }`.
- `finish`: `{ summary }`, nonblank string. Completion verification remains local (#93).

`actionSchema` has the PRD identity fields `{ runId, actionId, tabId, snapshotId, documentToken, preview }`, plus discriminated `{ tool, args }` from those same signatures. Structural validation does not replace stale-document checks, permissions, confirmation, or local evidence.

## Server behavior

Existing #78 authentication, UTF-8 body limits, rate budget, CORS, and no-body-logging helpers remain in place. Invalid request/transcript → 400 before adapter invocation; missing/incorrect token → 401; byte/rate limits → 413/429. A missing server key leaves the adapter unconfigured → 501. Invalid provider output (including multiple/unknown calls, invalid arguments, truncated completion, or reused IDs) → 502, provider/network failure → sanitized 502, 20-second model deadline → 504, client cancellation → 408. Unexpected adapter errors retain the sanitized 500 handler. No provider error body, credentials, or Zod payload values are logged or returned.

The deadline includes receiving/parsing the provider response, aborts the HTTP signal, and guards even an adapter that ignores cancellation. There are no provider retries. Request cancellation also aborts the adapter and invalidates its late response.

OpenRouter uses one model captured from server `OPENROUTER_MODEL` (fallback candidate `anthropic/claude-sonnet-5.5`) and `OPENROUTER_API_KEY` from server env/.env. Requests go only to the fixed HTTPS Chat Completions endpoint, with redirects disabled, `n: 1`, `stream: false`, `parallel_tool_calls: false`, and all eight tool schemas. Provider output is independently validated even if it disregards the single-tool flag. Page snapshots are JSON-encoded and explicitly labelled untrusted observation data; this is not a promise of prompt-injection immunity or a substitute for local deterministic policy.

Official wire-format references checked during implementation:

- [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling): nested Chat Completions function definitions, `tool_calls[].id`, `tool_call_id` tool results, and disabling parallel calls.
- [OpenRouter Chat Completions API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion): single-completion request/response fields.

All tests use fake adapters or fake provider HTTP transports. Real API/model availability check: **not run: no key**. The issue's Verification sentence saying “fixed Google adapter/model selection” conflicts with its OpenRouter tasks and the PRD; tests follow the explicit OpenRouter-only contract, not that stale wording.
