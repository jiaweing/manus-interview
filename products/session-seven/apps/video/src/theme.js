// Shared visual vocabulary. Accent colors belong to Pip / exterior scenery only.
export const PALETTE = Object.freeze({
  Paper: "#FFF7E8", Ink: "#20212B", Sun: "#FFD166", Mint: "#6DD6BC",
});
export const UI = Object.freeze({
  card: "#FAFAFA", panel: "#F4F4F5", ink: "#18181B", muted: "#71717A", white: "#FFFFFF",
});
export const FONT_FAMILY = '"Session Inter", Inter, sans-serif';
export const FONT_SIZES = Object.freeze({ caption: 60, label: 48, ui: 48 });
export const RADIUS = 10;
export const SAFE = Object.freeze({ x: 96, y: 54, width: 1728, height: 972, right: 1824, bottom: 1026 });

function luminance(hex) {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new TypeError(`Expected six-digit hex color: ${hex}`);
  const linear = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
export function contrastRatio(hex1, hex2) {
  const a = luminance(hex1);
  const b = luminance(hex2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
// Exhaustive supported reading pairs. Muted is permitted on card ONLY, not on
// panel (4.40:1) or dark CLI (3.67:1). Key text always uses ink / light text.
export const TEXT_PAIRS = Object.freeze([
  { name: "caption-paper", text: PALETTE.Ink, background: PALETTE.Paper },
  { name: "caption-plate", text: PALETTE.Ink, background: UI.white },
  { name: "label", text: UI.ink, background: UI.card },
  { name: "interface-card", text: UI.ink, background: UI.card },
  { name: "interface-panel", text: UI.ink, background: UI.panel },
  { name: "interface-secondary-card", text: UI.muted, background: UI.card },
  { name: "cli-dark", text: UI.card, background: UI.ink },
  { name: "button-dark", text: UI.white, background: UI.ink },
].map(Object.freeze));
