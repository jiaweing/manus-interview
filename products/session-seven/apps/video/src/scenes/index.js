import { IntroScene } from "./IntroScene.jsx";
import { CaretScene } from "./CaretScene.jsx";
import { FlopsideScene } from "./FlopsideScene.jsx";
import { PatchbayScene } from "./PatchbayScene.jsx";
import { SidekickScene } from "./SidekickScene.jsx";
import { TetherTermScene } from "./TetherTermScene.jsx";
import { GlassroomScene } from "./GlassroomScene.jsx";
import { OutroScene } from "./OutroScene.jsx";

export const SCENE_COMPONENTS = Object.freeze({
  intro: IntroScene,
  caret: CaretScene,
  flopside: FlopsideScene,
  patchbay: PatchbayScene,
  sidekick: SidekickScene,
  tetherterm: TetherTermScene,
  glassroom: GlassroomScene,
  outro: OutroScene,
});
