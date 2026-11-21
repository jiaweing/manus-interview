#!/usr/bin/env python3
"""Apply the 2026-11-21 decisions to docs/issue-specs/*.json (idempotent):
- App AI goes through OpenRouter, key in .env (OPENROUTER_API_KEY), no Gemini/OpenAI-direct.
- Everything is built from scratch: no Manus webdev / Studio dependency.
- Opus 5.5 model id is anthropic/claude-opus-5.5 (verified in the OpenRouter catalog).
- Add one final full-coverage computer-use verification issue per product (tests + computer use + video + screenshots).
"""
import glob
import json

SPECS = "docs/issue-specs"

REPL = [
    ("the scaffold's Google Gemini adapter", "the OpenRouter adapter"),
    ("fixed Google Gemini model", "fixed OpenRouter model (OPENROUTER_MODEL)"),
    ("Google Gemini integration", "OpenRouter integration (OpenAI-compatible chat completions with OPENROUTER_API_KEY from .env)"),
    ("fake Gemini adapter", "fake OpenRouter adapter"),
    ("server-only Gemini key", "server-only OpenRouter key"),
    ("Gemini execution loop", "OpenRouter execution loop"),
    ("Gemini", "OpenRouter model"),
    ("OpenAI file-STT", "OpenRouter audio-input transcription"),
    ("go to OpenAI", "go to OpenRouter"),
]


def fix(o):
    if isinstance(o, str):
        for a, b in REPL:
            o = o.replace(a, b)
        return o
    if isinstance(o, list):
        return [fix(x) for x in o]
    if isinstance(o, dict):
        return {k: fix(v) for k, v in o.items()}
    return o


