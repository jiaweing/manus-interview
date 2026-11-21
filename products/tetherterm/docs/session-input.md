# Session input — issue #108

`SessionManager.write({ sessionId, text?, keys? })` returns a promise of `{ acceptedBytes, state }`. The implementation is isolated in `apps/server/src/sessions/input.ts`; it registers no tools and implements no wait modes. `terminalWriteSchema` is exported for transport adapters. Invalid types, unsupported keys, and supplying both/neither input fields produce Zod validation errors before any PTY write. Empty text or an empty keys array is an explicit zero-byte submission. Encoded input exceeding 16,384 bytes produces `TerminalError("LIMIT", ...)`. Unknown sessions produce `NOT_FOUND`; terminating, exited, or closed sessions produce `NOT_RUNNING`.

The PRD names arrows without spelling their enum values. This implementation uses `ARROW_UP`, `ARROW_DOWN`, `ARROW_LEFT`, and `ARROW_RIGHT`, and supports no aliases or additional keys. The exact byte sequences are:

| Key | Bytes (hex) |
| --- | --- |
| ENTER | `0d` |
| TAB | `09` |
| ESC | `1b` |
| BACKSPACE | `7f` |
| ARROW_UP | `1b 5b 41` |
| ARROW_DOWN | `1b 5b 42` |
| ARROW_LEFT | `1b 5b 44` |
| ARROW_RIGHT | `1b 5b 43` |
| CTRL_C | `03` |
| CTRL_D | `04` |

Text uses UTF-8 without adding a newline; keys are concatenated in the submitted order and share the same encoded-byte cap. Encoding occurs before queueing, snapshotting mutable keys arrays. A weakly held FIFO promise chain serializes each session independently, rechecking running state immediately before the write. Rejection does not poison the queue, and settled tails are removed. This is a write-acceptance queue, not a child-consumption or output-drain wait.

Bun 1.4.5's pinned `Terminal.write` declaration guarantees acceptance of all submitted bytes and internal buffering of any portion that cannot immediately flush. Its `drain` callback announces when that internal buffer has flushed. Therefore each submission invokes native `write` exactly once: no manual partial-write loop, no suffix resend, no drain-based retry, and no automatic retry after an uncertain exception. `acceptedBytes` is the native return count, not a character count or claim that the child has consumed input. A synthetic short return is reported without resending; a native exception is sanitized and rejected without exposing input or its raw cause. Later explicit requests remain independent submissions.

The named `test/terminal-write.test.ts` includes an exact fake byte-log suite for partial returns, errors, all keys and ordering, plus real `spawnPty` children for Bash prompts, Python REPL, cat/EOF, raw cat and od byte inspection, large/backpressured writes, concurrent noninterleaving and exited sessions. An integration wrapper ensures the named suite participates in `bun run test`. Each real process and ordinary descendant is tracked, terminated only by its own PID/process group, awaited, and checked for surviving live processes.
