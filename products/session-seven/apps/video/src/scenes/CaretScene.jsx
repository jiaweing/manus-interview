import { useCurrentFrame } from "remotion";
import { SceneFrame } from "../SceneFrame.jsx";
import { Pip } from "../Pip.jsx";
import { Group } from "../layers.jsx";
import { beat, bar, enter, hold, seeded, translateIn } from "../anim.js";
import { Caret, Icon, Panel, TextLine, Window } from "../ui.jsx";
import { UI, RADIUS } from "../theme.js";
import { FIXTURES, SEEDS } from "../timeline.js";

export const CARET_ACTION_FRAME = bar(2); // local 120 / absolute Hero 300
export const CARET_LISTEN_FRAME = beat(2); // local 30 / absolute Hero 210
export const CARET_SETTLE_FRAME = CARET_ACTION_FRAME + beat(1);
// Invented, short, sanitized illustration fixture; never a captured transcript.
export const CARET_TEXT = "Hello team";
export const CARET_SHORTCUT = Object.freeze(FIXTURES.caret.shortcut.split("+"));

export function caretSceneState(frame) {
  const inserted = enter(frame, CARET_ACTION_FRAME, 0) === 1;
  const listening = hold(frame, CARET_LISTEN_FRAME, CARET_ACTION_FRAME - CARET_LISTEN_FRAME);
  // Recreate the PRNG from a frame bucket: repeated/shuffled renders agree.
  // Heights change only once per beat; there is no continuous meter motion.
  const meter = seeded(SEEDS.caret + Math.floor(frame / beat(1)));
  const bars = Array.from({ length: 5 }, () => 18 + Math.floor(meter() * 4) * 12);
  return {
    inserted, listening,
    phase: inserted ? "inserted" : listening ? "listening" : "shortcut",
    pose: inserted ? "happy" : listening ? "listening" : "neutral",
    bars,
    // A slow frame-only block blink. Reading text never blinks.
    caretVisible: hold(frame % bar(1), 0, beat(3)),
    bubbleVisible: frame >= CARET_LISTEN_FRAME && frame < CARET_SETTLE_FRAME,
    transfer: enter(frame, CARET_ACTION_FRAME, beat(1)),
  };
}

const ShortcutCue = () => <Group x={48} y={340}>
  <Icon name="keyboard" x={0} y={12} size={56} />
  {CARET_SHORTCUT.map((label, index) => {
    const x = [92, 274, 440][index];
    const width = [132, 116, 186][index];
    return <g key={label} data-keycap={label}>
      <Panel x={x} y={0} width={width} height={80}>
        <TextLine x={width / 2} y={56} text={label} textAnchor="middle" fontWeight={600} />
      </Panel>
      {index < 2 && <TextLine x={x + width + 28} y={56} text="+" textAnchor="middle" />}
    </g>;
  })}
</Group>;

export const CaretScene = () => {
  const frame = useCurrentFrame(); // Hero Sequence supplies local 0..239.
  const state = caretSceneState(frame);
  return <SceneFrame sceneId="caret">
    <Pip x={268} y={428} scale={0.95} pose={state.pose} />
    <Window x={660} y={278} width={1040} height={452}>
      <TextLine x={48} y={84} text="Sample draft" fontWeight={600} />
      <Icon name={state.listening ? "mic" : "keyboard"} x={606} y={40} size={52} />
      <TextLine x={680} y={84} text={state.inserted ? "Inserted" : state.listening ? "Listening" : "Shortcut"} fontWeight={600} />
      <Panel x={48} y={132} width={944} height={164}>
        {state.inserted && <TextLine x={40} y={98} text={CARET_TEXT} />}
        {state.caretVisible && <Caret x={state.inserted ? 296 : 40} y={56} width={12} height={52} />}
        {state.listening && <g data-listening-meter="stepwise">
          {state.bars.map((height, index) => <rect key={index} x={730 + index * 30}
            y={82 - height / 2} width={16} height={height} rx={8} fill={UI.ink} />)}
        </g>}
      </Panel>
      <ShortcutCue />
    </Window>
    {state.bubbleVisible && <Group {...translateIn(frame, CARET_ACTION_FRAME, beat(1), { fromX: 0, fromY: 0, toX: 110, toY: 24 })}>
      <g opacity={1 - state.transfer} data-thought-bubble="dictation">
        <rect x={132} y={258} width={450} height={138} rx={RADIUS} fill={UI.white} />
        <TextLine x={176} y={344} text={CARET_TEXT} fontWeight={600} />
        <circle cx={392} cy={412} r={13} fill={UI.white} />
        <circle cx={376} cy={440} r={8} fill={UI.white} />
      </g>
    </Group>}
  </SceneFrame>;
};
