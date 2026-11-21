# Invitation-authenticated signaling (issue #128)

This framework-free browser WebCrypto module implements PRD section 9 signaling only. It does not perform admission, WebRTC negotiation, ECDH/session keys, or chat encryption.

## API

`createSignalingCrypto({ invitationSecret, roomId, role })` returns `Promise<CryptoResult<SignalingCrypto>>`. The secret must be a 32-byte `Uint8Array`. The room ID must be canonical, unpadded base64url encoding of 16 bytes. Roles are `creator` and `joiner`.

Use `encrypt(Uint8Array)` to obtain an envelope, `encodeSignalingEnvelope(envelope)` for WSS JSON, and `decrypt(jsonOrEnvelope)` to obtain authenticated bytes. All boundary results are `{ ok: true, value }` or `{ ok: false, error: <static code> }`; failures have no plaintext/value, raw payload, exception, or validation details. Call `close()` on leave/transport loss and discard the instance. Keys are non-extractable and kept only in memory. JavaScript cannot guarantee memory erasure.

The wire envelope is strictly validated by the exported Zod `signalingEnvelopeSchema`:

```ts
{
  version: 1,
  roomId: string,
  role: "creator" | "joiner", // sender's role, hence direction
  operation: "forward",
  counter: string, // canonical uint64 decimal, starting at "0"
  ciphertext: string // canonical unpadded base64url, GCM tag appended
}
```

The server forwards this encrypted envelope without needing the crypto module or invitation secret. Joining/admission envelopes are outside this module. Payload bytes are not interpreted here. Plaintext is bounded to 64 KiB; ciphertext includes a 16-byte authentication tag. JSON input is bounded before parsing; unknown fields, unsupported versions, noncanonical encodings, and out-of-range counters are rejected.

## Cryptographic contract

HKDF-SHA-256 imports the 256-bit invitation secret, uses the decoded 128-bit room ID as salt, and derives two non-extractable AES-256-GCM keys. HKDF info is UTF-8 `glassroom/signaling/v1/creator-to-joiner` or `glassroom/signaling/v1/joiner-to-creator`.

Each direction starts at counter zero. IV is `zero32 || uint64(counter)` in big-endian order. GCM authenticates the UTF-8 JSON array `["glassroom/signaling", version, roomId, role, operation, counter]`, with a 128-bit tag. The distinct directional keys permit the same numeric counter in opposite directions without reusing a key/nonce pair.

Sends and receives each use a serialized queue. Sends reserve counters before WebCrypto and close on encryption failure; failed sends cannot reuse a nonce. Incoming counters must be strictly greater than the last authenticated accepted counter. Receive state advances only after authenticated decryption; forged high counters do not poison state. At the outgoing limit, the last counter is usable once; the next send returns `counter_exhausted` and closes the instance, and subsequent operations return `closed`. A malformed/unauthenticated incoming frame does not force closure.

An optional `counterLimit` can only lower the uint64 limit. It is an exhaustion-test/early-rotation seam, never a counter seed or resumption mechanism. No persisted counters or reconnect support exist. **Never recreate a signaling instance for the same room/secret after teardown**, as that would reset nonce state; create a fresh invitation instead. The transport/lifecycle integration must enforce this fresh-room policy.

## Verification

From this repository's product directory (`products/glassroom`, adapting the issue's original product-root paths):

```sh
bun test tests/unit/signaling-crypto.test.ts
```

The required eight named cases and additional bounds, concurrency, exact-uint64, room-salt, snapshot, and teardown regressions are in that suite. Browser/transport integration is not exercised by this issue's unit verification.
