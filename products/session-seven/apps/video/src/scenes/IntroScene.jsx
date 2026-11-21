import { useCurrentFrame } from "remotion";
import { SceneFrame } from "../SceneFrame.jsx";
import { Pip } from "../Pip.jsx";
import { Group, OffsetSilhouette, SoftShadow } from "../layers.jsx";
import { bar, beat, translateIn } from "../anim.js";
import { FONT_FAMILY, PALETTE } from "../theme.js";

// These are named scenery cards, not product interfaces. All six loose cards
// are readable from the first frame; Pip gathers them into place on six beats.
export const INTRO_TIMING = Object.freeze({
  tileStarts: Object.freeze([0, 1, 2, 3, 4, 5].map(beat)),
  tileDuration: beat(1),
  pipStart: beat(3),
  pipDuration: beat(3),
  settled: bar(1) + beat(2),
  end: bar(3),
  actionBlip: null,
});
export const INTRO_TILES = Object.freeze([
  { name: "Caret", fill: PALETTE.Ink, text: PALETTE.Paper },
  { name: "Flopside", fill: PALETTE.Paper, text: PALETTE.Ink },
  { name: "Patchbay", fill: PALETTE.Sun, text: PALETTE.Ink },
  { name: "Sidekick", fill: PALETTE.Mint, text: PALETTE.Ink },
  { name: "TetherTerm", fill: PALETTE.Ink, text: PALETTE.Paper },
  { name: "Glassroom", fill: PALETTE.Paper, text: PALETTE.Ink },
].map((tile, index) => Object.freeze({
  ...tile, x: 272 + (index % 3) * 520, y: index < 3 ? 236 : 518,
  width: 496, height: 250, fontSize: 56,
})));

export function introTileState(frame, index) {
  const tile = INTRO_TILES[index];
  const offset = translateIn(frame, INTRO_TIMING.tileStarts[index], INTRO_TIMING.tileDuration,
    { fromX: -18, fromY: index < 3 ? -8 : 8 });
  return { x: tile.x + offset.x, y: tile.y + offset.y };
}
export function introPipState(frame) {
  const offset = translateIn(frame, INTRO_TIMING.pipStart, INTRO_TIMING.pipDuration,
    { fromY: -260 });
  return { x: 108, y: 542 + offset.y, scale: 0.64,
    pose: frame < INTRO_TIMING.settled ? "pointing" : "happy" };
}
const SceneryTile = ({ tile, position }) => <Group {...position} data-scenery-tile={tile.name}>
  <OffsetSilhouette x={4} y={6} opacity={0.12}>
    <rect width={tile.width} height={tile.height} rx={28} />
  </OffsetSilhouette>
  <SoftShadow dy={8} blur={6} opacity={0.12}>
    <rect width={tile.width} height={tile.height} rx={28} fill={tile.fill} />
    <text x={tile.width / 2} y={tile.height / 2} dominantBaseline="central"
      textAnchor="middle" fontFamily={FONT_FAMILY} fontSize={tile.fontSize}
      fontWeight="700" fill={tile.text}>{tile.name}</text>
  </SoftShadow>
</Group>;

export const IntroScene = () => {
  const frame = useCurrentFrame();
  return <SceneFrame sceneId="intro">
    {INTRO_TILES.map((tile, index) => <SceneryTile key={tile.name}
      tile={tile} position={introTileState(frame, index)} />)}
    <Pip {...introPipState(frame)} />
  </SceneFrame>;
};
