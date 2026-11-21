# Issue #127 — direct-WebRTC preflight evidence

## Fix-round verification

PR: https://github.com/jiaweing/manus-interview/pull/195. The fix round merged
`origin/main` at `fde493e` into `glassroom/127-preflight`, preserving main's
formatted baseline and evidence exclusions. No `biome.json` rule was changed.
Source changes repair lint and guarantee nested-finally cleanup; all original
preflight assertions remain intact.

Run from this monorepo's `products/glassroom` on **2026-11-21 UTC**, with
`PUBLIC_PORT=4327` and `NEXT_INTERNAL_PORT=5327`. `bun run dev:https` was running
while the issue's exact preflight command and separate blocked case were run.
The tested origin was **https://localhost:4327** on the local Ubuntu sandbox
network, using independent full desktop Chromium **159.0.8154.6** processes,
headless, with separate temporary persistent profiles on the **same host**.
No external judge network was available.

## Commands and outputs

Every command below exited **0**. Fresh output replaces the previous run.

| Command | Output |
| --- | --- |
| `bun install --frozen-lockfile` | [install.log](install.log) |
| `bun run check` | [check.log](check.log) |
| `bun run check-types` | [check-types.log](check-types.log) |
| `bun run build` | [build.log](build.log) |
| `bun test tests/unit` | [unit.log](unit.log) |
| `bunx tsc --noEmit -p tsconfig.json` | [root-types.log](root-types.log) |
| `bun /home/ubuntu/work/f127/cleanup-probe.mjs` | [cleanup-probe.log](cleanup-probe.log) |
| `bunx playwright test tests/e2e/preflight.spec.ts --project=chromium` | [preflight.log](preflight.log) |
| `bunx playwright test tests/e2e/preflight.spec.ts --project=chromium --grep blocked-connectivity --reporter=list` | [blocked.log](blocked.log) |

The exact issue command passed **2/2** tests; the blocked rerun passed **1/1**.
Unit tests passed **14/14** with 117 assertions. Root TypeScript also includes
the preflight spec. See [commands.json](commands.json) for machine-readable
verification exits and [verification.txt](verification.txt) for retained tails.
The posted PR fix-round comment identifies the final verified commit SHA.

Only the [required two-case preflight HTML report](playwright-report/index.html)
is retained; it includes both JSON attachments. Duplicate `blocked-report/` and
unrelated `boot-report/` HTML directories were deleted. Standalone compact
records are [direct.json](records/direct.json), [blocked.json](records/blocked.json),
and [blocked-rerun.json](records/blocked-rerun.json).

## Acceptance criteria

- [x] **PASS:** Distinct persistent desktop profile directories; both peers have
  `iceServers=[]`, with no TURN/STUN provider. The negotiated channel is
  `ordered=true`, `maxRetransmits=null`, `maxPacketLifeTime=null`; selected
  candidate pairs are host/host, with zero relay candidates.
- [x] **PASS on the recorded sandbox network:** A received
  `glassroom-preflight-from-b` and B received `glassroom-preflight-from-a` over
  their data channels. Total negotiation and collection took **189.467 ms**,
  below the ten-second upper bound.
- [x] **PASS:** Candidate withholding produces the explicit `failed` preflight
  state and `deliveryBlocked=true`, closed peers, no received strings or selected
  pairs, and zero relay/fallback attempts. The independent blocked rerun finished
  in **9525.914 ms**, below ten seconds. The negative test passes because it
  asserts an actual failed preflight; it does not skip a failing positive case.

## Cleanup verification

Evidence writing/attachment is wrapped in `try/finally`; browser closure and
profile removal have their own nested `try/finally`. Every context close is
settled before proceeding, and every profile removal is attempted even when
an earlier operation rejects. Cleanup rejection remains a failing assertion.
A temporary failure-injection probe extracted and executed the actual final
cleanup block with mocked browser contexts and real temporary directories.
Success, evidence-write rejection, attachment rejection, and one rejected close
with a delayed second close each settled both closes and removed all profiles.

All six profile paths from the three browser scenarios were independently
checked absent. Assigned ports were checked free after stopping the owned HTTPS
processes by PID; see [cleanup.log](cleanup.log). The temporary Python
verification orchestrator encountered a missing `psutil` import only after all
eight checks had returned 0; server process cleanup was completed separately,
not falsely reported as successful by that runner. See [dev-https.log](dev-https.log).
No screenshots were requested, captured, or committed.

## Scope and unverified items

Only test-harness source and documentation/evidence changed after merging main.
SDP/ICE stays in runner `page.evaluate` calls, not `/signal` or a shipped UI/chat
route. No TURN, relay, WSS message fallback, plaintext downgrade, or application
persistence was added. A failed direct positive case remains a delivery blocker.

**Unverified / release prerequisite:** Rerun on the intended demo/judge network
before delivery; this evidence covers same-host sandbox connectivity only.
Remote-host/NAT connectivity and physical firewall blocking were not tested.
The blocked case is deterministic SDP-candidate withholding, not an OS/network
firewall test or TURN integration test.
