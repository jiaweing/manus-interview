# Issue #127 — direct-WebRTC preflight evidence

## Final verification

Run from `products/glassroom` on 2026-11-21 UTC with
`PUBLIC_PORT=4127`, `NEXT_INTERNAL_PORT=5127`, and
`CHROMIUM_PATH=/usr/bin/chromium`. Both independent persistent desktop Chromium
processes reported version **156.0.8078.73**. The actual tested origin was
`https://localhost:4127` on the Manus Ubuntu sandbox's local network, using two
profiles on the **same host**. This is not evidence for a separate judge network.

- [Full commands, output, and exit codes](verification.txt)
- [Final two-case Playwright HTML report](playwright-report/index.html)
- [Explicit blocked-case rerun report](blocked-report/index.html)
- [Scaffold regression report](boot-report/index.html)
- [Direct network/version record](records/preflight-two-profile-direct-channel-chromium/preflight-network-version.json)
- [Blocked network/version record](records/preflight-blocked-connecti-8ad7c-s-without-relay-or-fallback-chromium/preflight-network-version.json)

The two-case report contains its own JSON attachments; the standalone blocked
record is from the additional `--grep blocked-connectivity` verification run.
The HTML files are local Playwright reports, not shipped application pages.

## Acceptance criteria

- [x] **PASS:** Two distinct persistent desktop profile directories, empty
  `iceServers` arrays (no TURN or STUN provider), `ordered=true`,
  `maxRetransmits=null`, and `maxPacketLifeTime=null`. Both negotiated candidate
  pairs were host-to-host, not relayed.
- [x] **PASS on the recorded network:** A received
  `glassroom-preflight-from-b`; B received `glassroom-preflight-from-a` through
  their RTC data channels in **220.860 ms**, below the ten-second bound.
- [x] **PASS:** Withholding all ICE candidates in both SDP directions produced
  explicit `failed` / `delivery blocked` states, no received probes, closed
  peer connections, and zero relay candidates or fallback attempts. The
  independent blocked-case rerun ended in **9533.812 ms**, below ten seconds.
  The negative test passes only because the preflight itself failed as required.

`bun install --frozen-lockfile`, root `bunx tsc --noEmit -p tsconfig.json`, and
`bun run check-types` exited 0. The specified preflight command passed 2/2 tests;
its explicit blocked-case rerun passed 1/1; the existing boot test passed 3/3.
Terminal ANSI styling and trailing whitespace are normalized in the saved text.
The HTTPS stack was running during browser verification. Its processes were
stopped by PID after the run, and all temporary Chromium profiles were deleted.
No screenshots were requested or captured.

## Initial run and correction

[Initial output](initial-verification.txt) is preserved for honesty: the direct
channel exchanged both strings, but a delayed Chromium `/favicon.ico` asset
request was mistakenly classified as a fallback attempt and failed the test.
The request monitor now excludes that GET asset, as it already excluded Next
assets/HMR. All other HTTP requests/new non-framework WebSockets remain blocked
and counted. The final complete verification above passed after this correction.
The initial report/trace paths in that historical log were superseded by the
final reports.

## Scope and unverified items

Only a Playwright harness and documentation were added. SDP/ICE goes through
runner `page.evaluate` calls, not `/signal` or a shipped UI/chat route. There is
no TURN configuration, server relay, WSS message fallback, or plaintext downgrade.
The deterministic blocked case withholds candidates; it is not an OS firewall
or remote-network integration test. A 9.5-second endpoint timeout reserves
500 ms for runner failure collection/closure within the ten-second upper bound.

**Unverified / release prerequisite:** The intended judge/demo network and
remote-host connectivity were inaccessible from this task. Rerun the preflight
there and preserve its evidence before delivery. A failed direct positive case
must continue to block delivery, never authorize fallback. No TURN integration
is requested or tested.

**Layout adaptation:** All issue paths and commands were adapted to this
repository's `products/glassroom` product root, not a separate Glassroom Git
repository, as required by the swarm protocol.
