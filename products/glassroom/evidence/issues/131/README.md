# Crypto release invariants — issue #131

Scope: only cross-module regression coverage in `tests/unit/crypto-release.test.ts`, using the merged #128 signaling, #129 handshake, and #130 data-envelope APIs. The product root is `products/glassroom/` inside the monorepo, adapting the original issue paths. No production crypto module, UI, transport, dependency, or lint rule was changed.

## Acceptance criteria

- [x] **PASS — Matching secret/transcript:** both roles exchange encrypted authenticated hellos and HMAC transcript confirmations, expose mutually confirmed sessions, and obtain equal correctly grouped fingerprints. Both local-first and peer-first confirmation orders are tested. New, partially confirmed, and failed handshakes cannot supply keys, fingerprints, or data sessions.
- [x] **PASS — Wrong secret/altered transcript:** wrong-secret signaling releases no authenticated bytes and never advances either handshake. Malformed, reflected-role, ciphertext-tampered, high-counter-forged, and replayed signaling cannot dispatch handshake input. Substituted participant nonce/public key views fail confirmation in both roles even after claimed session ID/transcript hash are restored to receiver expectations, proving HMAC rejection rather than just metadata comparison. Failed handshakes discard session metadata and cannot expose fingerprints or data sessions.
- [x] **PASS — Key/nonce uniqueness and fresh rooms:** a scoped WebCrypto spy captures actual AES-GCM key-material identities and IVs for hello/confirmation signaling and concurrent mixed verification/message/acknowledgement/end data sends. All 16 captured production-path key-identity/nonce pairs are unique; the four signaling/data directional key identities are distinct. Both directions use the exact big-endian `zero32 || uint64(counter)` IV and sequences beginning at zero. Three rooms yield twelve distinct directional signaling/data key identities, different ephemeral keys/nonces/session IDs/fingerprints, and old-frame rejection even after relabeling to a fresh session. Teardown cannot restart a data codec with the old handshake.

The identity probe uses a fixed synthetic plaintext and a nonzero IV prefix outside the modules' zero32 production nonce namespace, once per CryptoKey object, through the original WebCrypto function. Equal key material would yield equal identities even when CryptoKey objects differ. Identities, secrets, fingerprints, and key bytes are never printed or exported; sensitive comparisons report booleans only.

Additional release coverage checks reflection, ciphertext/counter tamper, concurrent duplicate rejection, and no failure success-value for all data body types in both directions. Exact 4096-byte ASCII, two-byte UTF-8, four-byte UTF-8, and JSON-escaped control-character messages round-trip; cap-plus-one-byte and larger messages fail before encryption. Both true and false verification controls are encrypted and authenticated.

## Verification

`gates.md` contains each recorded verification command, exit code, and the last approximately fifteen output lines. `crypto-release.log` is the complete redacted four-suite test summary for the release walkthrough. `crypto-release.tsconfig.json` is an evidence-only portable strict type-check project for the new suite; it does not change application/test configuration.

Required results: frozen installation, Biome check, workspace type check, production build, all unit tests (64 passing), the issue's exact four-suite command (53 passing), and all four available Chromium specs (9 passing) on `PUBLIC_PORT=4131 NEXT_INTERNAL_PORT=5131`. The standalone strict type check of the added suite also passes. No screenshots or HTML reports are committed for this issue. All runner-owned HTTPS/Next listeners stopped after Playwright completed.

## Defects and unverified boundaries

No required release invariant exposed a defect in a merged crypto module; no production fix was needed.

The additional, non-required `bunx tsc --noEmit -p tsconfig.json` check exits 2 with six **pre-existing** TS18048 errors in `tests/unit/data-envelope.test.ts` and `tests/unit/signaling-crypto.test.ts` (possibly-undefined tuple elements). Those files are unchanged relative to verified main. The mandatory `bun run check-types` workspace gate and the added-suite strict type gate both pass. This existing root-wide test typing gap is reported, not silently fixed outside #131.

The authenticated-signaling dispatch helper exists only in this test suite: standalone handshake APIs accept decoded objects and do not know the invitation secret. Real transport integration must enforce that boundary. These modules do not implement the human fingerprint comparison/mutual-verification sending lock; tests prove transcript gates and authenticated verification controls, **not** that messages are blocked until humans confirm. Full create/join/chat UI delivery, storage/headers, intended-network operation, production deployment, and physical memory erasure are not claimed. Fresh-room tests demonstrate cryptographic separation; lifecycle integration must still prohibit reusing an invitation after teardown. Browser gates cover the existing boot, codec, local direct/blocked preflight, and admission specs, not a complete integrated chat release.
