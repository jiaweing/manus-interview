# Issue #82 — bounded, private targeted observations

Run `bash evidence/82/verify.sh` from `products/sidekick`. The runner exports the same non-production example HTTPS proxy origin for the build and manifest tests. It performs no provider network call. The Chromium fixture origin is granted only in a disposable extension copy/profile; production permissions are unchanged.

The issue suite covers exact/above 20,000-character and 300-descriptor boundaries, both caps together, bounded descriptor names, matches beyond the initial excerpt (including a single large text node), queries spanning inline text, many matches, missing/invalid queries, fresh target indexes, and randomized cookie/storage/hidden/password/input/textarea/select/contenteditable/ARIA-value secrets. Cookie/storage/password getters are guarded: the observer performs zero reads. The ordinary input value is read only twice by explicit local equality checks, never by observation.

The independent verifier's four ARIA repros (`textbox `, `textbox searchbox`, `combobox listbox`, `option `) are permanent unit and packaged-Chromium regressions. Additional tests cover mixed case, leading/trailing whitespace, unknown-role fallback, first-valid unsupported roles, and an editable token after a noneditable role. Every editable role token excludes current values and nested controls, regardless of the first valid role used for the descriptor. CSS `content-visibility:hidden`, hidden label references, and browser-reported invisible content are excluded from normal and targeted snapshots and the adapter-serialized provider body. Unit tests exercise the fallback without native `checkVisibility`; Chromium checks native `contentVisibilityAuto`, including offscreen auto-skipped content.

`outbound-provider.json` is the actual body captured from the OpenRouter adapter with a fake transport. Inspect its untrusted snapshot and tool result: only permitted rendered prose, field descriptors, document/snapshot identity, and `{ "matches": true, "status": "checked" }` are present. The seeded values and authorization header are not recorded. Future fill tooling can reuse `observer.checkValue(snapshotId, documentToken, index, expected)`; unavailable/stale targets return a boolean failure rather than any current field value. Filling or action dispatch itself is not implemented by this issue.

The headed Chromium check uses `/usr/bin/chromium` under `xvfb-run -a` with the built content-script bundle in the isolated top frame. It proves both caps, late targeted evidence and a live link index, 21 randomized secret exclusions, old-index invalidation, and document-token rotation on reload. A separate short privacy page prevents the initial 20k cap from hiding any regression; its native hidden box has a 600×60 rectangle but empty `innerText`. Results are in `browser-results.json` and `browser.log`; no seeded form values are captured as screenshots. Provider serialization uses the production adapter with a fake transport, never an actual network API call.

All final verification command tails and explicit exit codes are in `summary.log`; full sanitized outputs are adjacent. The secret scanner uses a generated dummy input when no demo token is privately supplied; its value is never printed. This is not a scan against a real provider key.

Earlier local setup attempts hit the existing manifest build/test-origin mismatch and the scanner's required token input; the runner now supplies a consistent example origin and an unlogged generated dummy sentinel. No manifest, hosting-gate, or scanner behavior was changed to address those setup failures.

## Limitations / scope

- Real OpenRouter API: **not run: no key**.
- HTTPS hosting smoke gate: **not run**; issue #78 owns `bun run test:https` and its required deployment inputs.
- Query matching is case-insensitive literal rendered-text search with whitespace normalization and roughly 200 characters of surrounding context per excerpt. It is not semantic search.
- Privacy is structural exclusion of browser storage and editable/hidden content, not arbitrary secret detection in otherwise public page prose or metadata.
- Read/find/scroll dispatch, fill execution, and additional stale-action preflight are owned by subsequent/separate issues. Top-frame-only limitations from #81 remain unchanged.
