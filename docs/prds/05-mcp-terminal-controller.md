## 1. Overview (one-paragraph pitch, product name suggestion, target user)

**TetherTerm** gives an MCP agent live terminal sessions on the server host. A developer can delegate interactive CLI work: create a genuine PTY, send input and keys, read incrementally, wait, inspect status, resize, kill, and list sessions. Deliver a Linux, single-user server, connection instructions, and requirement tests in five focused hours; no dashboard.

## 2. Problem statement and the original brief (restate the requirement in your own words and list every explicit requirement from the brief as a checklist with IDs R1, R2...)

Disconnected commands cannot maintain interactive state. The brief requires controllable sessions and bounded output; considerations below have explicit MVP decisions.

- [ ] **R1:** Expose terminal creation/control through MCP.
- [ ] **R2:** Start commands and retain running sessions.
- [ ] **R3:** Read output repeatedly and incrementally.
- [ ] **R4:** Write interactive input.
- [ ] **R5:** Report running state and exit code.
- [ ] **R6:** Terminate with appropriate signals.
- [ ] **R7:** Validate a real MCP client; document Manus connection steps/results.
- [ ] **R8:** Use a genuine PTY; evaluate node-pty versus Python ptyprocess against the required Bun stack.
- [ ] **R9:** Assign IDs and support multiple sessions.
- [ ] **R10:** Bound output with a cursor-addressable ring.
- [ ] **R11:** Wait for output, idle, or matching text; one literal pattern replaces regex.
- [ ] **R12:** Send keys/control characters and resize.
- [ ] **R13:** Bound waits and session runtimes.
- [ ] **R14:** Preserve ANSI output; emulated snapshots deferred because prompt interaction needs no screen model.
- [ ] **R15:** Provide stdio and bearer-authenticated Streamable HTTP.
- [ ] **R16:** Explain/test remote access through an HTTPS tunnel.
- [ ] **R17:** Apply local binding, tokens, and a working-directory/command policy.
- [ ] **R18:** Automate Python REPL and SSH-like prompt tests; vim deferred with snapshots.

## 3. Goals and non-goals

Deliver every in-scope checklist item with repeatable tests. Sessions survive client reconnection, not server restart. Idle must never imply completion. “Local” means the server host, not automatic laptop access.

**Explicitly out of scope:** screen snapshots/vim, general regex, dashboards/viewers, OAuth, accounts/multi-user, extra platforms, detached jobs, durable history/export, payments, analytics, animation, and protocol-revision matrices. No production SSH integration or security-sandbox claim.

## 4. Target users and key user stories (with acceptance criteria)

- **Developer:** Keep Python alive. Two separately submitted expressions return answers from one session; EOF yields an exit code.
- **Agent:** Follow output without duplicates. Continue from the returned cursor; a quiet process stays running; a timed-out wait leaves it alive.
- **Developer:** Answer prompts and control the terminal. A synthetic confirmation/password fixture accepts text and ENTER; resize changes reported PTY dimensions; CTRL_C interrupts.
- **Owner:** Connect safely. A real MCP client exercises HTTP controls; missing token and forbidden cwd/command fail before spawn. List distinguishes two sessions; kill releases them.

## 5. Core user flows (step-by-step, include edge cases)

1. Start stdio, or HTTP bound to loopback behind an operator-provided HTTPS tunnel. Protocol messages alone use stdout; diagnostics use stderr.
2. Create with executable, argv, approved cwd, and dimensions. Validate policy before PTY spawn; return an ID or typed error.
3. Wait for output/prompt text, read from a cursor, then send text or keys. Serialize writes. Never automatically retry uncertain create/write calls.
4. Reconnect using ID/cursor. Evicted output returns a gap and oldest surviving cursor; future/invalid offsets fail.
5. Observe exit, read final output, or kill. Wait cancellation removes listeners, not processes. Runtime expiry terminates work; restart invalidates IDs.

## 6. Functional requirements (prioritized P0/P1/P2, each with ID)

**P0 only; MVP cut line includes all eight:**

