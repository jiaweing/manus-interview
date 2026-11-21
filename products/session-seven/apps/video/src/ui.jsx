import { Group, SoftShadow } from "./layers.jsx";
import { FONT_FAMILY, FONT_SIZES, RADIUS, UI } from "./theme.js";

// SVG-only, local-coordinate containers. Reading text uses bundled Inter;
// no bundled mono exists, so CLI deliberately uses Inter too.
export const Window = ({ x = 0, y = 0, width = 1100, height = 500, children }) => (
  <Group x={x} y={y} data-ui="window"><SoftShadow color={UI.ink}>
    <rect width={width} height={height} rx={RADIUS} fill={UI.card} />
    {children}
  </SoftShadow></Group>
);
export const Panel = ({ x = 0, y = 0, width = 900, height = 260, children }) => (
  <Group x={x} y={y} data-ui="panel">
    <rect width={width} height={height} rx={RADIUS} fill={UI.panel} />{children}
  </Group>
);
export const Row = ({ x = 0, y = 0, width = 900, height = 86, children }) => (
  <Panel x={x} y={y} width={width} height={height}>{children}</Panel>
);
export const TextLine = ({ x = 0, y = 0, text, children, fontSize = FONT_SIZES.ui,
  fontWeight = 400, tone = "primary", dark = false, textAnchor = "start" }) => (
  <text x={x} y={y} fontFamily={FONT_FAMILY} fontSize={Math.max(FONT_SIZES.ui, fontSize)}
    fontWeight={fontWeight} textAnchor={textAnchor}
    fill={dark ? UI.card : tone === "secondary" ? UI.muted : UI.ink}>{text ?? children}</text>
);
// Secondary text belongs on Window/card, not on Panel. Dark CLI text is light
// for AA contrast; muted gray is reserved for non-reading decoration there.
export const Cli = ({ x = 0, y = 0, width = 1100, height = 500, light = false, lines = [], children }) => (
  <Group x={x} y={y} data-ui={light ? "cli-light" : "cli-dark"}><SoftShadow color={UI.ink}>
    <rect width={width} height={height} rx={RADIUS} fill={light ? UI.card : UI.ink} />
    {lines.map((line, i) => <TextLine key={i} x={40} y={78 + i * 68} text={line} dark={!light} />)}
    {children}
  </SoftShadow></Group>
);
export const Button = ({ x = 0, y = 0, width = 330, height = 80, label, children, variant = "primary" }) => (
  <Group x={x} y={y} data-ui="button">
    <rect width={width} height={height} rx={RADIUS} fill={variant === "primary" ? UI.ink : UI.panel} />
    <text x={width / 2} y={height / 2} dominantBaseline="central" textAnchor="middle"
      fontFamily={FONT_FAMILY} fontSize={FONT_SIZES.ui} fontWeight="600"
      fill={variant === "primary" ? UI.white : UI.ink}>{label ?? children}</text>
  </Group>
);
export const Caret = ({ x = 0, y = 0, width = 8, height = 52, dark = false }) => (
  <rect x={x} y={y} width={width} height={height} fill={dark ? UI.card : UI.ink} data-ui="caret" />
);
// A fixed block, not a frame-blinking pointer.
export const Cursor = Caret;

// Glyphs are filled silhouettes / even-odd cutouts on a 24×24 grid.
const GLYPHS = Object.freeze({
  mic: "M9 3A3 3 0 0 1 15 3V10A3 3 0 0 1 9 10Z M5 8H7V10A5 5 0 0 0 17 10V8H19V10A7 7 0 0 1 13 16.93V20H17V22H7V20H11V16.93A7 7 0 0 1 5 10Z",
  keyboard: "M2 4H22V20H2Z M4 7V9H6V7Z M8 7V9H10V7Z M12 7V9H14V7Z M16 7V9H20V7Z M4 11V13H6V11Z M8 11V13H10V11Z M12 11V13H14V11Z M16 11V13H20V11Z M6 15V17H18V15Z",
  lock: "M6 10V7A6 6 0 0 1 18 7V10H20V22H4V10Z M9 10H15V7A3 3 0 0 0 9 7Z M11 14V18H13V14Z",
  "card-back": "M5 1H19Q21 1 21 3V21Q21 23 19 23H5Q3 23 3 21V3Q3 1 5 1Z M12 5L7 12L12 19L17 12Z",
  chip: "M12 1A11 11 0 1 1 12 23A11 11 0 1 1 12 1Z M12 6A6 6 0 1 0 12 18A6 6 0 1 0 12 6Z M10 9H14V15H10Z",
  globe: "M12 1A11 11 0 1 1 12 23A11 11 0 1 1 12 1Z M11 4Q8 7 8 10H11Z M13 4V10H16Q16 7 13 4Z M11 13H8Q8 17 11 20Z M13 13V20Q16 17 16 13Z M4 10H6Q6 7 7 5Q4 7 4 10Z M18 10H20Q20 7 17 5Q18 7 18 10Z M4 13Q4 17 7 19Q6 16 6 13Z M18 13Q18 16 17 19Q20 17 20 13Z",
  browser: "M1 3H23V21H1Z M3 8V19H21V8Z M3 5V6H5V5Z M7 5V6H9V5Z",
  "terminal-prompt": "M3 4L12 12L3 20L1 17L8 12L1 7Z M13 18H23V21H13Z",
  check: "M2 12L5 9L10 14L19 4L22 7L10 20Z",
  hourglass: "M5 1H19V4H17V7L13 12L17 17V20H19V23H5V20H7V17L11 12L7 7V4H5Z M9 4V6L12 10L15 6V4Z M9 20H15V18L12 14L9 18Z",
  pause: "M5 3H10V21H5Z M14 3H19V21H14Z",
});
export const ICON_NAMES = Object.freeze(Object.keys(GLYPHS));
export const Icon = ({ name, x = 0, y = 0, size = 48, dark = false }) => {
  const path = GLYPHS[name];
  if (!path) throw new Error(`Unknown monochrome icon: ${name}`);
  return <Group x={x} y={y} scale={size / 24} data-ui-icon={name}>
    <path d={path} fill={dark ? UI.card : UI.ink} fillRule="evenodd" />
  </Group>;
};
