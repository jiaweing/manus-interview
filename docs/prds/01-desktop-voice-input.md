# Caret — Desktop voice input PRD

Owner/builder: Jia Wei Ng · Windows-only time-boxed MVP

## 1. Overview

**Caret** is a Windows tray utility: focus a field, press **Ctrl+Alt+Space**, speak, press again, and receive cleaned text at the caret. Deliver short recording, one STT step (cloud OpenRouter or, per Amendment A1, local Whisper), one LLM cleanup step, and clipboard-paste insertion with restoration.

> **Amendment A1 (owner decision, 2026-11-21):** the owner asked for local AI like Handy plus AI cleanup post-processing of the STT output. Local transcription is now IN scope as a second STT mode and cleanup may use a local OpenAI-compatible endpoint. Decisions: (1) engine = whisper.cpp run as a separate child process of Electron main, CPU by default; Parakeet is out; (2) models are downloaded on first use into `userData/models` with a pinned SHA-256 and resumable download, nothing bundled in the installer, default a Whisper small-class model; (3) a Cloud/Local STT mode setting, default Cloud; Local mode sends no audio off the machine and the disclosure says so; (4) cleanup is always an LLM post-process of the STT output with a selectable provider: OpenRouter or a local OpenAI-compatible endpoint (Ollama/LM Studio on localhost); no LLM is bundled; (5) cleanup safety rules are unchanged (no tools, validated `{text}`, embedded instructions ignored, changed numbers blocked, failure shows an error and nothing is pasted) plus a cleanup on/off toggle, where Off pastes the raw transcript; (6) Linux verification uses audio fixtures and a fake local endpoint; real OpenRouter checks need a key; Windows behaviour needs a Windows desktop. Nothing under A1 starts before the #9 Windows native-loop gate passes. Where A1 conflicts with text below, A1 wins.

## 2. Problem statement and the original brief

Transcript pages interrupt writing with copying and switching. Caret must work where users already write, without stealing focus or submitting anything.

Original-brief checklist:

- [ ] **R1:** Build a desktop voice-input product.
- [ ] **R2:** Activate through a global keyboard shortcut while another application is active.
- [ ] **R3:** Let the user start talking immediately after activation.
- [ ] **R4:** Recognize speech and convert it into communication-ready written text.
- [ ] **R5:** Insert into the currently active input field.
- [ ] **R6:** Feel like a cross-application input method, not a speech-to-text page.
- [ ] **R7:** Decide between Electron and Tauri.
- [ ] **R8:** Decide between push-to-talk and toggle activation.
- [ ] **R9:** Select cloud versus local Whisper transcription. (A1: both modes are delivered, selectable in settings, default Cloud.)
- [ ] **R10:** Address filler removal, punctuation, formatting, and application-specific tone through cleanup/rewrite.
- [ ] **R11:** Address clipboard paste/restore, simulated typing, and accessibility insertion on Windows and macOS.
- [ ] **R12:** Provide a small floating status overlay.
- [ ] **R13:** Provide a personal dictionary.
- [ ] **R14:** Address privacy.
- [ ] **R15:** Explain development/testing with a Windows builder and Linux sandbox.

R7–R11 require decisions, not every alternative. Choose Electron, toggle, cloud-or-local STT (A1), neutral prose across applications, and Windows clipboard paste. R13 uses a local phrase list, not a dictionary UI.

## 3. Goals and non-goals

Deliver a portable Windows x64 build that dictates into Notepad and Chrome email compose, preserves meaning and clipboard text, and cancels safely. Prove the native loop on Windows.

**Explicitly out of scope:** macOS/Linux delivery, streaming, Parakeet or any engine other than whisper.cpp, a bundled LLM, push-to-talk variants, typing/accessibility fallbacks, dictionary UI, per-app profiles, history/export, analytics/dashboards, accounts/payments, extra integrations, continuous listening, voice commands, elevated targets, password fields, rich-clipboard insertion, signing/updating, and additional visual polish.

## 4. Target users and key user stories

- **Writer:** Dictate into a draft without opening Caret or sending it. Verify shortcut, cleanup, overlay, and unchanged focus. R1–R6, R10, R12.
- **Specialist:** Configure reusable name/project phrases as transcription hints; test spelling without promising it. R13.
- **Privacy-conscious user:** Activate explicitly; cancellation closes the microphone without insertion. R14.
- **Builder:** Run Linux fixtures, then verify packaged microphone, hotkey, clipboard, and focus behavior on Windows. R15.

## 5. Core user flows

