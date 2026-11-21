# P2P encrypted chat research notes

Verified 2026-11-21 using fetched primary documentation:

- MDN Using WebRTC data channels: RTCDataChannel uses DTLS; keep messages small and use bufferedAmount for backpressure. https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels
- MDN SubtleCrypto deriveKey: secure context required; native ECDH P-256, HKDF, AES-GCM available; X25519 compatibility may vary. https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey
- MDN URI fragment: the fragment is not sent in the resource HTTP request; client JavaScript still sees it. https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment
- MDN WebRTC protocols: ICE uses STUN/TURN for NAT traversal; TURN relays traffic and has overhead. https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols

Design: two-person room, no accounts, browser-native P-256 ephemeral ECDH plus PSK-encrypted signaling and explicit out-of-band fingerprint verification; directional AES-GCM chat keys. WebRTC primary, identical encrypted messages can fall back to WSS when ICE fails. Real relay inspector demonstrates server-received ciphertext, not an invented packet capture. TURN can be configured but not required for a deterministic hackathon demo. Claims exclude compromised clients/code distribution, recipient retention, and traffic metadata. No per-message forward secrecy claim.
