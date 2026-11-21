# Issue #129 — confirmed ephemeral session keys

Scope: PRD F03/F05 and §9; standalone client WebCrypto module only. Paths from the issue's independent-product assumption are adapted to `products/glassroom/` in this monorepo. No signaling, server-admission, preflight, application UI, dependencies, lockfile, or shared configuration files are changed.

## Integration contract

Module: `apps/web/src/lib/crypto/handshake.ts`. It has no framework or Node imports and runs with browser WebCrypto and `bun test`.

1. Call `EphemeralHandshake.create(roomId, "creator" | "joiner")` once per fresh room session.
2. Exchange only `getHello()` values through authenticated, encrypted signaling, and call `acceptPeer(peerHello)`.
3. Exchange `createConfirmation()` values and call `acceptConfirmation(peerProof)`. Both local proof creation and valid opposite-role proof acceptance are required for `state === "authenticated"`.
4. `getSessionMetadata()` exposes the common session ID and transcript hash. `getFingerprint()` and `getSessionKeys()` are unavailable before authentication. Returned AES keys are non-extractable, with send/encrypt-only and receive/decrypt-only usage.
5. **Cryptographic transcript confirmation is not identity verification.** Compare the grouped fingerprint through a trusted out-of-band channel and require mutual human verification before enabling chat (integration is outside this issue).
6. On termination, call `destroy()` and discard this instance and any retrieved key references. Failed confirmation drops owned key references and cannot resume. JavaScript cannot guarantee physical memory erasure.

The transcript is UTF-8 JSON with a fixed array schema: `["glassroom/handshake", 1, roomId, ["creator", publicKey, nonce], ["joiner", publicKey, nonce]]`. Arrival order and object property order are irrelevant. P-256 public keys use uncompressed SEC1 lowercase hex; participant nonces are fresh 256-bit lowercase hex.

HKDF-SHA-256 uses the ECDH secret as input and the SHA-256 transcript hash as salt. Versioned, distinct labels separate creator-to-joiner and joiner-to-creator data AES-256-GCM keys, directional HMAC-SHA-256 confirmation keys, the 128-bit session ID, and the 128-bit fingerprint (eight groups of four uppercase hex digits). Confirmation authenticates session ID, sender role, and transcript hash. Envelopes accept only their exact public-field schema; private keys and shared secrets never enter them.

## Acceptance criteria

- [x] **PASS — Same transcript hash/fingerprint, distinct directional keys.** `creator-first canonical transcript`, `matching fingerprint`, and `directional and purpose separation` pass. Independently reproduced HKDF confirms distinct labels; both data directions decrypt with the matching receiver, and the wrong direction/purpose is rejected or produces distinct ciphertext.
- [x] **PASS — Room, role, public-key, and nonce binding.** The four named binding tests pass. Public-key and nonce mutation tests force claimed session metadata back to the expected values and still fail HMAC verification. Wrong-room and wrong-role inputs fail closed; cross-room proof transplant and reflection fail.
- [x] **PASS — Fresh material per session.** `fresh session material` passes for both roles in two new sessions in the same room: different public keys, participant nonces, session IDs, fingerprints, and session-key ciphertext comparison results. Key/secret comparisons assert booleans only and print no material.
- [x] **PASS — Private keys/shared secrets are memory-only and absent from envelopes.** `no private material in envelopes` checks exact JSON-serialized public envelope field sets, hidden private instance fields, AES algorithm/length/usage, and rejected key export. Isolated Chromium reports non-extractable keys and empty localStorage, sessionStorage, IndexedDB, service-worker registrations, cookies, and persisted origins.

Additional passing tests cover invalid HMAC, both-confirmations gating, malformed/unknown envelope fields, one-shot derivation, copied envelopes, teardown, and teardown during in-flight derivation.

## Reproduction and output

From `products/glassroom`:

```bash
export PATH="$HOME/.bun/bin:$PATH"
export PUBLIC_PORT=4129 NEXT_INTERNAL_PORT=5129
bash evidence/issues/129/verify.sh
```

The runner saves complete command output (trailing CLI padding whitespace normalized) and the actual exit code in the following text files. Bun version: 1.4.5. No keys or shared secrets are logged.

| Command | Exit | Result | Complete output |
| --- | ---: | --- | --- |
| `bun install --frozen-lockfile` | 0 | Locked install, no changes | [install.txt](install.txt) |
| `bun test tests/unit/handshake-crypto.test.ts` | 0 | 14 pass, 0 fail, 117 assertions; all ten issue-named cases pass | [handshake-unit.txt](handshake-unit.txt) |
| `bun run check-types --force` | 0 | 3 package checks successful, all freshly checked without cache | [product-types.txt](product-types.txt) |
| `bunx tsc --ignoreConfig --noEmit --strict --target ES2017 --module esnext --moduleResolution bundler --lib esnext,dom --types bun --skipLibCheck tests/unit/handshake-crypto.test.ts` | 0 | Strict independent test typing | [unit-types.txt](unit-types.txt) |
| `bun run evidence/issues/129/browser-smoke.ts` | 0 | 15 isolated Chromium checks passed | [browser-smoke.txt](browser-smoke.txt) |
| `bunx biome check apps/web/src/lib/crypto/handshake.ts tests/unit/handshake-crypto.test.ts` | 1 | Blocked before checking by pre-existing unsupported `useTailwindSortedClasses` config key | [biome-original.txt](biome-original.txt) |
| Compatibility-config preparation via the exact Python command in `verify.sh` | 0 | Temporary copy removes only that unsupported shared config entry | [biome-config-prepare.txt](biome-config-prepare.txt) |
| `bunx biome check --config-path=.issue-129-biome.json apps/web/src/lib/crypto/handshake.ts tests/unit/handshake-crypto.test.ts` | 0 | 2 files checked, no fixes applied; temporary config deleted after verification | [biome-compatible.txt](biome-compatible.txt) |

## Limits / unverified

- Default repository-config lint remains blocked by the existing Biome rule incompatibility; this PR deliberately does not edit shared configuration. Compatible targeted lint passes with all remaining shared rules retained.
- The Chromium smoke is an **isolated module runtime test**: an in-process fulfilled HTTPS page at the assigned public origin, not a real application server or a signaling/WebRTC/browser-flow integration test. Full app transport and mutual human fingerprint gating are outside #129 and not verified here.
- Memory-only checks do not prove physical memory erasure, audited cryptographic security, or safety against malicious delivered code/endpoint compromise.
- Screenshots: none; this issue requests no UI or screenshot evidence.
