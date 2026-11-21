## 1. Overview (one-paragraph pitch, product name suggestion, target user)

**TetherTerm** gives an MCP agent a persistent terminal on the machine running its server. Instead of executing disconnected shell commands, the agent opens a real pseudoterminal, follows output with resumable cursors, answers prompts, interrupts work, inspects the screen, and cleans up. The target user is a developer delegating interactive CLI work to an AI assistant. Jia Wei Ng will build a Linux-first, single-user MVP inside Manus Studio in one focused day: a runnable server, connection instructions, and executable acceptance tests—not a terminal dashboard.

## 2. Problem statement and the original brief (restate the requirement in your own words and list every explicit requirement from the brief as a checklist with IDs R1, R2...)

A command wrapper loses process continuity and cannot reliably distinguish “finished,” “quiet,” and “waiting for input.” The brief asks for terminal sessions as capabilities with explicit lifecycle and bounded output access. Mandatory and consideration items become this checklist; consideration items receive implementation or deferral below.

- [ ] **R1:** Expose local terminal creation and control through MCP.
- [ ] **R2:** Start commands and retain running sessions.
- [ ] **R3:** Read output repeatedly and incrementally.
- [ ] **R4:** Write input to interactive processes.
- [ ] **R5:** Report running state and final exit code.
- [ ] **R6:** Terminate sessions using appropriate signals.
- [ ] **R7:** Validate MCP client interoperability; consider Manus specifically.
- [ ] **R8:** Use a genuine PTY; evaluate node-pty versus Python ptyprocess.
- [ ] **R9:** Assign session IDs and support multiple sessions.
- [ ] **R10:** Bound output with a cursor-addressable ring buffer.
- [ ] **R11:** Wait for output, idle, or regex match.
- [ ] **R12:** Send keys/control characters and resize terminals.
- [ ] **R13:** Provide bounded waits and session timeouts.
- [ ] **R14:** Handle ANSI and expose an emulated screen snapshot.
- [ ] **R15:** Support stdio and token-authenticated Streamable HTTP.
- [ ] **R16:** Explain and validate remote access through an HTTPS tunnel.
- [ ] **R17:** Apply local-only binding, tokens, and allowlists.
- [ ] **R18:** Automate vim, Python REPL, and SSH-like prompt tests.

## 3. Goals and non-goals

The MVP lets an agent complete interactive work without human terminal intervention, recover reads after disconnection, and release resources. Ship terminal primitives, two transports, and repeatable tests before presentation polish.

Non-goals are cross-platform certification, restart-persistent sessions, hosted multi-tenancy, a GUI, production SSH credential management, public deployment, and a security sandbox. “Local” means the server host: Studio does not silently access the builder’s laptop. Stretch goals are OAuth discovery, modern-protocol support, macOS/Windows testing, durable transcripts, and a browser viewer.

## 4. Target users and key user stories (with acceptance criteria)

**Developer delegating CLI work:** “Keep my Python REPL alive.” Acceptance: create `python3 -q`, submit two expressions separately, receive both answers from the same session, and exit cleanly after EOF.

**Agent maintaining a service:** “Follow logs without guessing completion.” Acceptance: reused cursors produce no duplicate output; a quiet service remains `running`; wait timeout does not kill it.

**Developer debugging an interactive tool:** “Inspect vim and send real keys.” Acceptance: insert a marker, resize, snapshot the marker, save, and exit zero.

**Owner connecting remotely:** “Grant an agent disposable-workspace access.” Acceptance: an independent MCP client completes create/write/read/kill over authenticated HTTP; missing token, invalid Origin, and disallowed executable fail before spawning.

## 5. Core user flows (step-by-step, include edge cases)

1. **Connect:** Start `tetherterm --stdio`, or `--http --port 8787 --config demo.json`. Stdio sends protocol messages only; diagnostics use stderr. HTTP binds `127.0.0.1`. An operator-started HTTPS tunnel forwards to it. Configure the exact tunnel hostname; never disable validation globally.
2. **Start:** Call `terminal_create` with executable, argv, cwd, dimensions, timeout, and operation ID. Validate policy, spawn a PTY, allocate UUID/buffers, and return immediately. Invalid cwd, quota exhaustion, and spawn failure return typed errors without leaks.
3. **Interact:** Read, wait for a prompt, then write text or keys. Serialize writes per session. Idle means “no recent output,” never “complete.” Password prompts may not echo; use synthetic secrets in tests.
4. **Recover:** Reconnect with the terminal ID/cursor. Retry create/write using the same operation ID. An evicted cursor returns `gap=true` and the oldest surviving offset; snapshot recovers visual state. Future or non-character-boundary cursors fail.
5. **Finish:** Read final output, inspect status, or terminate. SIGTERM escalates after one second. Cancelling a wait removes its listener without killing work. Runtime expiry terminates work; exited sessions remain readable for five minutes. Restart invalidates IDs; daemonized jobs are unsupported.

