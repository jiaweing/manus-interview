# Glassroom

Memory-only, two-person, end-to-end encrypted chat over a WebRTC data channel, with WebCrypto and encrypted signaling. Scope contract: [`docs/prds/06-p2p-encrypted-chat.md`](../../docs/prds/06-p2p-encrypted-chat.md). This is a demo build, not an audited secure messenger.

## Layout

- `apps/web` Next.js client (owns WebCrypto and WebRTC)
- `apps/server` Bun + Hono: one HTTPS origin, a `/signal` WebSocket endpoint, and a reverse proxy to Next
- `packages/ui`, `packages/config` shared UI primitives and TS config
- `tests/e2e` Playwright (chromium)

The Better-T-Stack scaffold was generated with `scaffold/06-glassroom.sh` (`--no-git`, Biome, no editors/agent files/hooks, WXT React, skills scope Project). Dormant parts the PRD does not use (auth, MongoDB, Polar, native, WXT extension, Fumadocs, AI example, agent/skills files) were removed.

## Run

```sh
bun install --frozen-lockfile
bun run build
bun run dev:https      # https://localhost:3443 (self-signed cert generated in .certs/)
bun run start:https    # production-mode run (after bun run build)
```

Test (with `dev:https` running or let Playwright start it):

```sh
bunx playwright install chromium
bunx playwright test tests/e2e/boot.spec.ts --project=chromium
```

Production uses one configured HTTPS origin: set `TLS_CERT_FILE` and `TLS_KEY_FILE` (see `.env.example`). There are no required secrets.

## Direct-WebRTC preflight (delivery gate)

Run this on the **intended demo network** before delivery. A failing direct case
blocks delivery; it never enables TURN, a relay, or a WSS/plaintext fallback.
Paths below are relative to `products/glassroom` in this monorepo (not a separate
Glassroom Git root).

```sh
export PUBLIC_PORT=4327 NEXT_INTERNAL_PORT=5327
export PREFLIGHT_NETWORK="describe the actual demo network and host arrangement"
bun run dev:https
# In another terminal with the same environment:
bunx playwright test tests/e2e/preflight.spec.ts --project=chromium
bunx playwright test tests/e2e/preflight.spec.ts --project=chromium --grep blocked-connectivity --reporter=list
```

The harness launches full desktop Chromium with two independent temporary
persistent profile directories (headless, not mobile emulation or two incognito
contexts). Set `CHROMIUM_PATH` to use a particular installed desktop Chromium;
otherwise Playwright's desktop Chromium is used. Profile directories are deleted
on completion. Browser APIs exchange an ordered reliable data channel probe in
both directions. SDP/ICE stays in the runner; no product route or test-control
UI is added. ICE servers are empty. Negotiation has a ten-second upper bound;
the endpoint timeout is 9.5 seconds to allow the runner to collect failure and
close both endpoints within that bound.

The blocked case withholds all ICE candidate lines in both SDP directions while
retaining end-of-candidates. This is a deterministic direct-connectivity fault,
not a TURN/network-firewall integration test. It must record an explicit failed
probe, closed peers, no received strings, and zero relay/fallback attempts; the
negative test itself passes only if this failure contract holds. The direct
positive case must pass independently to permit delivery.

Playwright's HTML report includes a `preflight-network-version` JSON attachment
for each case, recording origin, network label/interface families (not IP
addresses), actual Chromium versions, timestamp, profile separation, received
probe strings, negotiated reliability settings, candidate types, selected-pair
types, elapsed time, and pass/fail. The default report is
`evidence/playwright-report/`; issue #127's captured run is in
`evidence/issues/127/`. These probes establish **same-host** browser connectivity
on the recorded network only. They do not prove connectivity between remote
hosts or on a judge's network: rerun there and preserve that report.
