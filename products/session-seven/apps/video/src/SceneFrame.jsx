import { AbsoluteFill, useCurrentFrame } from "remotion";
import { FontLoader } from "./FontLoader.jsx";
import { Backdrop } from "./layers.jsx";
import { FONT_FAMILY, FONT_SIZES, PALETTE, RADIUS, SAFE, UI } from "./theme.js";
import { ILLUSTRATED_LABEL, READINESS_LABEL, SCENES, SEEDS, sceneStartFrame } from "./timeline.js";

const freezeRect = (rect) => Object.freeze({ ...rect, right: rect.x + rect.width, bottom: rect.y + rect.height });
export const SCENE_LAYOUT = Object.freeze({
  safe: SAFE,
  // Scene illustration children should fit here. All coordinates are SVG px.
  illustration: freezeRect({ x: 96, y: 224, width: 1728, height: 566 }),
  caption: freezeRect({ x: 96, y: 826, width: 1728, height: 200 }),
  captionPadding: 36,
  captionLineHeight: 72,
  label: freezeRect({ x: 96, y: 54, width: 432, height: 64 }),
  readiness: freezeRect({ x: 96, y: 128, width: 300, height: 64 }),
});

// Pure exports are also the source of truth for tests and builder layout QA.
export function captionGeometry(text) {
  const lines = text.split("\n");
  if (lines.length > 2) throw new Error("Caption exceeds two lines");
  const plate = SCENE_LAYOUT.caption;
  const height = lines.length * SCENE_LAYOUT.captionLineHeight;
  return Object.freeze({
    plate, lines: Object.freeze(lines),
    text: freezeRect({ x: plate.x + SCENE_LAYOUT.captionPadding,
      y: plate.y + (plate.height - height) / 2,
      width: plate.width - 2 * SCENE_LAYOUT.captionPadding, height }),
    fontSize: FONT_SIZES.caption,
  });
}
export function getScenePresentation(sceneId, localFrame) {
  const scene = SCENES.find((record) => record.id === sceneId);
  if (!scene) throw new Error(`Unknown scene: ${sceneId}`);
  const start = sceneStartFrame(scene);
  const caption = scene.captions.find(({ fromFrame, toFrame }) => localFrame >= fromFrame - start && localFrame < toFrame - start);
  const labels = scene.product ? [ILLUSTRATED_LABEL, READINESS_LABEL[scene.status]] : [];
  if (labels.some((label) => !label)) throw new Error(`Missing readiness label: ${sceneId}`);
  return Object.freeze({ scene, caption, labels: Object.freeze(labels),
    geometry: caption ? captionGeometry(caption.text) : null });
}
export const CaptionPlate = ({ text }) => {
  const geometry = captionGeometry(text);
  return <g data-caption={text}>
    <rect {...geometry.plate} rx={RADIUS} fill={UI.white} />
    <text textAnchor="middle" fill={PALETTE.Ink} fontFamily={FONT_FAMILY}
      fontWeight="700" fontSize={FONT_SIZES.caption}>
      {geometry.lines.map((line, i) => <tspan key={i} x="960"
        y={geometry.text.y + FONT_SIZES.caption + i * SCENE_LAYOUT.captionLineHeight}>{line}</tspan>)}
    </text>
  </g>;
};
export const LabelStack = ({ labels }) => <g data-label-stack="persistent">
  {labels.map((label, index) => {
    const rect = index === 0 ? SCENE_LAYOUT.label : SCENE_LAYOUT.readiness;
    return <g key={label} data-label={label}>
      <rect {...rect} rx={RADIUS} fill={UI.card} />
      <text x={rect.x + 24} y={rect.y + 49} fontFamily={FONT_FAMILY}
        fontSize={FONT_SIZES.label} fontWeight="600" fill={UI.ink}>{label}</text>
    </g>;
  })}
</g>;

// Hero's Sequence makes useCurrentFrame() RELATIVE to this scene (starts at 0).
// Children are SVG nodes in global film coordinates, rendered between scenery
// and fixed overlays. Intro/outro intentionally have captions only, no labels.
export const SceneFrame = ({ sceneId, children }) => {
  const frame = useCurrentFrame();
  const { caption, labels } = getScenePresentation(sceneId, frame);
  return <AbsoluteFill style={{ backgroundColor: PALETTE.Paper, fontFamily: FONT_FAMILY }}>
    <FontLoader />
    <svg width="1920" height="1080" viewBox="0 0 1920 1080" style={{ fontFamily: FONT_FAMILY }} data-scene={sceneId}>
      <Backdrop seed={SEEDS[sceneId]} />
      <g data-layer="illustration">{children}</g>
      {labels.length > 0 && <LabelStack labels={labels} />}
      {caption && <CaptionPlate text={caption.text} />}
    </svg>
  </AbsoluteFill>;
};
