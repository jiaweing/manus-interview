# Output ring — issue #107

`apps/server/src/sessions/ring.ts` exports the pure synchronous `OutputRing` class. It has no PTY, process, timer, transport or wait dependencies. Each `Session` owns `output: OutputRing`, allocated before policy-aware spawning so data arriving before the session record is registered is retained. The native PTY callback appends raw bytes and still updates `receivedBytes` for existing internal consumers. Nothing logs or persists terminal content.

`SessionManager.read({ sessionId, cursor, maxBytes? })` synchronously returns `{ output, nextCursor, oldestCursor, headCursor, gap, state }`. Unknown sessions return `NOT_FOUND`. The result includes the record's current `running | terminating | exited` state; reads do not wait for output or exit. No MCP tools or wait modes are registered here. The underlying `output.read(cursor, maxBytes?)` returns the same fields except `state`.

## Bounds and cursor rules

The payload is a fixed 1,048,576-byte circular array; a separate fixed-size byte-per-position marker array records Unicode boundaries. `retainedBytes` includes any incomplete trailing UTF-8 sequence and never exceeds one MiB, even for a single oversized append. Append copies the bytes rather than retaining caller-owned buffers. Eviction moves to the next complete-character boundary, so it may retain up to three fewer bytes than the capacity. ANSI escapes, control characters, carriage returns, NULs and UTF-8 BOMs are data, not terminal instructions, and are preserved. Reads may cut between ASCII bytes of an ANSI sequence; concatenating incremental results preserves the sequence byte for byte.

Cursors are **canonical nonnegative decimal strings** (`"0"`, `"123"`), not numbers. Signs, whitespace, leading zeroes, fractions, exponent notation and other malformed strings return `BAD_CURSOR`. Internal absolute offsets use `bigint`, and the public values remain strings. Huge/future offsets are rejected by decimal comparison before parsing to avoid expensive huge-integer conversion. A retained cursor inside a character (including an incomplete suffix) returns `BAD_CURSOR`. A cursor equal to the raw head is valid and returns empty output with no movement. A cursor at the beginning of an incomplete suffix is also valid but cannot read that suffix yet.

For a supplied cursor below `oldestCursor`, `gap` is true and the effective start is `oldestCursor`. Historical character-boundary validity cannot be checked after eviction; any well-formed stale offset receives this explicit gap. At or above the oldest surviving boundary, `gap` is false. A read never moves the cursor beyond the raw bytes consumed to produce its returned characters. For valid UTF-8, `nextCursor = effectiveStart + UTF8(output).byteLength` exactly. Empty reads, including budgets smaller than the next character, make no progress. A gap with empty output returns the effective oldest cursor, not the evicted cursor.

`maxBytes` defaults to 65,536 and must be a positive safe integer (`LIMIT` otherwise). Larger valid requests clamp to 65,536. The limit measures the UTF-8 byte length of the **returned string**, and every result contains complete characters. No lookahead character is silently consumed at the read cap.

## Invalid UTF-8 and final drain

Invalid UTF-8 is displayed using U+FFFD, following the standard UTF-8 maximal-subpart replacement behavior used by `TextDecoder`. Overlong encodings, surrogate encodings, out-of-range code points and isolated continuation bytes are not accepted as Unicode characters. The ring preserves their original raw bytes internally; **cursor arithmetic counts the raw bytes consumed**, not the re-encoded size of U+FFFD. Thus a lone `0xff` yields `"�"` (three UTF-8 output bytes) but advances the cursor by one. This is the explicit invalid-input exception to the valid-Unicode encoded-length equality. The encoded read limit still applies: a replacement cannot fit a budget below three bytes and causes no cursor progress in that case.

A UTF-8 character split across callbacks is withheld until completion or until a subsequent byte proves the prefix invalid. `headCursor` counts all received raw bytes, including an incomplete suffix, and therefore may be ahead of the last readable cursor. `output.finish()` flushes a truncated final suffix as one replacement unit; it is idempotent. Lifecycle code must call it **after the final PTY data has drained**, not merely when the subprocess exits. This issue deliberately does not change exit/drain ordering or install lifecycle timers (see #105); the pure ring tests exercise this EOF operation explicitly. Do not resume an interrupted UTF-8 sequence after finalization.

## Verification

From `products/tetherterm`:

```sh
bun test apps/server/test/output-ring.test.ts
bun run test
bun run check
bun run check-types
```

The named suite is imported by `test/unit/output-ring.test.ts` so root verification also covers it. Pure tests spawn no processes. A separate native-PTY integration test checks pre-registration data, running/quiet reads, state reporting and typed session lookup errors; it records and cleans up only its own child PID and temporary directory. Builder evidence is committed in `evidence/tests/107-builder.log`.
