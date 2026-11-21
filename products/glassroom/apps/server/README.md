# Memory-only signaling server

The HTTPS front serves the client and the same-origin `wss://<host>/signal` endpoint. The upgrade still requires `Origin: https://<host>`; plain HTTP, foreign origins, and missing origins are rejected. Non-upgrade requests to `/signal` return 426. There is no chat/message route or server decryption operation.

## Strict JSON wire contract

Use the same canonical room ID and encrypted envelope as the browser signaling module in issue #128. `roomId` is the unpadded base64url encoding of 16 random bytes; roles are exactly `creator` and `joiner`. No invitation secret, plaintext, key, or extra field is allowed.

```ts
// Admission
{ version: 1, roomId: string, role: "creator" | "joiner", operation: "join" }

// Encrypted signaling, forwarded as its exact original JSON text
{
  version: 1,
  roomId: string,
  role: "creator" | "joiner",
  operation: "forward",
  counter: string, // canonical unsigned decimal uint64
  ciphertext: string // canonical unpadded base64url, including the GCM tag
}
```

Zod validates version, schema, role, room ID, operation, counter, and canonical encoding. **Ciphertext length is derived and validated, not a caller-supplied `length` field.** Decoded ciphertext must be 16 through `64 * 1024 + 16` bytes (at most 64 KiB encrypted signaling plus the 16-byte AES-GCM tag). A separate **128 KiB cap on the complete UTF-8 JSON frame** bounds parsing and accommodates base64url overhead. Binary frames and unknown fields are rejected. The same finite whole-frame cap is configured in Bun's transport. Oversized frames close with 1009; schema, binding, and admission violations close with 1008. Reasons are static and contain no submitted values.

The server cannot prove arbitrary bytes are real ciphertext; the clients authenticate/decrypt AES-GCM and enforce accepted counters. The server checks the envelope and socket binding only. It never logs incoming frames or stores ciphertext after routing.

## Admission and lifecycle

On upgrade: `{type:"ready"}`. A creator opens an unused room ID; one joiner may join that existing room. Accepted sockets receive `{type:"joined",version:1,roomId,role}`. The creator receives `{type:"peer-joined"}` after joiner admission. Duplicate roles, third sockets, nonexistent-room joiners, and forwarding before admission are rejected without displacing the admitted pair. Forwarding before the other participant joins fails closed; there is no queue or fallback.

Every forward is bound to the sender's admitted room ID and role. When either admitted socket closes or is rejected, the room and both memberships are removed immediately; the remaining peer receives `{type:"terminated"}` and closes with 1000 (`room-ended`). Late close callbacks are idempotent and cannot delete a later room. Rejected outsiders have no membership to delete. All maps/sets are process memory only.

The server can accept a fresh creator for an unused ID after deletion, but the client lifecycle **must generate a fresh room ID and invitation secret** after teardown; never restart old-key counters. End-to-end crypto/WebRTC integration and production deployment are separate issues.

## Verification

From `products/glassroom` (the product root in this monorepo):

```sh
bun test tests/unit/signal-server.test.ts
PUBLIC_PORT=4132 NEXT_INTERNAL_PORT=5132 CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e tests/e2e/boot.spec.ts tests/e2e/signal-server.spec.ts
```

The issue's eight named unit cases assert no encrypted peer forwards on rejected frames and deletion of the room map on teardown. Additional tests cover exact cap boundaries, no queue, late close, and raw text preservation. Browser tests exercise the actual HTTPS/WSS wiring and preserve secure-context and foreign/insecure-origin checks. Verification outputs are committed in `evidence/issues/132/`.