- **F01:** Eight schema-defined MCP tools with readable structured results. R1, R7.
- **F02:** Genuine PTY creation, UUIDs, four-session limit, policy validation. R2, R8, R9, R17.
- **F03:** One-MiB ring/session, Unicode-safe bounded reads, explicit gaps. R3, R10, R14.
- **F04:** Serialized text/key writes and PTY resize. R4, R12.
- **F05:** Output, idle, or single-literal-pattern wait with bounded timeout/cancellation. R11, R13.
- **F06:** List/status, exit code/signal, runtime cap, idempotent kill and ordinary-child cleanup. R5, R6, R9, R13.
- **F07:** Stdio and authenticated HTTP; HTTPS real-client test and Manus instructions. R7, R15–R17.
- **F08:** Python REPL, prompt fixture, lifecycle/security/output tests. R18.

## 7. Non-functional requirements (latency, reliability, privacy/security, performance, accessibility as relevant)

Reads/status never wait for process exit. Default wait: two seconds; maximum: ten. Default runtime: fifteen minutes. Cap reads at 64 KiB, input at 16 KiB, dimensions at 240×80, and waiters at four/session. Retain exited sessions/output for five minutes with sixteen-record cap.

Run unprivileged in a disposable workspace. Command/cwd policy is a guardrail, not isolation: interpreters inherit host permissions. Exclude credentials/tokens from child environment and logs. No persisted terminal content; echoed secrets may remain in memory. Treat output as untrusted data. Errors and status must be plain-text-readable, not color-dependent.

## 8. Proposed architecture and tech stack (include an ASCII or mermaid diagram, key technical decisions with rationale, and rejected alternatives)

```text
MCP client -- stdio / HTTPS tunnel --> HTTP bearer check
                 \___________________ MCP tool adapters
                                           |
                                    cwd/command policy
                                           |
                               session manager + ring + waits
                                           |
                                      Bun PTY process
```

Appendix B governs: Better-T-Stack, TypeScript, Bun, Hono, official MCP TypeScript SDK, Zod, and `bun test`. First prove `Bun.Terminal` spawn/write/resize/exit in the scaffold runtime; stop and report incompatibility rather than substitute pipes. Lock compatible dependencies after this spike.

Keep transport connections separate from terminal IDs. Use one SDK-supported Streamable HTTP configuration, not a revision matrix. Reject `exec` pipes because prompts need a PTY. Reject node-pty/Node and Python ptyprocess for this delivery because they add runtime/packaging work outside Bun. No xterm emulator: raw ANSI output and prompt fixtures suffice.

## 9. Data model / protocol / API surface (concrete: message schemas, tool signatures, manifest format, etc. as relevant)

```typescript
terminal_create({executable, args, cwd, cols?, rows?, timeoutMs?})
  -> {sessionId, cursor, state}
terminal_read({sessionId, cursor, maxBytes?})
  -> {output, nextCursor, oldestCursor, headCursor, gap, state}
terminal_write({sessionId, text?, keys?}) -> {acceptedBytes, state}
terminal_wait({sessionId, cursor, until: "output"|"idle"|"pattern",
               pattern?, idleMs?, timeoutMs?})
  -> {reason: "output"|"idle"|"match"|"exit"|"timeout", headCursor, state}
terminal_resize({sessionId, cols, rows}) -> {cols, rows}
terminal_status({sessionId}) -> SessionSummary
terminal_list({}) -> {sessions: SessionSummary[]}
terminal_kill({sessionId}) -> {state, terminationRequested}
```

Summary: ID, executable, cwd, dimensions, `running|terminating|exited`, nullable exitCode/signal. Writes accept exactly one of text/keys. Keys: ENTER, TAB, ESC, BACKSPACE, arrows, CTRL_C, CTRL_D. Cursors are decimal UTF-8 byte offsets; never split characters or advance beyond returned output. Preserve ANSI. Literal pattern: maximum 256 characters, searched in retained output from the supplied cursor; no regex. Idle defaults to 300 ms without output.

Kill sends SIGTERM, then SIGKILL after one second if needed. Errors include `NOT_FOUND`, `POLICY_DENIED`, `BAD_CURSOR`, `LIMIT`, `NOT_RUNNING`; return `isError:true` with code/message.

