# Caret evidence ledger

Maintained by the Lead. "LINUX-APPROVED" means an independent verifier (never the builder) approved the
Linux-verifiable criteria only. Every Windows-only behaviour is **UNVERIFIED: needs Windows**. No issue is
labelled `status:verified` unless every acceptance box was verified; Windows-gated issues stay OPEN.

| Wave | Issue | PR | Builder | Verifier | Result | Merged |
|---|---|---|---|---|---|---|
| 1 | #2 scaffold | #182 | agent | independent agent (round 1 BLOCKED: Electron binary missing; round 2 VERIFIED) | VERIFIED, issue closed | 2026-11 |
| 2 | #3 IPC boundary | #193 | agent | independent agent | LINUX-APPROVED (101 tests); issue open | 2026-11 |
| 2 | #4 tray + shortcut | #194 | agent | independent agent | LINUX-APPROVED (18 tests); Windows hotkey/tray UNVERIFIED | 2026-11 |
| 2 | #5 six-state overlay | #202 | agent | independent agent | LINUX-APPROVED (9 tests); no-focus-steal UNVERIFIED on Windows | 2026-11 |
| 2 | #6 Win32 helper protocol | #200 | agent | independent agent | LINUX-APPROVED (26 bun tests, 79 negative fixtures, 2000 mutations) | 2026-11 |
| chore | Biome config + format | #203, #218 | Lead/agent | lint exit 0 | `bun run lint` scoped to apps/desktop | 2026-11 |
| 3 | #7 guarded Unicode paste | #225 | agent | independent agent | LINUX-APPROVED (41 ASan/UBSan scenarios, PE import audit); focus guard UNVERIFIED on Windows | 2026-11 |
| 4 | #8 conditional clipboard restore | #233 | agent | round 1 CHANGES-REQUESTED (GlobalLock leak on bad_alloc, 3 post-mutation exception gaps); fixed bbc9f21; round 2 independent agent | LINUX-APPROVED (50 independent adversarial scenarios + 59 clipboard + 11 Win32-resource cases); Windows 14-case report UNVERIFIED | 2026-11-21 |

## Gate status

- #9 Windows Notepad native-loop gate: **NOT RUN - needs a real Windows 11 desktop** (blocked by #4, #5, #8 Windows evidence).
- Waves 6-13 (cloud STT, cleanup, history, settings, packaging, computer-use gate #175, video, audit): **NOT STARTED** by design; no cloud work may start before #9 passes.
- Real OpenRouter checks: **not run: no key**.

## Disclosed deviations / caveats

- #2 issue text asks for an external scaffold with its own `.git`; the prompt says in-repo with `--no-git`. Prompt followed.
- PRs use `Refs #N` so #3-#8 stay open until Windows evidence exists.
- Full-repo Ultracite is not meaningful for dormant scaffold apps; lint is scoped to `apps/desktop`.
- Clipboard restore preserves plain text (Unicode-normalized), not original ANSI/OEM bytes or derived format IDs; judged compatible with #8 by the verifier, legacy equivalence unverified on Windows.
- Repository visibility is PUBLIC while the prompt says private (left unchanged).