FLOP_S2 = {
    "title": "Prove WebSocket ingress reaches one Bun instance in a production build",
    "context": "The first milestone requires WebSocket verification before poker implementation. The game is built from scratch and self-hosted (no Manus webdev). Unsupported ingress blocks the release rather than permitting polling, a local substitute game or a replacement scaffold.",
    "tasks": [
        "Mount /api/ws with Hono/Bun upgradeWebSocket and run the production build (`bun run build && bun run start`, also via the Dockerfile) as exactly one backend instance.",
        "Use a temporary transport-only smoke probe to demonstrate two browser sockets reach the same in-memory process; record only a non-secret boot marker and connection counts.",
        "Capture the origin, single-instance setting, handshake statuses and the two connections' shared boot marker; remove any smoke bypass when authenticated gameplay is connected.",
        "If upgrades fail or the deployment cannot stay single-instance, record the failed handshake/configuration and mark the gate blocked without implementing a fallback.",
    ],
    "acceptance_criteria": [
        "Two independent browser contexts opened on the production-build origin each establish a WebSocket to /api/ws with HTTP 101 (ws:// locally, wss:// behind TLS).",
        "Both connections are observed on the same boot marker while the configuration specifies exactly one server instance.",
        "No polling or local game fallback is introduced; a failed WebSocket or single-instance check blocks further release verification.",
    ],
    "verification": "Run the production build and open two Playwright browser contexts on its origin (`bunx playwright test apps/web/tests/ingress.spec.ts --project=chromium`). Expected: two 101 upgrades and server evidence of one boot marker and two connections; capture both handshake screenshots and the sanitized marker/configuration evidence. If either socket fails or requests land on different instances, this issue fails. Repeat with production authentication in the release gate; temporary probing must not survive release.",
}
FLOP_S23 = {
    "title": "Verify the release build over real WebSockets and record the tested commit",
    "context": "Passing unit tests does not prove the multiplayer requirement. This release gate repeats ingress with production authentication against the production build, verifies restart loss and binds the tested build to a git commit.",
    "tasks": [
        "Run all engine/server and browser suites against the production build; verify a single in-memory server instance with no smoke/auth bypass or normal deterministic-deck mode.",
        "Re-run the two-context lifecycle against the production origin and inspect authenticated WebSocket handshakes and public state convergence.",
        "In four browser contexts join a room, verify a fifth receives ROOM_FULL, then verify a new seat during play receives MATCH_STARTED.",
        "In a disposable room restart the backend; confirm clients show Room lost — create again instead of restoring or inventing a match.",
        "Record the tested git commit SHA, origin, sanitized test summaries, handshake/capacity screenshots and restart-loss evidence.",
    ],
    "acceptance_criteria": [
        "bun test packages/engine apps/server/src and the browser suite exit 0 against the production build.",
        "Two authenticated browsers receive HTTP 101 on /api/ws and share one authoritative public state on exactly one backend instance; no temporary smoke bypass remains.",
        "Four-seat/fifth-seat and playing-roster-lock checks return the exact ROOM_FULL and MATCH_STARTED outcomes.",
        "Backend restart loses the disposable room and both clients display Room lost — create again; normal deployment has no enabled deterministic deck.",
        "The tested commit SHA and origin are recorded with sanitized pass evidence.",
    ],
    "verification": "Run bun test packages/engine apps/server/src, then PLAYWRIGHT_BASE_URL=<production-build-origin> bunx playwright test apps/web/tests --project=chromium --workers=1. Expected: all commands exit 0. Capture two authenticated 101 WebSocket handshakes without auth payloads, four occupied seats and the fifth-seat ROOM_FULL message, then MATCH_STARTED for a new join after start. Capture the one-instance configuration. Restart the disposable backend and capture both Room lost — create again messages. Record `git rev-parse HEAD`. Any failed WebSocket, state mismatch, privacy leak, enabled normal deterministic deck or missing commit record fails this gate.",
}
S7_S2 = {
    "title": "Verify Claude Opus 5.5 access through OpenRouter and record reviewed authoring patches",
    "context": "The OpenRouter catalog (checked 2026-11-21) lists `anthropic/claude-opus-5.5` (1M context, tools and structured outputs supported). Model access is an authoring prerequisite, while completed rendering must not depend on a model. The key lives in .env as OPENROUTER_API_KEY and is never committed.",
    "tasks": [
        "Fetch https://openrouter.ai/api/v1/models, confirm `anthropic/claude-opus-5.5` is listed, and make one scene-sized JavaScript patch request to it with the .env key; record the model id, request id and response metadata without credentials.",
        "Create authoring/model-record.json and authoring/reviews.md for scoped requests against locked scene records, accepted patch references, still/test review outcomes and reviewer decisions; subsequent scene issues append their own evidence.",
        "If the specified model cannot be used, record blocked status and the access error, report it, and stop model-dependent authoring rather than substituting another model. Keep model calls outside runtime/render code.",
    ],
    "acceptance_criteria": [
        "A successful record names `anthropic/claude-opus-5.5`, the catalog listing evidence and a completed scoped request with its OpenRouter generation id.",
        "The initial accepted patch has a request reference, changed-file reference and review decision; later visual issues have an identified place to append their review evidence.",
        "Unavailable or mismatched model access is recorded as blocked with an error and no substitute-model success claim; blocked status does not satisfy this authoring gate.",
    ],
    "verification": "Run `bun run authoring:verify-model` (script created in this issue). It must GET the OpenRouter models catalog, assert `anthropic/claude-opus-5.5` is present, send one scoped patch request using OPENROUTER_API_KEY from .env, and write authoring/model-record.json {status, modelId, requestRef, generationId}. Expect exit 0, status `verified`, modelId exactly `anthropic/claude-opus-5.5`. Save the sanitized output as qa/authoring-model.txt. If unavailable, save the access error to qa/authoring-blocker.txt, mark the issue blocked and do not claim a passing rehearsal.",
}
OVERRIDES = {("02-flopside", "S2"): FLOP_S2, ("02-flopside", "S23"): FLOP_S23, ("07-session-seven", "S2"): S7_S2}

APPEND_CONTEXT = {
    ("03-patchbay", "S14"): " Default endpoint is OpenRouter (https://openrouter.ai/api/v1, OPENROUTER_API_KEY from .env, model from OPENROUTER_MODEL); any other OpenAI-compatible endpoint must also work via configuration.",
    ("01-caret", "S11"): " Provider is OpenRouter (key from .env OPENROUTER_API_KEY in development; entered once in setup for packaged use). Candidate audio-input model: google/gemini-3.5-flash-lite (catalog: audio input, text output, tools). The Responses API accepts wav/mp3 only; chat completions accepts other input_audio formats the provider supports. Freeze one model after the smoke test.",
    ("04-sidekick", "S4"): " The server reads OPENROUTER_API_KEY and OPENROUTER_MODEL from .env (default candidate: anthropic/claude-sonnet-5.5, which supports tool calling). The key never reaches the extension.",
    ("07-session-seven", "S5"): "",
}