## 6. Functional requirements (prioritized P0/P1/P2, each with ID)

**P0 / MVP:**

- **F01:** Eight MCP tools with JSON schemas and structured/text results. R1, R7.
- **F02:** PTY spawn with argv, realpath-validated cwd, dimensions, minimal environment, UUID, and four concurrent sessions. R2, R8, R9.
- **F03:** One-MiB raw-output ring/session, cursor reads, overflow reporting, bounded results. R3, R10.
- **F04:** Serialized text/key input and simultaneous PTY/emulator resize. R4, R12.
- **F05:** Output/idle/bounded-regex waits with timeout/cancellation cleanup. R11, R13.
- **F06:** Status, root exit code/signal, runtime expiry, termination escalation, ordinary descendant cleanup. R5, R6, R13.
- **F07:** Headless ANSI interpretation and text viewport snapshots, including alternate screen/cursor. R14.
- **F08:** Stdio/authenticated Streamable HTTP; independent-client and HTTPS-tunnel tests. R7, R15, R16.
- **F09:** Executable/cwd allowlists, authentication, origin/host checks, quotas, secret-free audit metadata. R17.
- **F10:** Python/vim/SSH-prompt, overflow, retry, timeout, and kill tests. R18.

**P1 / stretch:** **F11:** Connect Manus if its connector supports the protocol and bearer headers; document results, not assumptions. **F12:** Add OAuth authorization and revision 2026-07-28 support. **F13:** Certify macOS/Windows.

**P2 / stretch:** **F14:** Opt-in durable transcripts/crash recovery. **F15:** Read-only visual viewer. Neither blocks MVP.

## 7. Non-functional requirements (latency, reliability, privacy/security, performance, accessibility as relevant)

**Latency:** On the demo host, target p95 create below one second, immediate read/status below 100 ms, and output-wait delivery within 150 ms of PTY events; exclude client/model/tunnel latency. Maximum wait: ten seconds; default: two. Default runtime cap: fifteen minutes.

**Reliability/performance:** Retain final output; deliver root exit once. Cap input at 16 KiB, reads at 64 KiB, dimensions at 240×80, sessions at four, waiters at four/session, and exited records at sixteen. Under four synthetic 100-KiB/s producers, target RSS below 200 MiB and responsive status. Eviction never depends on client consumption.

**Security/privacy:** Run unprivileged in a disposable workspace. Children inherit host permissions; cwd/executable restrictions are guardrails, not isolation [2]. Bash, Python, and vim can access files or execute code; no “safe shell” claim. Never inherit cloud credentials/tokens. Tokens stay out of query strings, child env, and logs. No persisted input/output by default; disclose that terminal echo can retain secrets in memory. Output is untrusted data, not agent instructions.

**Accessibility:** Plain-text-readable results, recovery-oriented errors, no color-only state. Snapshot text omits active links and clipboard effects.

## 8. Proposed architecture and tech stack (include an ASCII or mermaid diagram, key technical decisions with rationale, and rejected alternatives)

```text
Local MCP client -- stdio --------------------+
Remote MCP client -- HTTPS tunnel -- HTTP ----+--> SDK tool adapters
                                                  | auth + policy
                                                  v
                                           Session manager
                                           /      |       \
                                      node-pty  ring     waiters
                                         |        |         |
                                    Linux process +-- headless xterm
                                                       snapshots
```

Use Node.js 22, TypeScript, official `@modelcontextprotocol/sdk` v1, Zod, `node-pty`, `@xterm/headless`, `re2-wasm`, and `bun test`. Lock resolved versions after compatibility smoke tests. Node-pty supplies PTY read/write/resize [2]; headless xterm maintains terminal state [3], avoiding a homemade parser.

Choose the SDK’s **2025-11-25 protocol baseline**, stateless HTTP configuration, and JSON responses; application sessions remain independent of transport connections [1] [4]. Revision 2026-07-28 removes protocol sessions and changes metadata, so support requires separate testing [5]. SDK clients plus MCP Inspector establish declared-baseline interoperability; “any MCP client” is not a universal guarantee.

Reject `child_process.exec`: pipes cannot faithfully operate full-screen apps. Reject Python ptyprocess because a second language adds packaging/integration work, not because it lacks PTYs. Reject WebSockets and legacy HTTP+SSE: standard transports suffice. Reject product-managed Docker orchestration; use an already-disposable environment. Reject shell-string wrappers; callers explicitly choose executable and argv.

## 9. Data model / protocol / API surface (concrete: message schemas, tool signatures, manifest format, etc. as relevant)

Optional fields use defaults above:

