import { useCurrentFrame } from "remotion";
import { SceneFrame } from "../SceneFrame.jsx";
import { Pip } from "../Pip.jsx";
import { Group } from "../layers.jsx";
import { bar, beat, enter, translateIn } from "../anim.js";
import { Button, Icon, Panel, Row, TextLine, Window } from "../ui.jsx";
import { UI } from "../theme.js";
import { FIXTURES } from "../timeline.js";

export const SIDEKICK_FRAMES = Object.freeze({
  planStart: beat(1),
  planReady: beat(2),
  action: bar(2),
  approval: bar(3),
});

// Short, invented browser copy; no connection to a real page or extension.
export const SIDEKICK_COPY = Object.freeze({
  pageTitle: FIXTURES.sidekick.pageTitle,
  steps: Object.freeze(["1 Find heading", "2 Submit draft"]),
  heading: "Sample heading",
  draft: "Draft: Hello team",
});

export const sidekickState = (frame) => Object.freeze({
  planOpacity: enter(frame, SIDEKICK_FRAMES.planStart, beat(1)),
  // A discrete onset makes the illustrated click visible on frame 120 itself.
  actionVisible: enter(frame, SIDEKICK_FRAMES.action, 0) === 1,
  approvalPending: frame >= SIDEKICK_FRAMES.approval,
  gatedStepExecuted: false,
});

// Filled monochrome pointer: it targets only the routine page navigation.
const PagePointer = () => <path d="M0 0L0 62L16 46L30 74L44 67L30 40L53 40Z" fill={UI.ink} />;

export const SidekickScene = () => {
  const frame = useCurrentFrame();
  const state = sidekickState(frame);
  return <SceneFrame sceneId="sidekick">
    <Pip x={126} y={444} scale={0.85} pose={state.approvalPending ? "thinking" : "pointing"} />
    <Group {...translateIn(frame, 0, beat(2), { fromY: 8 })}>
      <Window x={380} y={234} width={1430} height={548}>
        <Row x={28} y={24} width={700} height={72}>
          <Icon name="browser" x={24} y={12} size={48} />
          <TextLine x={92} y={54} text={SIDEKICK_COPY.pageTitle} fontWeight={600} />
        </Row>
        <TextLine x={52} y={166} text="Draft page" fontWeight={600} />
        <Button x={52} y={202} width={470} height={80} label="Find heading"
          variant={state.actionVisible ? "primary" : "secondary"} />
        <Panel x={28} y={326} width={700} height={190}>
          {state.actionVisible ? <g data-illustrated-action="heading-found">
            <TextLine x={24} y={68} text={SIDEKICK_COPY.heading} fontWeight={600} />
            <TextLine x={24} y={140} text={SIDEKICK_COPY.draft} />
          </g> : <TextLine x={24} y={104} text="Find the heading first." />}
        </Panel>
        {state.actionVisible && <Group x={492} y={250}>
          <Group {...translateIn(frame, SIDEKICK_FRAMES.action, beat(1), { fromY: 8 })}>
            <PagePointer />
          </Group>
        </Group>}
        <Panel x={756} y={24} width={646} height={500}>
          <TextLine x={28} y={64} text="Plan" fontWeight={700} />
          <TextLine x={614} y={64} text={state.approvalPending ? "Paused" : state.actionVisible ? "Acting" : "Ready"}
            textAnchor="end" />
          <g opacity={state.planOpacity} data-plan="visible">
            <g data-step="1" data-active={state.actionVisible && !state.approvalPending}>
              {state.actionVisible && !state.approvalPending
                ? <Button x={24} y={96} width={598} height={80} label={SIDEKICK_COPY.steps[0]} />
                : <Row x={24} y={96} width={598} height={80}>
                  <TextLine x={24} y={58} text={SIDEKICK_COPY.steps[0]} fontWeight={600} />
                </Row>}
            </g>
            <Row x={24} y={204} width={598} height={80}>
              <g data-step="2" data-gate="pending" data-executed={state.gatedStepExecuted}>
                <TextLine x={24} y={58} text={SIDEKICK_COPY.steps[1]} fontWeight={600} />
                <Icon name="lock" x={526} y={16} size={48} />
              </g>
            </Row>
          </g>
          {state.approvalPending && <g data-approval="pending">
            <Window x={24} y={300} width={598} height={184}>
              <TextLine x={12} y={46} text="Approve?" fontWeight={700} />
              <Icon name="hourglass" x={330} y={4} size={48} />
              <TextLine x={586} y={46} text="Pending" textAnchor="end" />
              <Button x={12} y={92} width={272} height={80} label="Approve" variant="secondary" />
              <Button x={314} y={92} width={272} height={80} label="Reject" variant="secondary" />
            </Window>
          </g>}
        </Panel>
      </Window>
    </Group>
  </SceneFrame>;
};