# Final full-coverage verification issue per product.
V = {
    "01-caret": dict(
        env="a real Windows 11 desktop (Manus Windows computer or the user's PC); the Linux sandbox cannot host this gate",
        surface="setup window (cloud disclosure, key entry, microphone/shortcut readiness, phrases config), tray menu (Setup, Cancel, Quit), the Ctrl+Alt+Space toggle, every overlay state (Starting, Listening, Transcribing, Cleaning, Done, Error), paste into Notepad and into the Chrome compose box, and every error path (no key, microphone denied, shortcut conflict, 60-second cap, STT/cleanup timeout, focus changed before paste, clipboard restore)",
        drive="OS-level computer use (mouse, keyboard, real microphone or a virtual audio device playing a fixed WAV)",
    ),
    "02-flopside": dict(
        env="the production build running locally (one Bun process) with up to four real browser windows",
        surface="home/create-room, share link, join, name entry, seat selection, start, every in-hand action (fold, check, call, bet/raise, all-in), the 2.5D table (hole cards visible only to their owner, community cards, pot, dealer button, chip stacks, turn timer), showdown, next hand, ROOM_FULL, MATCH_STARTED, disconnect/reconnect and Room lost — create again",
        drive="computer use controlling 2-4 real browser windows side by side",
    ),
    "03-patchbay": dict(
        env="the Linux sandbox or any terminal; the product is CLI only",
        surface="every CLI command, subcommand, flag and exit code, plugin discovery/load/unload/failure paths, both shipped plugins (workspace-scout, model-openai-compat), the independent conformance-fixture plugin, JSON-RPC stdio errors and a real inference round-trip through OpenRouter",
        drive="computer use driving a real terminal window (typing commands, reading output)",
    ),
    "04-sidekick": dict(
        env="headed Chromium/Chrome with the unpacked extension loaded (use xvfb on Linux, or a desktop) plus the Hono proxy running with a real OPENROUTER_API_KEY",
        surface="toolbar action opening the side panel, settings/token/proxy URL fields, permission grant flow, task input, plan view, Run/Stop, each tool action on a test page, each blocked or forbidden action, each error state, and the two named PRD tasks end to end",
        drive="computer use driving the real browser UI including the side panel",
    ),
    "05-tetherterm": dict(
        env="the Linux sandbox with a real MCP client; headless product so the UI under test is the client plus terminal",
        surface="every MCP tool (create, write/send keys, read/snapshot, resize, list, kill, etc. exactly as listed in the PRD), stdio and authenticated Streamable HTTP, bearer-token success and failure, real PTY behaviour (interactive shell, signals, resize, process cleanup), and the Manus MCP connection attempt or its documented limitation",
        drive="computer use driving a real MCP client UI (for example MCP Inspector in a browser) side by side with a terminal window",
    ),
    "06-glassroom": dict(
        env="two isolated browser profiles (separate users) with real WebRTC, locally and, if reachable, across two networks",
        surface="create room/share secret, join, fingerprint/verification display, send and receive messages, E2EE state indicators, peer leaves/rejoins, failed WebRTC preflight blocked-delivery state, evlog output proving no payloads or keys are logged",
        drive="computer use driving two real browser windows side by side",
    ),
    "07-session-seven": dict(
        env="the Linux sandbox with ffmpeg/ffprobe, the Remotion Studio and a media player",
        surface="Remotion Studio (every composition/scene), the rendered 60-second 1920x1080 MP4 played end to end, each of the six product scenes plus intro/outro, the audio track (OpenRouter music or the JS synth fallback), and the render CLI/commands",
        drive="computer use opening Remotion Studio and a video player, scrubbing scene by scene",
    ),
}


