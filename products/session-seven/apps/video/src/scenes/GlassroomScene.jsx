import { useCurrentFrame } from "remotion";
import { SceneFrame } from "../SceneFrame.jsx";
import { Pip } from "../Pip.jsx";
import { Group } from "../layers.jsx";
import { bar, beat, enter, translateIn } from "../anim.js";
import { Icon, Panel, TextLine, Window } from "../ui.jsx";
import { FIXTURES } from "../timeline.js";

export const GLASSROOM_ACTION_FRAME = bar(2);
export const GLASSROOM_RESULT_FRAME = bar(3);
export const GLASSROOM_SAMPLE = Object.freeze({
  // Short, sanitized display excerpts; all glyphs are a fixed drawing.
  participants: Object.freeze(["You", "Friend"]),
  message: `${FIXTURES.glassroom.plaintext.split(" ")[0]} friend`,
  reply: "Hi there",
  glyphs: Object.freeze(["7A", "#?", "2C", "x+", "90", "B1"]),
});
export const GLASSROOM_LAYOUT = Object.freeze({
  left: Object.freeze({ x: 160, y: 310, width: 560, height: 354 }),
  right: Object.freeze({ x: 1200, y: 310, width: 560, height: 354 }),
  drawing: Object.freeze({ x: 760, y: 300, width: 400, height: 314 }),
});

export function getGlassroomState(frame) {
  return Object.freeze({
    drawingVisible: enter(frame, GLASSROOM_ACTION_FRAME, 0) === 1,
    resultVisible: enter(frame, GLASSROOM_RESULT_FRAME, 0) === 1,
  });
}

const MessageView = ({ side, label, message, layout }) => (
  <g data-participant={side}>
    <Window {...layout}>
      <TextLine x={32} y={74} text={label} fontWeight={600} />
      <TextLine x={32} y={138} text="Sample text" tone="secondary" />
      <Panel x={32} y={176} width={496} height={112}>
        <TextLine x={24} y={70} text={message} />
      </Panel>
    </Window>
  </g>
);

export const GlassroomArtwork = ({ frame }) => {
  const state = getGlassroomState(frame);
  return <>
    <Group {...translateIn(frame, 0, beat(2), { fromY: 12 })}>
      <MessageView side="left" label={GLASSROOM_SAMPLE.participants[0]}
        message={GLASSROOM_SAMPLE.message} layout={GLASSROOM_LAYOUT.left} />
      <MessageView side="right" label={GLASSROOM_SAMPLE.participants[1]}
        message={state.resultVisible ? GLASSROOM_SAMPLE.message : GLASSROOM_SAMPLE.reply}
        layout={GLASSROOM_LAYOUT.right} />
    </Group>
    {state.drawingVisible && <g data-ciphertext="illustrative">
      <Group {...translateIn(frame, GLASSROOM_ACTION_FRAME, beat(1), { fromY: 12 })}>
        <Group x={GLASSROOM_LAYOUT.drawing.x} y={GLASSROOM_LAYOUT.drawing.y}>
          <TextLine x={200} y={48} text="Illustrative" textAnchor="middle" fontWeight={600} />
          <TextLine x={200} y={106} text="ciphertext" textAnchor="middle" />
          <Icon name="lock" x={176} y={122} size={48} />
          {GLASSROOM_SAMPLE.glyphs.map((glyph, index) => (
            <Panel key={glyph} x={52 + (index % 3) * 102} y={184 + Math.floor(index / 3) * 70}
              width={90} height={60}>
              <TextLine x={45} y={47} text={glyph} textAnchor="middle" fontWeight={600} />
            </Panel>
          ))}
        </Group>
      </Group>
    </g>}
    <Pip x={915} y={626} scale={0.45} pose={state.resultVisible ? "happy" : "thinking"} />
  </>;
};

export const GlassroomScene = () => {
  const frame = useCurrentFrame();
  return <SceneFrame sceneId="glassroom">
    <GlassroomArtwork frame={frame} />
  </SceneFrame>;
};
