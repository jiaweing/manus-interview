import { useCurrentFrame } from "remotion";
import { SceneFrame } from "../SceneFrame.jsx";
import { Pip } from "../Pip.jsx";
import { beat, enter } from "../anim.js";
import { Cli, TextLine } from "../ui.jsx";
import { FIXTURES } from "../timeline.js";

// Sanitized illustration only: the locked fixture is never executed.
export const SESSION_ID = FIXTURES.tetherterm.sessionId;
export const ACTION_FRAME = beat(8); // local 120 / Hero 1260: input accepted
export const OUTPUT_FRAME = beat(12); // local 180 / Hero 1320: result, 60-frame hold
export const HISTORY = Object.freeze(FIXTURES.tetherterm.transcriptLines.slice(1, 4));
export const TETHERTERM_LAYOUT = Object.freeze({
  terminal: Object.freeze({ x: 580, y: 242, width: 1210, height: 536 }),
  session: Object.freeze({ x: 40, y: 78 }),
  history: Object.freeze({ x: 40, y: 146, spacing: 68 }),
  input: Object.freeze({ x: 40, y: 350 }),
  output: Object.freeze({ x: 40, y: 418 }),
  prompt: Object.freeze({ x: 40, y: 486 }),
});

export function getTetherTermState(frame) {
  // Zero-duration enter is a deterministic step. Reading lines are immediately
  // opaque on the action frame; no terminal entrance can hide its identifier.
  const inputAccepted = enter(frame, ACTION_FRAME, 0) === 1;
  const outputReady = enter(frame, OUTPUT_FRAME, 0) === 1;
  return Object.freeze({
    sessionId: SESSION_ID,
    history: HISTORY,
    inputAccepted,
    outputReady,
    input: inputAccepted ? FIXTURES.tetherterm.inputText : ">>>",
    output: outputReady ? FIXTURES.tetherterm.outputText : null,
  });
}

// One shared Cli surface owns the identifier, previous expressions and both
// new transcript lines. Nothing scrolls, clears or moves between frame states.
export const TetherTermTerminal = ({ frame }) => {
  const state = getTetherTermState(frame);
  const layout = TETHERTERM_LAYOUT;
  return <Cli {...layout.terminal}>
    <g data-role="session-id">
      <TextLine {...layout.session} text={state.sessionId} fontWeight={600} dark />
    </g>
    <g data-role="retained-history">
      {state.history.map((text, index) => <TextLine key={text}
        x={layout.history.x} y={layout.history.y + index * layout.history.spacing}
        text={text} dark />)}
    </g>
    <g data-role={state.inputAccepted ? "accepted-input" : "waiting-prompt"}>
      <TextLine {...layout.input} text={state.input} dark />
    </g>
    {state.outputReady && <g data-role="matching-output">
      <TextLine {...layout.output} text={state.output} dark />
      <TextLine {...layout.prompt} text=">>>" dark />
    </g>}
  </Cli>;
};

export const TetherTermScene = () => {
  const frame = useCurrentFrame();
  const { outputReady } = getTetherTermState(frame);
  return <SceneFrame sceneId="tetherterm">
    <Pip x={255} y={350} scale={1.1} pose={outputReady ? "happy" : "thinking"} />
    <TetherTermTerminal frame={frame} />
  </SceneFrame>;
};
