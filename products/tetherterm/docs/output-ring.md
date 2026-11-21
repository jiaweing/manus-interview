# Output ring — issue #107

`apps/server/src/sessions/ring.ts` exports the pure synchronous `OutputRing` class. It has no PTY, process, timer, transport or wait dependencies. Each `Session` owns a required `output: OutputRing`, allocated before policy-aware spawning so data arriving before registration is retained. Nothing logs or persists terminal content.

`SessionManager.read({ sessionId, cursor, maxBytes? })` synchronously returns `{ output, nextCursor, oldestCursor, headCursor, gap, state }`. Unknown/expired/cap-evicted sessions return `NOT_FOUND`. Reads do not wait for output or exit. The underlying `output.read(cursor, maxBytes?)` returns the same fields except `state`. No MCP tools or wait modes are registered here.

## Normalization, bounds and cursor rules

Ingest uses one streaming UTF-8 `TextDecoder` per ring (`stream: true`, replacement semantics, `ignoreBOM: true`), then re-encodes the complete decoded text as valid UTF-8. Invalid maximal subparts become U+FFFD. A lone `0xff` is therefore **stored as three bytes**, and a read returning `"�"` advances by three bytes. Original invalid bytes are not retained. A fragmented valid character is withheld in the decoder until complete; at most three incomplete raw bytes remain outside the ring. Neither `headCursor` nor `retainedBytes` counts this pending raw prefix. BOMs are preserved, not stripped.

The payload is a fixed 1,048,576-byte circular array; a separate fixed-size byte-per-position marker array records character boundaries. All cursor/offset arithmetic, eviction and read truncation operate exclusively on **normalized UTF-8 bytes**. `retainedBytes` never exceeds one MiB, even with oversized or replacement-expanding input. Ingest decoding/re-encoding is sliced into bounded blocks rather than allocating a normalized copy of an arbitrarily large append. Caller-owned chunks are not retained.

Eviction moves forward to a whole-character boundary, potentially retaining up to three fewer bytes than capacity. The first retained byte and every read boundary are char-aligned: characters are never split. ANSI escapes, control characters, carriage returns and NULs remain uninterpreted data. A read may stop between ASCII bytes of an ANSI sequence; concatenating incremental results preserves the sequence byte for byte.

Cursors are canonical nonnegative decimal strings (`"0"`, `"123"`), not numbers. Signs, whitespace, leading zeroes, fractions, exponent notation and other malformed strings return `BAD_CURSOR`. Absolute offsets use `bigint`; public values remain strings. Huge/future offsets are rejected by decimal comparison before parsing. A retained cursor inside a character returns `BAD_CURSOR`. A cursor equal to `headCursor` is a valid character boundary and returns empty output with no movement.

For a supplied cursor below `oldestCursor`, `gap` is true and the effective start is `oldestCursor`. Historical character-boundary validity cannot be checked after eviction; any well-formed stale offset receives this explicit gap. At or above the oldest surviving boundary, `gap` is false. **Always, including invalid input: `nextCursor = effectiveStart + UTF8(output).byteLength`.** Empty reads, including budgets smaller than the next character, make no progress. An empty gap read returns the oldest effective cursor rather than the stale cursor.

`maxBytes` defaults to 65,536 and must be a positive safe integer (`LIMIT` otherwise). Larger requests clamp to 65,536. Every result contains complete characters and its encoded byte length never exceeds the requested limit or 64 KiB. No lookahead character is consumed at the cap.

## PTY EOF and retained output

`spawnPty` uses inline `Bun.spawn({ terminal: { data, exit, cols, rows } })` ownership and exposes `onEof` and an `eof` promise from its native terminal `exit` callback (PTY stream EOF/read-error, not child exit status). Unlike a reusable terminal, the inline form releases Bun's parent slave descriptor and permits true EOF without closing the output reader. See the dated [PTY amendment](pty-decision.md). Production calls the same preallocated ring's idempotent `finish()` synchronously at that callback, after final data. A dangling incomplete multibyte suffix becomes **one U+FFFD, three normalized bytes**. Repeated finalization has no effect; appending after finalization is an error.

Subprocess `child.exited` only updates state/code/signal, releases live capacity once and starts retention. It must not finalize output: PTY data can arrive after process exit. Input `drain`, sleeps and silence are not EOF signals. The original production ring stays readable for the five-minute/sixteen-record retention window; registry expiry/eviction cancels timers and disposes native resources idempotently. See [session-manager.md](session-manager.md) for the coherent lifecycle integration.

## Verification

From `products/tetherterm`:

```sh
bun test apps/server/test/output-ring.test.ts
bun test apps/server/test/integration/output-ring.test.ts apps/server/test/session-exit-retention.test.ts
bun run check
bun run check-types
bun run test
```

The issue-named pure suite is imported by `test/unit/output-ring.test.ts`. Native integration proves pre-registration data, quiet running reads, fragmented multibyte callbacks, truncated EOF, raw `0xff`, data after actual child exit, signal exit, production-ring retention reads and single-slot release. Retention coverage uses a controllable clock and actual registry cap eviction. Tests clean only owned processes and temporary roots and expire retained records to cancel their timers. Current verification and ten consecutive targeted runs are recorded in `evidence/tests/107-builder-round3.log`; `107-builder-round2.log` preserves the historical reusable-terminal blocker, not a passing native EOF claim.
