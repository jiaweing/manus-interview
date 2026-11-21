// Foundation placeholder: the assigned scene builder replaces this file.
import { useCurrentFrame } from "remotion";
import { SceneFrame } from "../SceneFrame.jsx";
import { Pip } from "../Pip.jsx";
import { Group } from "../layers.jsx";
import { translateIn, beat } from "../anim.js";
import { Panel, TextLine, Window } from "../ui.jsx";

export const TetherTermScene = () => {
  const frame = useCurrentFrame(); // local frame, not absolute Hero frame
  return <SceneFrame sceneId="tetherterm">
    <Pip x={300} y={350} scale={1.15} pose="happy" />
    <Group {...translateIn(frame, beat(2), beat(2), { fromY: 18 })}>
      <Window x={660} y={278} width={1040} height={452}>
        <TextLine x={48} y={94} text="Illustration placeholder" fontWeight={600} />
        <Panel x={48} y={142} width={944} height={248}>
          <TextLine x={40} y={90} text="Scene artwork follows." />
        </Panel>
      </Window>
    </Group>
  </SceneFrame>;
};
