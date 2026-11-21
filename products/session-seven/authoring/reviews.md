# Authoring reviews

## Issue #153 — Locked timeline and truthful caption validation

- **Issue:** #153, “Lock beat-grid scene records, sanitized fixtures and truthful caption validation.”
- **PR:** https://github.com/jiaweing/manus-interview/pull/191 (`session-seven/153-timeline`).
- **Author kind:** authored by Manus swarm agent builder #153, not by anthropic/claude-opus-5.5 (access blocked: no OPENROUTER_API_KEY).
- **Files changed:** `apps/video/src/timeline.js`, `apps/video/src/validate-timeline.js`, `apps/video/scripts/validate-timeline.js`, `apps/video/tests/timeline.test.js`, the minimal root `package.json` validation script, `qa/timeline-validation.txt`, `qa/claims-audit.md`, and this review entry.
- **Review outcome:** builder checks pass for the locked beat table, all six concept claims, sanitized fixtures, exact captions, interval endpoints, and required malformed-input rejection. No Opus patch/request/generation reference exists or is claimed. This work does not satisfy the blocked #152 authoring gate.
- **Tests/evidence:** `qa/timeline-validation.txt` records `bun run validate:timeline`, the four required temporary negative CLI runs and their exit codes, and `bun test apps/video/tests/timeline.test.js`. `qa/claims-audit.md` records all eight claims and their PRD/evidence/status decisions.
- **Stills:** not applicable to the immutable data and validator scope; no scene/render review claimed.
- **Independent verification:** pending a clean-worktree verifier; the builder has not applied `status:verified` or merged/closed the issue.
## #163

Issue: [#163](https://github.com/jiaweing/manus-interview/issues/163) — Bound the opt-in OpenRouter music smoke test behind validated access and rights.

PR: [#192](https://github.com/jiaweing/manus-interview/pull/192), branch `session-seven/163-music-adapter`; contains `Closes #163`.

Author kind: authored by Manus swarm agent b163/builder, not by anthropic/claude-opus-5.5 (access blocked: no OPENROUTER_API_KEY).

Files changed: `apps/video/src/music/openrouter-adapter.js`, `apps/video/src/music/contract.js`, `apps/video/src/music/candidate-sink.js`, `apps/video/scripts/music-generate.js`, `apps/video/audio/music-approval.json`, `apps/video/tests/openrouter-adapter.test.js`, root `package.json` (one script), `qa/music-provider.json`, `qa/music-provider-verification.txt`, and this record.

Review outcome: builder self-check only, not independent verification. The 40 fake-transport/clock tests pass with 121 assertions, including zero-request preflights, SSE/base64 mapping, the 120000 ms whole-request deadline, two-attempt maximum, approved total cost reservation, denied/unsupported/malformed fallbacks, sentinel exclusion, sink handoff and render-import isolation. The exact issue commands exited 0; the no-key command printed `FALLBACK no-key networkRequests=0`. A separate test subprocess with a fetch guard reported `guardNetworkRequests=0`. Evidence: `qa/music-provider-verification.txt` and `qa/music-provider.json`. No stills are applicable to this script-only adapter.

Documented contract summary: OpenRouter's audio guide documents POST chat completions with `messages`, `modalities:["text","audio"]`, `audio:{voice:"alloy",format:"pcm16"}`, and `stream:true` for **GPT Audio**; SSE audio is `choices[0].delta.audio.data`, concatenated as base64 before decoding, ending at `data: [DONE]`. OpenRouter lists Lyria Pro/Clip as text/image in and text/audio out. It does not confirm that the GPT Audio voice/format sample applies to Lyria, nor that per-request price controls enforce Lyria's per-song pricing. Therefore the production `musicContract.validated` and cost-control validation remain false, and changing approval JSON alone cannot enable a request. The hypothetical injected contract in tests is protocol coverage, not a claim of Lyria validation. Sources and retrieval date 2026-11-21 are recorded in `src/music/contract.js`.

Unverified: real smoke test **not run: no key**; authenticated access, Lyria-specific audio configuration/hard cost controls, generated duration/BPM/timing and usage rights remain unapproved or unverified. The named sink intentionally rejects with `cache layer not implemented` pending #165. Independent verifier review is pending.
