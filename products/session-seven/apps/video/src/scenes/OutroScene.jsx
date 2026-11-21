import { useCurrentFrame } from "remotion";
import { SceneFrame } from "../SceneFrame.jsx";
import { Pip } from "../Pip.jsx";
import { Group, OffsetSilhouette, SoftShadow } from "../layers.jsx";
import { bar, beat, translateIn } from "../anim.js";
import { FONT_FAMILY, PALETTE } from "../theme.js";

// Six individual scenery cards, each with its own shape, shadow and bounded
// entrance. Their generous whitespace stays visible through the final cut.
export const OUTRO_TIMING = Object.freeze({
  tileStarts: Object.freeze([0, 0, 1, 1, 2, 2].map(beat)),
  tileDuration: beat(1),
  pipStart: beat(0),
  pipDuration: beat(2),
  settled: beat(3),
  end: bar(3),
  actionBlip: null,
});
export const OUTRO_TILES = Object.freeze([
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

export function outroTileState(frame, index) {
  const tile = OUTRO_TILES[index];
  const offset = translateIn(frame, OUTRO_TIMING.tileStarts[index], OUTRO_TIMING.tileDuration,
    { fromX: -18, fromY: index < 3 ? -8 : 8 });
  return { x: tile.x + offset.x, y: tile.y + offset.y };
}
export function outroPipState(frame) {
  const offset = translateIn(frame, OUTRO_TIMING.pipStart, OUTRO_TIMING.pipDuration,
    { fromY: 12 });
  return { x: 108, y: 450 + offset.y, scale: 0.64, pose: "waving" };
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

export const OutroScene = () => {
  const frame = useCurrentFrame();
  return <SceneFrame sceneId="outro">
    {OUTRO_TILES.map((tile, index) => <SceneryTile key={tile.name}
      tile={tile} position={outroTileState(frame, index)} />)}
    <Pip {...outroPipState(frame)} />
  </SceneFrame>;
};