Configuration supplies approved root/executables, loopback port, exact tunnel hostname, and token environment variable. Realpath-check cwd. HTTP requires a random 32-byte bearer token on every request; reject unexpected Host and present unapproved Origin. Never put tokens in URLs. Stdio trusts its process owner.

## 10. Risks, open questions, and mitigations

PTY/Bun or SDK incompatibility: test first; report blockers without changing stack or weakening authentication. Cleanup: test an ordinary child; detached processes are unsupported, with disposable-host teardown the final boundary.

User decisions: server host, approved cwd/commands, and availability of Manus MCP URL/bearer configuration. Default host: disposable Linux workspace. No assumed successful Manus connection.

## 11. Success metrics and a demo script (exactly how a judge would verify each requirement in under 5 minutes)

Pass all P0 tests, repeat interactive fixtures three times, and leave no supported children running. Prepare dependencies, tunnel, and secrets before judging.

**Manus setup:** start HTTP, forward its loopback endpoint through the approved HTTPS tunnel, configure the resulting `/mcp` URL and bearer token in Manus's supported MCP connection settings, then discover tools and create/read/kill a session. Record the result; if unavailable, report the limitation and demonstrate an independent real client without removing authentication.

1. **0:00–0:40:** Real client connects over authenticated HTTPS; show stdio test result and create Python. R1, R2, R7, R8, R15, R16.
2. **0:40–1:30:** Wait for `>>>`, send two expressions, read `42`, resume without duplicates; list two IDs. R3–R5, R9–R11.
3. **1:30–2:25:** Answer synthetic confirmation/password prompts, resize, send CTRL_C; show idle versus running and wait timeout. R4, R11–R13, R18.
4. **2:25–3:15:** Show clean exit code, runtime expiry, and parent/child kill cleanup. R5, R6, R13.
5. **3:15–4:20:** Show passing overflow/gap and token/Origin/cwd/command rejection tests; clean remaining sessions. R10, R17. Mark R14 snapshots and R18 vim explicitly deferred.

## 12. Milestones and build plan (ordered tasks that can be handed to a coding agent, with MVP cut line)

1. **40 minutes:** Independent scaffold; prove Bun PTY and SDK discovery on both transports.
2. **65 minutes:** Policy, manager, create/status/list/kill, runtime limits and child cleanup.
3. **65 minutes:** Ring/cursors, text/keys, resize, three wait modes and cancellation.
4. **80 minutes:** HTTP security; real-client Python/prompt tests, gaps, Unicode, limits, exit and cleanup.
5. **50 minutes:** HTTPS/Manus connection instructions/results, startup commands and judge rehearsal.

**MVP cut line: five focused hours, F01–F08 passing.** Stop there. Report blockers; do not cut PTY correctness, authentication, lifecycle tests, or either transport to add presentation work.

## 13. Promo-video hooks (3-5 shots/moments from this product that would look great in a promo video)

- One Python session answers two separate inputs.
- The agent answers a prompt; idle remains distinct from exit.
- Cursor reads avoid duplicates; kill clears both sessions.

## Appendix A: UI Design System (user directive)

Preserve clean, minimal black-and-white shadcn style with **NO borders**, outlines, or dividers; use whitespace and subtle surface tone for separation. TetherTerm is headless: no UI is required or built in this MVP.

## Appendix B: Scaffold (Better-T-Stack, one scaffold per project)

Run `scaffold/05-tetherterm.sh` outside this repo. Keep its existing Better-T-Stack command unchanged; create one independent `tetherterm/` project/repo, never a shared mega scaffold. Bun remains package manager/runtime: `bun install`, `bun run`, `bunx`, `bun test`.

Use `apps/server` Hono for HTTP and a stdio entrypoint. Prove native `Bun.Terminal` first. Generated web/mobile/extension, account/payment/database, and other unused modules stay dormant; implement no features in them. The scaffold's `mcp` addon configures coding-agent connections; it does not generate this server. This appendix overrides conflicting stack choices elsewhere.
