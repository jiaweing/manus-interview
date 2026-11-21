import { Group, OffsetSilhouette, SoftShadow } from "./layers.jsx";
import { PALETTE } from "./theme.js";

export const PIP_BODY = Object.freeze({ width: 200, height: 300, rx: 100 });
// Facial choices and a tiny detached accent are whole static drawings, not a
// rig. No pose uses frame, rotation, articulated limbs, or mutable simulation.
export const PIP_POSES = Object.freeze({
  neutral: Object.freeze({ eyes: "round", mouth: "M80 166 Q100 180 120 166 Q100 192 80 166Z", accentX: 0, accentY: 0 }),
  happy: Object.freeze({ eyes: "happy", mouth: "M72 164 H128 Q100 216 72 164Z", accentX: 0, accentY: 0 }),
  listening: Object.freeze({ eyes: "round", mouth: "M89 175 A11 15 0 1 0 111 175 A11 15 0 1 0 89 175Z", accentX: -12, accentY: -8 }),
  thinking: Object.freeze({ eyes: "thinking", mouth: "M90 178 Q104 169 118 178 L118 185 Q104 178 90 185Z", accentX: 12, accentY: -10 }),
  pointing: Object.freeze({ eyes: "round", mouth: "M80 166 Q100 180 120 166 Q100 192 80 166Z", accentX: 46, accentY: 12 }),
  waving: Object.freeze({ eyes: "happy", mouth: "M72 164 H128 Q100 216 72 164Z", accentX: 30, accentY: -28 }),
});
const Capsule = (props) => <rect {...PIP_BODY} {...props} />;
const Eyes = ({ variant }) => {
  if (variant === "happy") return <path d="M52 119 Q64 88 76 119 L69 119 Q64 105 59 119Z M124 119 Q136 88 148 119 L141 119 Q136 105 131 119Z" />;
  if (variant === "thinking") return <path d="M52 104 H78 V115 H52Z M124 96 H150 V107 H124Z" />;
  return <><circle cx="64" cy="110" r="12" /><circle cx="136" cy="110" r="12" /></>;
};
export const Pip = ({ x = 0, y = 0, scale = 1, pose = "neutral" }) => {
  const variant = PIP_POSES[pose];
  if (!variant) throw new Error(`Unknown Pip pose: ${pose}`);
  return <Group x={x} y={y} scale={scale} data-pip-pose={pose}>
    <OffsetSilhouette><Capsule /></OffsetSilhouette>
    <SoftShadow>
      <Capsule fill={PALETTE.Paper} data-pip-body="capsule" />
      <g fill={PALETTE.Ink}><Eyes variant={variant.eyes} /><path d={variant.mouth} /></g>
      {pose !== "neutral" && pose !== "happy" && <Group x={variant.accentX} y={variant.accentY}>
        <circle cx="183" cy="70" r="18" fill={pose === "listening" ? PALETTE.Mint : PALETTE.Sun} />
      </Group>}
    </SoftShadow>
  </Group>;
};