```typescript
terminal_create({executable, args: string[], cwd, cols?, rows?,
                 timeoutMs?, operationId})
  -> {sessionId, cursor: "0", state: "running"}
terminal_read({sessionId, cursor, maxBytes?})
  -> {output, nextCursor, oldestCursor, headCursor, gap, state}
terminal_write({sessionId, text?: string, keys?: Key[], operationId})
  -> {acceptedBytes, state} // exactly one of text or keys
terminal_wait({sessionId, cursor, until: "output"|"idle"|"regex",
               idleMs?, pattern?, timeoutMs?})
  -> {reason: "output"|"idle"|"match"|"exit"|"timeout",
      headCursor, state}
terminal_resize({sessionId, cols, rows}) -> {cols, rows}
terminal_status({sessionId?}) -> {sessions: SessionSummary[]}
terminal_snapshot({sessionId}) -> {lines: string[], cols, rows,
                                  cursor: {x,y}, renderedCursor}
terminal_kill({sessionId, signal?: "SIGTERM"|"SIGKILL"})
  -> {state, terminationRequested: boolean}
```

`SessionSummary` contains ID, executable, cwd, dimensions, timestamps, `running|terminating|exited`, nullable exitCode/signal, and terminationReason. It describes the root process, not task success; unknown signals remain null. Keys: `ENTER`, `TAB`, `ESC`, `BACKSPACE`, arrows, `CTRL_C`, `CTRL_D`. ENTER maps to CR; controls map to terminal bytes.

Cursors are decimal UTF-8 byte offsets in raw ANSI output. Trim/slice only at character boundaries. Capped reads return the consumed offset, not head. Never advance client cursors automatically. Snapshot awaits queued emulator writes and reports rendered offset. Regex tests the current viewport initially and after output, using RE2-compatible patterns capped at 256 characters. Idle defaults to 300 ms since last output. Output wait resolves when head exceeds cursor. Raw reads preserve ANSI; only snapshots represent screen state.

Maintain a bounded ten-minute operation-ID/result cache for create/write; changed arguments with a reused ID fail. Cache pending operations before execution. Retry protection applies only within the live cache window, not across restart/expiry. Kill is idempotent. Errors use `isError:true` and JSON `{code,message,retryable}`: `NOT_FOUND`, `POLICY_DENIED`, `BAD_CURSOR`, `LIMIT`, `NOT_RUNNING`. Successful results duplicate JSON in text and `structuredContent` [1].

```json
{
  "bind": "127.0.0.1", "port": 8787,
  "tokenEnv": "TETHERTERM_TOKEN",
  "allowedRoots": ["/workspace/demo"],
  "allowedExecutables": ["/usr/bin/python3", "/usr/bin/vim"],
  "allowedHosts": ["localhost", "127.0.0.1", "demo.example.net"],
  "allowedOrigins": [], "maxSessions": 4
}
```

Require a random 32-byte bearer token on every HTTP MCP request. Absent Origin is allowed for non-browser clients; present unlisted Origin yields 403 [4]. Stdio uses process-owner trust. Local configuration launches `node /absolute/path/dist/server.js --stdio --config /absolute/path/demo.json`; HTTP uses `https://demo.example.net/mcp` plus Authorization. Static-token authentication is private integration security, not full MCP OAuth conformance.

## 10. Risks, open questions, and mitigations

**Native dependency:** node-pty compilation can fail [2]. Validate within twenty minutes; install compiler prerequisites once. Report a blocker rather than substitute pipes.

**Process escape:** job control/daemonization complicate cleanup. Record ordinary descendants and process identities before signaling, terminate deepest-first, escalate survivors, and test a child process. Detached jobs are unsupported; disposable-host teardown is the final boundary.

**Transport mismatch:** test immediately. If Manus cannot send bearer headers or negotiate the baseline, document that and use Inspector; never weaken authentication. Mitigate regex limitations and screen races with syntax validation and emulator-write barriers.

Open decisions: Studio or laptop host; whether Manus connection is mandatory for judging; approved workspace/executables. Defaults: Studio Linux, independent-client proof, disposable demo root. Full host-shell access needs explicit owner opt-in.

## 11. Success metrics and a demo script (exactly how a judge would verify each requirement in under 5 minutes)

Pass: all P0 tests green, three consecutive interactive runs succeed, no surviving supported child after cleanup, and identical contracts pass both transports. Prepare dependencies, tunnel, tokens, and fixtures before judging; hide credentials.