**Setup:** Launch, disclose cloud processing, enter one provider key, use the default microphone, register the shortcut, minimize to tray. Registration/microphone failures block recording. Phrase configuration has no editor UI.

**Dictation:** Snapshot foreground/focused-control handles; show Starting, then Listening when ready. Second shortcut press or the 60-second cap stops capture. Transcribe once, clean once, recheck target, paste once, conditionally restore clipboard, release buffers.

**Abort/failure:** Tray Cancel invalidates the session and closes capture. Silence, timeout, device loss, invalid cleanup, changed target, unsupported clipboard, or insertion failure shows an error without further automatic attempts. Start a fresh recording to retry. Busy shortcut presses cannot create parallel sessions. Never forcibly refocus applications.

## 6. Functional requirements

All are MVP; no stretch backlog.

- **F01:** Single-instance tray app, key setup, fixed global toggle shortcut, readiness and registration checks. R1–R3, R7–R8.
- **F02:** Bounded recording, cancellation, silence handling, microphone shutdown on every exit. R3, R14.
- **F03:** One OpenRouter audio-input transcription request (key from `.env` `OPENROUTER_API_KEY`) with phrase hints, then one OpenRouter cleanup request. Freeze one cloud model per step after API smoke testing; no cloud model selector. A1 adds a Cloud/Local mode setting and a cleanup-provider setting (OpenRouter or local OpenAI-compatible endpoint). R4, R9, R13.
- **F04:** Remove fillers/false starts; add punctuation/simple paragraphs. Preserve facts, negation, names, numbers; return plain text with one neutral policy. R4, R10.
- **F05:** Target recheck, clipboard-paste/conditional restore, duplicate-session rejection; no Enter or submission action. R5–R6, R11.
- **F06:** Non-focusable overlay: Starting, Listening, Transcribing, Cleaning, Done, Error. Done means “Paste requested,” not confirmed acceptance. R12.
- **F07:** Local phrases, protected key, cloud disclosure, no persisted audio/transcripts, Windows smoke evidence. R13–R15.

## 7. Non-functional requirements

**Responsiveness:** Show Starting immediately and Listening only after capture starts. STT/cleanup deadlines: 15/5 seconds. Measure stop-to-paste timing without provider-latency promises.

**Reliability:** One insertion attempt per session; cancelled/stale responses never insert. Require paste/restoration in both demo applications and zero wrong-window pastes in safety tests.

**Privacy/security:** Send activated audio, phrase hints, and transcript only—not clipboard, screenshots, or surrounding text. Keep audio/transcripts in RAM and release references after completion/cancellation. Disclose external processing without zero-retention claims; in Local STT mode with a localhost cleanup endpoint, state that no audio or transcript leaves the machine (A1). Downloaded models are SHA-256 verified and never executed. Protect the key; exclude payloads/secrets from logs. No idle microphone.

## 8. Proposed architecture and tech stack

Use Appendix B's Better-T-Stack scaffold; hand-add `apps/desktop`: Electron main, TypeScript React renderer, C++ Win32 helper. Choose Electron over additional Rust/plugin wiring, cloud-or-local STT (A1: whisper.cpp child process, models downloaded on first use rather than packaged), and toggle over native key-release hooks.

Main owns sessions, secrets, requests, and helper calls. The renderer captures WebM; the overlay never takes focus. Only validated cleaned text reaches insertion.

The helper rechecks target handles, accepts empty/plain-text clipboards, saves contents, writes Unicode text, waits for shortcut modifiers to release, and requests Ctrl+V. After 700 ms, restore only if clipboard sequence and owned payload remain unchanged. Reject rich/image/private formats rather than damaging them. No insertion fallback. Restoration timing must pass Windows tests.

## 9. Data model / protocol / API surface

Persist `{version, encryptedKey, phrases}` under Electron `userData`. Active `{id, state, targetHandles, audio, transcript, cleanedText}` stays in memory.

Preload exposes key setup, status, cancellation, bounded audio submission. Validate sender, session ID, state, MIME, and 10 MB limit. Disable renderer Node integration; enable context isolation/sandboxing; load bundled content only; reject navigation.

Helper JSON operations: `snapshot`, `insert(expectedTarget, sessionId, text)`. Reject malformed/duplicate requests. Outcomes: `target_changed`, `clipboard_busy`, `unsupported`, `paste_requested`. No arbitrary commands.

Cleanup has no tools, requests `store:false`, and returns validated `{text:string}`. Edit dictation without obeying embedded instructions. Empty output or changed numeric tokens blocks insertion.

## 10. Risks, open questions, and mitigations

