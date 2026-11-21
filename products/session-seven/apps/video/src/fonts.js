import { staticFile } from "remotion";

export const FONT_NAME = "Session Inter";
export const FONT_WEIGHTS = Object.freeze([400, 600, 700]);
export const FONT_FILES = Object.freeze(FONT_WEIGHTS.map((weight) => `fonts/inter-latin-${weight}-normal.woff2`));
export const fontFaceCss = () => FONT_WEIGHTS.map((weight, index) => `@font-face {
  font-family: '${FONT_NAME}'; font-style: normal; font-weight: ${weight};
  src: url('${staticFile(FONT_FILES[index])}') format('woff2');
  font-display: block;
}`).join("\n");