def final_issue(slug, last_key, cfg):
    return {
        "key": "VX",
        "title": "Final gate: full-coverage computer-use verification with video and screenshots",
        "type": "verification",
        "priority": "P0",
        "area": "qa" if slug == "07-session-seven" else "tests",
        "context": (
            "Tests alone do not prove the product works. This gate proves every element of the finished product by driving it the way a user does. "
            f"Environment: {cfg['env']}. Surface to cover: {cfg['surface']}. Method: {cfg['drive']}, recorded as one continuous screen video, plus screenshots of every element and state."
        ),
        "tasks": [
            "Build the element inventory `evidence/inventory.md`: one row per user-reachable element, state, command or tool, derived from the built product (routes, components, CLI help, MCP tool list) and from the PRD; no row may be omitted because it is hard to reach.",
            "Run the full automated suites from a clean clone (`bun install --frozen-lockfile`, lint, typecheck, unit, integration, e2e) and save the sanitized logs under evidence/tests/.",
            "Perform a computer-use walkthrough that touches every inventory row while screen recording continuously (ffmpeg x11grab/gdigrab or the platform recorder); say or overlay the row id when each element is exercised.",
            "Take at least one screenshot per inventory row (success state, and error state where one exists) named `evidence/screens/<row-id>.png`, and fill the coverage matrix in `evidence/coverage.md`: row id, video timestamp, screenshot file, covering test name, result.",
            "Run `bun run verify:coverage` (create it here): it fails if any inventory row lacks a screenshot file, a timestamp inside the video duration, or a result, and prints ffprobe duration/resolution of the video. Upload the video as a release asset and record its URL and sha256 in evidence/manifest.json.",
            "Have an agent that did not build the product re-run the suites and replay the walkthrough from a clean clone, and attach its own screenshots and verdict.",
        ],
        "acceptance_criteria": [
            "All automated suites pass from a clean clone with exit code 0; sanitized logs are committed.",
            "evidence/inventory.md covers every user-reachable element, state, command or tool in the shipped product, with no unexplained omissions.",
            "A continuous screen recording shows every inventory row being exercised through real interaction, with a timestamp per row in evidence/coverage.md.",
            "Every inventory row has a screenshot file, and `bun run verify:coverage` exits 0.",
            "An independent verifier's rerun matches the builder's results; any divergence is listed and resolved, not hidden.",
        ],
        "verification": (
            "From a clean clone run `bun install --frozen-lockfile && bun run lint && bun run typecheck && bun test` plus the e2e command listed in the README; expect exit 0 for each. "
            "Run `bun run verify:coverage`; expect exit 0 and output `rows=<N> screenshots=<N> timestamps=<N> missing=0` and ffprobe duration > 0. "
            "Open the video and spot-check at least five random rows by seeking to their timestamps and confirming the element on screen matches the row. "
            "Open the independent verifier's report and confirm every row shows PASS. Any missing row, screenshot, timestamp, failed test or unexplained divergence fails the gate."
        ),
        "prd_refs": ["All release requirements"],
        "depends_on": [last_key],
    }


def main():
    for f in sorted(glob.glob(f"{SPECS}/0*.json")):
        slug = f.split("/")[-1][:-5]
        s = json.load(open(f))
        s = fix(s)
        for it in s["issues"]:
            it["title"] = fix(it["title"])
            ov = OVERRIDES.get((slug, it["key"]))
            if ov:
                it.update(ov)
            add = APPEND_CONTEXT.get((slug, it["key"]))
            if add and add not in it["context"]:
                it["context"] += add
        if "areas" in s and slug == "07-session-seven" and "qa" not in s["areas"]:
            s["areas"].append("qa")
        if not any(i["key"] == "VX" for i in s["issues"]):
            s["issues"].append(final_issue(slug, s["issues"][-1]["key"], V[slug]))
        s["epic_done_when"] = [x for x in s["epic_done_when"] if "VX" not in x]
        extra = "Final gate passed: tests, a continuous computer-use video covering every element, per-element screenshots and an independent verifier's rerun are attached."
        if extra not in s["epic_done_when"]:
            s["epic_done_when"].append(extra)
        json.dump(s, open(f, "w"), indent=1, ensure_ascii=False)
        print(slug, len(s["issues"]))


if __name__ == "__main__":
    main()
