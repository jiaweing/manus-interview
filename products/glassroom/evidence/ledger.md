# Evidence ledger (Glassroom swarm)

| Wave | Issue | PR | Builder | Verifier | Result | Date (UTC+8) |
|---|---|---|---|---|---|---|
| 1 | #126 scaffold + HTTPS/WSS origin | #186 | Lead | v126 (agent) | verified; reviewer findings fixed, merged | 2026-11-21 |
| - | chore: biome config (unblock lint gate) | #208, #213 | Lead | - | merged; `bun run check` exit 0 | 2026-11-21 |
| 2 | #129 session keys + fingerprint | #201 | b129 | v129 (agent) | verified, merged | 2026-11-21 |
| 2 | #128 signaling encryption | #196 | b128 | v128 (agent) | functional PASS; blocked on lint only, fixed (f128), merged | 2026-11-21 |
| 2 | #132 admission + ciphertext-only forward | #204 | b132 | v132 (agent) | functional PASS; blocked on conflict+lint, fixed (f132), merged | 2026-11-21 |
| 2 | #127 two-profile direct-WebRTC preflight | #195 | b127 | v127 (agent) | functional PASS; blocked on lint only, fixed (f127), merged | 2026-11-21 |

Main after wave 2 (all merged): lint exit 0; check-types 3/3; build 2/2; `bun test tests/unit` 39 pass 0 fail; Playwright chromium 8/8 (boot 3, preflight 2, signal-server 3).

Unverified / carried forward:
- #127 only proves two same-host Chromium profiles in the sandbox; the intended judge network is not tested. Blocked-connectivity case uses SDP candidate withholding, not an OS firewall.
- #128 deterministic invitation keys + counter zero: later lifecycle (#133/#134/#139) must force a fresh room id and secret after teardown.
- #129 room id validation is looser than the 16-byte base64url ids used by #128/#132; align in #134.