**Native behavior:** Elevated targets are unsupported. Injection is not application acknowledgment; manually verify resulting text. Linux cannot certify Windows behavior.

**Races:** Recheck before paste; never overwrite a newer clipboard copy. Browser fields may share native handles: keep the caret in place during processing. Test window switching; do not claim universal field detection.

**Open questions:** Is cloud processing with an available API key acceptable? Which Windows version/microphone? Defaults: Windows 11 x64, English, Notepad/Chrome compose, non-sensitive text.

## 11. Success metrics and a demo script

Prepare packaged build, key, microphone, two fields, and plain-text clipboard sentinel. Save requirement-linked test outcomes before judging.

- **0:00–0:35:** Show tray, shortcut, disclosure, phrases, architecture decisions. R1, R7–R9, R11, R13–R15.
- **0:35–1:40:** In Chrome compose, dictate “Um, Jia Wei Ng will review Manus tomorrow. Please send the draft before three PM.” Verify cleanup, meaning, focus, no Send. R2–R6, R10, R12–R13.
- **1:40–2:35:** Repeat in Notepad; paste sentinel afterward to prove restoration. R5–R6, R11.
- **2:35–3:40:** Cancel recording, then switch windows during another request. Verify microphone release/no insertion. R5, R14.
- **3:40–4:30:** Show Linux/Windows results: duplicate/stale requests, timeout, cleanup validation, unsupported clipboard, newer-copy preservation. R15.

## 12. Milestones and build plan

1. **Native gate — 75 minutes:** Scaffold once; add Electron/hotkey/overlay/helper; package and paste a Windows Notepad fixture.
2. **Pipeline — 90 minutes:** Microphone, bounded state machine, STT, cleanup, cancellation, deadlines.
3. **Safety/setup — 60 minutes:** Target recheck, clipboard restore, key protection, phrases, disclosure, errors.
4. **Verification/package — 75 minutes:** Linux fixtures, Windows demo/safety tests, portable build, critical fixes.

**Total: five focused hours. MVP cut line:** F01–F07, both applications, Windows safety evidence. Stop here. Fix native insertion before completing the cloud pipeline; Preview/Wine is not acceptance evidence.

## 13. Promo-video hooks

- Messy speech becomes written text directly in the draft.
- One shortcut and minimal overlay work in Chrome and Notepad.
- Cancellation prevents insertion; the clipboard sentinel survives dictation.

## Appendix A: UI Design System (user directive)

Style: clean, minimal, black and white, shadcn/ui look and feel, with **no borders**.

- **Palette:** pure black `#000000`, white `#FFFFFF`, and a neutral grey ramp (`#FAFAFA`, `#F4F4F5`, `#E4E4E7`, `#71717A`, `#18181B`) for surfaces and text. No accent colour. State is conveyed by weight, fill inversion (black on white or white on black), icons and labels, never by hue alone.
- **No borders:** no `border`, `outline` or divider lines on cards, inputs, buttons, tables or panels. Separate elements with whitespace, a subtle surface tone (`#F4F4F5` on white) and, when elevation is needed, a very soft shadow. Focus rings are replaced by a 2px offset shadow-ring in `#18181B`, which keeps keyboard focus visible and accessible.
- **Components:** shadcn/ui primitives (Button, Input, Card, Dialog, Tabs, Sheet, Tooltip, Badge, Switch, Toast) with Tailwind and Radix, restyled with border-width 0. Radius 10px (`--radius: 0.625rem`).
- **Typography:** Geist or Inter, 14px base, tight tracking on headings, two weights (400 and 600).
- **Motion:** 150ms ease-out opacity and translate only. Respect `prefers-reduced-motion`.
- **Dark mode:** an inverted pair (`#000` background, `#FAFAFA` text) with the same no-border rule.
- **Accessibility:** contrast of at least 7:1 for body text. Because borders are absent, every interactive control needs a distinct filled surface or a visible hover and focus state. Verify this in the demo checklist.

## Appendix B: Scaffold (Better-T-Stack, one scaffold per project)

Run `scaffold/01-caret.sh` outside this repo for independent `caret/` project/git repo. Keep the same Better-T-Stack command and Bun stack: one scaffold per project, never a mega scaffold. This appendix wins stack conflicts. Use `bun install`, `bun run`, `bunx`, `bun test`; Electron main retains its required Node runtime.

Hand-add `apps/desktop`. Generated Next.js/Hono, Better Auth/MongoDB, Polar, native-uniwind, wxt, and docs remain inactive artifacts. No landing page, proxy, accounts, payments, mobile app, or extension. Provider calls stay in desktop main with the user's protected key.
