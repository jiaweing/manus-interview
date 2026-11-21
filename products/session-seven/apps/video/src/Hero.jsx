import { Sequence } from "remotion";
import { SCENES, sceneStartFrame, sceneEndFrame } from "./timeline.js";
import { SCENE_COMPONENTS } from "./scenes/index.js";

export const Hero = () => <>
  {SCENES.map((scene) => {
    const Scene = SCENE_COMPONENTS[scene.id];
    return <Sequence key={scene.id} from={sceneStartFrame(scene)}
      durationInFrames={sceneEndFrame(scene) - sceneStartFrame(scene)}>
      <Scene />
    </Sequence>;
  })}
</>;
