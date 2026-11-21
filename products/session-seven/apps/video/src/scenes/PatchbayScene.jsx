import { useCurrentFrame } from "remotion";
import { SceneFrame } from "../SceneFrame.jsx";
import { Pip } from "../Pip.jsx";
import { beat, bar, enter, hold } from "../anim.js";
import { FIXTURES } from "../timeline.js";
import { Caret, Cli, TextLine } from "../ui.jsx";

// Local frames; Hero supplies the [660,900) Sequence. These are illustrated
// fixture requests, not calls to a plugin, model, or filesystem.
export const PATCHBAY_EVENTS = Object.freeze({
  discovery: beat(2),
  inspectableResult: bar(2),
  writeRequest: beat(11),
  awaitingApproval: bar(3),
});
export const PATCHBAY_CLI = Object.freeze({
  x: 410, y: 252, width: 1370, height: 508,
  textX: 40, firstBaseline: 78, lineHeight: 68, caretX: 752,
});

// Shortened from the sanitized shared fixture; the request is deliberately
// separate from the read-only capability. No executable write command exists.
export const PATCHBAY_LINES = Object.freeze([
  Object.freeze({ at: 0, text: "Local demo · not executed" }),
  Object.freeze({ at: PATCHBAY_EVENTS.discovery, text: "› patchbay plugin list" }),
  Object.freeze({ at: PATCHBAY_EVENTS.inspectableResult,
    text: FIXTURES.patchbay.transcriptLines[1].replace(" (illustrated)", "") }),
  Object.freeze({ at: PATCHBAY_EVENTS.inspectableResult,
    text: FIXTURES.patchbay.transcriptLines[2].replace("Capability: ", "") }),
  Object.freeze({ at: PATCHBAY_EVENTS.writeRequest,
    text: FIXTURES.patchbay.transcriptLines[4].replace("Illustrated write request:", "Write request:") }),
  Object.freeze({ at: PATCHBAY_EVENTS.awaitingApproval, text: "Write paused: approve? [y/N]" }),
]);

export function getPatchbayTranscript(frame) {
  return PATCHBAY_LINES.filter(({ at }) => enter(frame, at, 0) === 1).map(({ text }) => text);
}
export function patchbayCaretVisible(frame) {
  // One slow blink per three beats; key approval text never blinks or leaves.
  return frame >= PATCHBAY_EVENTS.awaitingApproval
    && hold((frame - PATCHBAY_EVENTS.awaitingApproval + beat(1)) % beat(3), 0, beat(2));
}

export const PatchbayScene = () => {
  const frame = useCurrentFrame();
  return <SceneFrame sceneId="patchbay">
    <Pip x={128} y={378} scale={0.92} pose="thinking" />
    <Cli x={PATCHBAY_CLI.x} y={PATCHBAY_CLI.y}
      width={PATCHBAY_CLI.width} height={PATCHBAY_CLI.height}>
      {PATCHBAY_LINES.map(({ at, text }, index) => (
        <g key={text} opacity={enter(frame, at, 0)} data-transcript-frame={at}>
          <TextLine x={PATCHBAY_CLI.textX}
            y={PATCHBAY_CLI.firstBaseline + index * PATCHBAY_CLI.lineHeight}
            text={text} dark fontWeight={index === 5 ? 600 : 400} />
        </g>
      ))}
      {patchbayCaretVisible(frame) && <Caret x={PATCHBAY_CLI.caretX}
        y={PATCHBAY_CLI.firstBaseline + 5 * PATCHBAY_CLI.lineHeight - 42}
        width={24} height={48} dark />}
    </Cli>
  </SceneFrame>;
};
