import { AbsoluteFill, useCurrentFrame } from "remotion";
import { FontLoader } from "../FontLoader.jsx";
import { CaptionPlate, LabelStack } from "../SceneFrame.jsx";
import { Pip, PIP_POSES } from "../Pip.jsx";
import { Backdrop, Group, OffsetSilhouette, SoftShadow } from "../layers.jsx";
import { Button, Caret, Cli, Icon, ICON_NAMES, Panel, Row, TextLine, Window } from "../ui.jsx";
import { FONT_FAMILY, PALETTE } from "../theme.js";
import { ILLUSTRATED_LABEL, READINESS_LABEL } from "../timeline.js";

export const GALLERY_FRAMES = Object.freeze([0, 60, 120, 180]);
const CAPTIONS = Object.freeze([
  "Pip — Six static poses.", "Monochrome surfaces.\nNo interface lines.",
  "Filled glyphs.\nQuiet, readable interfaces.", "Concept and Prototype\nstay distinct.",
]);
const SHORT_ICON_NAMES = { "card-back": "cards", "terminal-prompt": "prompt" };
export const PrimitivesGallery = () => {
  const page = Math.min(3, Math.floor(useCurrentFrame() / 60));
  return <AbsoluteFill style={{ backgroundColor: PALETTE.Paper, fontFamily: FONT_FAMILY }}>
    <FontLoader />
    <svg width="1920" height="1080" viewBox="0 0 1920 1080">
      <Backdrop seed={7001} />
      {page === 0 && <>
        {Object.keys(PIP_POSES).map((pose, i) => <Group key={pose} x={182 + i * 270} y={318}>
          <Pip scale={0.9} pose={pose} />
          <TextLine x={90} y={350} text={pose} textAnchor="middle" />
        </Group>)}
      </>}
      {page === 1 && <>
        <Window x={150} y={248} width={910} height={530}>
          <TextLine x={40} y={82} text="Sample interface" fontWeight={700} />
          <TextLine x={40} y={148} text="Secondary on card only" tone="secondary" />
          <Panel x={40} y={178} width={830} height={128}>
            <Icon name="mic" x={28} y={35} size={58} />
            <TextLine x={118} y={84} text="A readable panel" />
          </Panel>
          <Row x={40} y={326} width={830} height={80}>
            <TextLine x={28} y={57} text="Whitespace separates rows" />
          </Row>
          <Button x={40} y={426} width={290} label="Approve" />
          <Button x={350} y={426} width={260} label="Pause" variant="secondary" />
        </Window>
        <Cli x={1110} y={248} width={660} height={530}
          lines={["> inspect", "read-only", "result: sample", "> approval", "pending"]}>
          <Caret x={390} y={312} dark />
          <Icon name="terminal-prompt" x={40} y={414} size={60} dark />
          <TextLine x={124} y={468} text="Inter only" dark />
        </Cli>
      </>}
      {page === 2 && <Window x={140} y={248} width={1640} height={530}>
        {ICON_NAMES.map((name, i) => <Group key={name} x={80 + (i % 6) * 264} y={50 + Math.floor(i / 6) * 245}>
          <Icon name={name} x={58} size={88} />
          <TextLine x={100} y={162} text={SHORT_ICON_NAMES[name] ?? name} textAnchor="middle" />
        </Group>)}
      </Window>}
      {page === 3 && <>
        <Group x={240} y={292}>
          <OffsetSilhouette><rect width={460} height={310} rx={90} /></OffsetSilhouette>
          <SoftShadow><rect width={460} height={310} rx={90} fill={PALETTE.Sun} /></SoftShadow>
          <rect x={180} y={220} width={440} height={170} rx={85} fill={PALETTE.Mint} />
          <Pip x={200} y={20} scale={0.85} pose="thinking" />
        </Group>
        <Window x={1020} y={280} width={740} height={400}>
          <TextLine x={40} y={90} text="Readiness is evidence-led." />
          <TextLine x={40} y={174} text={READINESS_LABEL.concept} fontWeight={700} />
          <TextLine x={40} y={254} text={READINESS_LABEL.prototype} fontWeight={700} />
          <TextLine x={40} y={336} text="Both are illustrations." />
        </Window>
      </>}
      <LabelStack labels={[ILLUSTRATED_LABEL, page === 3 ? READINESS_LABEL.prototype : READINESS_LABEL.concept]} />
      <CaptionPlate text={CAPTIONS[page]} />
    </svg>
  </AbsoluteFill>;
};