1. **0:00–0:35:** Inspector connects over authenticated HTTPS, lists tools, creates Python. Show saved stdio contract-test results. Verify R1, R2, R7, R8, R15, R16.
2. **0:35–1:15:** Wait for `>>>`, send `print(6*7)` and ENTER, read `42`, reuse cursor, show no duplicates. Create a second session; show both IDs/status. Verify R3, R4, R5, R9, R10, R11.
3. **1:15–2:05:** Vim fixture inserts `TetherTerm works`, resizes to 100×30, snapshots, sends ESC/`:wq`/ENTER; assert saved contents and exit zero. Verify R12, R14, R18.
4. **2:05–2:45:** Synthetic SSH-like fixture asks host confirmation and no-echo password; MCP answers both. Show quiet-but-running, wait timeout, and two-second runtime expiry. Verify R11, R13, R18.
5. **2:45–3:30:** Kill a parent/child fixture, show no survivors; force ring overflow and `gap=true`. Verify R6, R10.
6. **3:30–4:20:** Negative tests reject missing token, malicious Origin, forbidden cwd/executable, and quota with zero spawns. Show green suite and clean remaining sessions. Verify R17 and complete checklist. Manus is a labelled bonus, not implied by Inspector.

## 12. Milestones and build plan (ordered tasks that can be handed to a coding agent, with MVP cut line)

1. **30 minutes:** Scaffold TypeScript, lock dependencies, prove native PTY installation and SDK stdio/HTTP discovery.
2. **60 minutes:** Implement manager, policy, create/status/kill, runtime timers, ordinary-child cleanup tests.
3. **75 minutes:** Implement Unicode-safe ring/reads, gaps, write serialization, operation-ID replay protection.
4. **60 minutes:** Add keys, resize, snapshots, output/idle/RE2 waits and cancellation tests.
5. **60 minutes:** Wire schemas/results; secure HTTP, environment filtering, origin/host validation, quotas.
6. **75 minutes:** Drive Python/vim/SSH-like fixtures over both transports; test overflow, retry, timeout, descendants, Unicode.
7. **45 minutes:** Validate HTTPS tunnel/Inspector, measure latency/memory, document configuration and compatibility.
8. **30 minutes:** Rehearse demo, verify cleanup, package startup/test commands.

**MVP cut line: seven to eight focused hours, F01–F10 demonstrable.** Cut viewers, OAuth, cross-platform work, and Manus integration first—not PTY semantics, security, or tests. Report runtime/transport blockers explicitly. Stretch starts after acceptance passes.

## 13. Promo-video hooks (3-5 shots/moments from this product that would look great in a promo video)

- An agent answers a Python prompt and receives `42` from the same live session.
- Vim’s snapshot gains “TetherTerm works”; the saved-file assertion turns green.
- Two session IDs run concurrently; “idle” stays visibly distinct from “exited.”
- Reconnect resumes at an exact cursor; stale reads visibly report gaps.
- Termination clears parent/child processes, followed by the interaction suite passing.

**References**

[1]: https://ts.sdk.modelcontextprotocol.io/server.html "Official MCP TypeScript SDK v1 server guide"
[2]: https://github.com/microsoft/node-pty "node-pty PTY API and security guidance"
[3]: https://github.com/xtermjs/xterm.js "xterm.js and Node headless terminal support"
[4]: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports "MCP 2025-11-25 transport specification"
[5]: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http "MCP 2026-07-28 Streamable HTTP specification"

## Appendix A: UI Design System (user directive)

TetherTerm is a headless MCP server. If a small local status or log viewer is added (stretch), follow the user's style: clean, minimal, black and white, shadcn/ui look and feel, no borders. Separate elements with whitespace and subtle surface tone (`#F4F4F5`), monospace output on a `#000` surface, and no outlines or divider lines.

## Appendix B: Scaffold (Better-T-Stack, one scaffold per project)

Run `scaffold/05-tetherterm.sh` from a workspace folder outside this repo. It creates `tetherterm/` as its own independent project and git repo, using the same Better-T-Stack command as every other product (user directive: same stack for consistency, never one mega scaffold). The command was validated against the live CLI on 2026-11-21. **Where this appendix conflicts with Section 8, this appendix wins.** Bun is the package manager and runtime throughout: `bun install`, `bun run`, `bunx`, and `bun test` for unit tests (replacing any npm, pnpm, npx or Vitest reference elsewhere in this PRD; Playwright stays for browser end-to-end tests).

This is the product that uses the least of the stack. `apps/server` Hono on Bun hosts the Streamable HTTP MCP endpoint; the stdio entrypoint is hand-written; the PRD's Node 22 becomes Bun. Bun 1.4.5 exposes a native `Bun.Terminal` (checked in this session), so the first spike must prove PTY spawn, write, resize and exit codes under Bun, with node-pty under Node as fallback. Next.js (`apps/web`) is an optional read-only session dashboard (stretch); everything else (auth, Mongo, Polar, native, wxt) stays dormant. The scaffold's `mcp` addon configures MCP servers for the developer's coding agent; it does not generate an MCP server.
