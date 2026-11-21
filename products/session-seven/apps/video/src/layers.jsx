import { useId } from "react";
import { seeded } from "./anim.js";
import { PALETTE } from "./theme.js";

// All shared shapes live inside SceneFrame's 1920×1080 SVG. Containers use
// local coordinates: <Group x={...} y={...}>children at (0,0)</Group>.
export const Group = ({ x = 0, y = 0, scale = 1, children, ...props }) => (
  <g {...props} transform={`translate(${x} ${y}) scale(${scale})`}>{children}</g>
);
export const SoftShadow = ({ children, dx = 0, dy = 14, blur = 12, opacity = 0.16, color = PALETTE.Ink }) => {
  const id = `soft-shadow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return <>
    <defs><filter id={id} x="-50%" y="-50%" width="200%" height="220%" colorInterpolationFilters="sRGB">
      <feDropShadow dx={dx} dy={dy} stdDeviation={blur} floodColor={color} floodOpacity={opacity} />
    </filter></defs>
    <g filter={`url(#${id})`}>{children}</g>
  </>;
};
// For scenery only. Supply the SAME unfilled geometry as the foreground body;
// its inherited Ink fill forms one darker copy behind the flat foreground.
export const OffsetSilhouette = ({ x = 18, y = 20, opacity = 0.14, children }) => (
  <Group x={x} y={y} fill={PALETTE.Ink} opacity={opacity} data-layer="offset-silhouette">{children}</Group>
);

export function backdropShapes(seed = 7001) {
  const random = seeded(seed);
  return Object.freeze([
    Object.freeze({ x: 1440 + random() * 100, y: 240 + random() * 90, width: 240, height: 250, rx: 100, fill: PALETTE.Sun }),
    Object.freeze({ x: 200 + random() * 60, y: 530 + random() * 70, width: 330, height: 150, rx: 75, fill: PALETTE.Mint }),
    Object.freeze({ x: 1290 + random() * 60, y: 650 + random() * 30, width: 390, height: 100, rx: 50, fill: PALETTE.Mint }),
  ]);
}
export const Backdrop = ({ seed = 7001 }) => (
  <g data-layer="backdrop">
    <rect width="1920" height="1080" fill={PALETTE.Paper} />
    {backdropShapes(seed).map((shape, i) => <rect key={i} {...shape} />)}
  </g>
);
