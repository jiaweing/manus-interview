# Authenticated data envelopes (#130)

This framework-free browser codec implements PRD §9 data envelopes only, using #129's `EphemeralHandshake` directional non-extractable AES-256-GCM keys. It does not implement WebRTC, signaling, UI, or the human fingerprint gate.

## Integration

After both transcript confirmations succeed, call `DataEnvelopeSession.create(handshake)` once per participant. It returns `{ ok: true, value: session }` or `{ ok: false, error: <static code> }`. A handshake can never create a second codec, even before disposal, so old keys cannot restart sequence zero through this API. Integration requires canonical base64url room IDs encoding exactly 16 bytes (22 characters), despite the looser standalone handshake validator.

`session.encrypt(body)` returns an authenticated outer envelope. `encodeDataEnvelope(envelope)` returns its JSON wire string. `session.decrypt(wireOrEnvelope)` returns a Zod-validated body only on success. It also accepts UTF-8 `Uint8Array`/`ArrayBuffer` frames. Dispatch/render/acknowledge **only** the success value; failures never contain a body, payload, schema issues, or engine exception. This API authenticates controls; it does not decide when chat is unlocked or what an acknowledgement means. The caller must compare fingerprints out-of-band and require mutual encrypted verification before enabling messages.

```ts
// Exactly three outer fields; sequence is a lossless canonical uint64 decimal.
{ sessionId: string, sequence: string, ciphertext: string }

// Strict encrypted bodies: no unknown fields.
{ type: "message", id: string, text: string }
{ type: "acknowledgement", messageId: string }
{ type: "verification", confirmed: boolean }
{ type: "end" }
```

Session IDs are #129's lowercase 128-bit hex IDs. Message IDs are 1–64 ASCII base64url-alphabet characters; acknowledgements identify the peer message by that ID. Message text must be nonempty and at most **4096 UTF-8 bytes**, including multibyte text. The codec returns text without interpreting HTML. Both `true` and `false` verification controls are encrypted; ending has no visible control field or reason payload.

## Cryptographic contract

Each direction starts at sequence zero. Sends are serialized and reserve sequences **before** awaiting WebCrypto. IV is exactly 12 bytes: four zero bytes followed by unsigned 64-bit sequence in big-endian order. GCM uses a 128-bit authentication tag and UTF-8 canonical JSON-array AAD:

```text
["glassroom/data", 1, sessionId, "creator-to-joiner" | "joiner-to-creator", sequence]
```

Direction is inferred from the authenticated handshake role, not exposed in the outer envelope. Reflection and changing session/direction/sequence cannot authenticate. Receives are also serialized, including concurrent duplicates. Incoming sequences must exceed the last authenticated, valid-body sequence; gaps are permitted. Authentication or validation failure does not advance it, and forged high sequences do not poison receive state or close the session.

`MAX_DATA_SEQUENCE = 18446744073709551615`. A conservative optional `counterLimit` may only lower this limit, never seed or restore state. The last outgoing sequence is usable once; the following send returns `counter_exhausted` and disposes the codec. Encryption failures also dispose it, so a reserved nonce cannot be retried. Incoming out-of-cap sequences are rejected without disposal.

## Bounds and teardown

Exported limits are in bytes:

- `MAX_MESSAGE_BYTES = 4096`.
- `MAX_DATA_BODY_BYTES = 6 * 4096 + 512 = 25088`, allowing worst-case JSON escapes and bounded metadata.
- `MAX_DATA_CIPHERTEXT_BYTES = 25104`, including the 16-byte GCM tag.
- `MAX_DATA_ENVELOPE_BYTES = 33600`, including base64url/header overhead and bounding the entire UTF-8 wire frame before JSON parsing.

Ciphertext must be canonical unpadded base64url, decode to 16–25104 bytes, and contain no extra outer fields. Invalid UTF-8, malformed JSON, noncanonical counters/encodings, oversized frames, and invalid authenticated body variants are rejected without dispatch. Exact-cap padded JSON is accepted; cap-plus-one-byte is rejected.

On leave, transport loss, or teardown call `session.dispose()` and discard session, transcript, drafts, and any external key references. Disposal destroys the owned handshake and drops its key references; queued/in-flight work cannot return ciphertext or a decrypted body afterward. Settled queue promises retain no result, and temporary encoded/decrypted byte buffers are best-effort zeroed. JavaScript/engine copies cannot guarantee physical erasure. No persistence, key-import, counter-resume, or old-key reconnection API exists; every subsequent room needs a fresh invitation and handshake.

## Verification

From `products/glassroom` (the product root inside this monorepo, adapting the issue's paths):

```sh
bun test tests/unit/data-envelope.test.ts
PUBLIC_PORT=4130 NEXT_INTERNAL_PORT=5130 bunx playwright test --project=chromium tests/e2e/data-envelope.spec.ts --reporter=list
```

The unit suite includes the ten exact names requested by #130 and additional full-uint64, body bounds, snapshot, one-shot ownership, encryption failure, and in-flight teardown regressions. The Chromium spec bundles the actual source into a temporary runner-only route; no production endpoint, test global, or UI is added. It verifies real browser WebCrypto, four variants, concurrent sequences, bidirectional controls, rejection/no dispatch, cap-plus-one byte, replay rejection, and preserved receive state. These codec checks are not a complete two-room messaging or intended-network delivery verification.
