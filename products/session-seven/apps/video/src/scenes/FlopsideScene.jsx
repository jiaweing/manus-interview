import { useCurrentFrame } from "remotion";
import { SceneFrame } from "../SceneFrame.jsx";
import { Pip } from "../Pip.jsx";
import { Group } from "../layers.jsx";
import { bar, beat, enter, translateIn } from "../anim.js";
import { Icon, Panel, TextLine, Window } from "../ui.jsx";
import { RADIUS, UI } from "../theme.js";
import { FIXTURES } from "../timeline.js";

export const WAGER_FRAME = bar(2);
export const SHOWDOWN_FRAME = bar(3);
// Invented public illustration fixtures, never a running match or private data.
const card = (rank, suit) => Object.freeze({ rank, suit });
export const FLOPSIDE_CARDS = Object.freeze({
  board: Object.freeze([card("Q", "spade"), card("7", "diamond"), card("4", "club"), card("J", "heart"), card("2", "club")]),
  hands: Object.freeze([
    Object.freeze([card("A", "spade"), card("A", "heart")]),
    Object.freeze([card("K", "spade"), card("K", "heart")]),
  ]),
});
const SUITS = Object.freeze({
  spade: "M12 1C9 5 2 9 2 14C2 19 8 20 11 16L9 23H15L13 16C16 20 22 19 22 14C22 9 15 5 12 1Z",
  heart: "M12 22L3 13C-3 5 6 -2 12 5C18 -2 27 5 21 13Z",
  diamond: "M12 1L22 12L12 23L2 12Z",
  club: "M12 1A5 5 0 0 0 7 6C7 8 8 9 9 10C2 7 -1 14 3 18C6 21 10 18 11 16L9 23H15L13 16C14 18 18 21 21 18C25 14 22 7 15 10C16 9 17 8 17 6A5 5 0 0 0 12 1Z",
});

export function getFlopsideState(frame) {
  const wagerPlaced = frame >= WAGER_FRAME;
  const revealed = frame >= SHOWDOWN_FRAME;
  return Object.freeze({
    wagerPlaced, revealed,
    chipLabel: "Play chips",
    wager: wagerPlaced ? FIXTURES.flopside.wagerChips : 0,
    total: wagerPlaced ? FIXTURES.flopside.potChips : 0,
    result: revealed ? FIXTURES.flopside.showdownText.split(": ")[1] : null,
    seats: Object.freeze(FIXTURES.flopside.seats.map((name, index) => Object.freeze({
      name,
      chips: FIXTURES.flopside.startingChips - (wagerPlaced ? FIXTURES.flopside.wagerChips : 0),
      cards: revealed ? FLOPSIDE_CARDS.hands[index] : null,
    }))),
  });
}

const PlayingCard = ({ x, y, value, backed = false, width = 116, height = 170 }) => (
  <Group x={x} y={y} data-card={backed ? "private-back" : "face"}>
    <rect width={width} height={height} rx={RADIUS} fill={UI.card} />
    {backed ? <Icon name="card-back" x={-14} y={18} size={144} /> : <>
      <TextLine x={18} y={62} text={value.rank} fontWeight={600} />
      <Group x={width / 2 - 24} y={height - 60} scale={2}>
        <path d={SUITS[value.suit]} fill={UI.ink} />
      </Group>
    </>}
  </Group>
);

const Seat = ({ x, seat }) => (
  <Group x={x} data-seat={seat.name}>
    <TextLine x={160} y={136} text={seat.name} textAnchor="middle" fontWeight={600} />
    <Panel y={160} width={320} height={340}>
      {[0, 1].map((index) => <PlayingCard key={index} x={34 + index * 136} y={24}
        value={seat.cards?.[index]} backed={!seat.cards} />)}
      <Icon name="chip" x={34} y={242} size={48} />
      <TextLine x={100} y={283} text={String(seat.chips) + " chips"} />
    </Panel>
  </Group>
);

// The pure table helper also permits frame-by-frame markup checks without hooks.
export const FlopsideTable = ({ frame }) => {
  const state = getFlopsideState(frame);
  const wagerProgress = enter(frame, WAGER_FRAME, beat(1));
  return <Window x={400} y={244} width={1380} height={526}>
    <TextLine x={40} y={67} text="Friends' table" fontWeight={600} />
    <TextLine x={1340} y={67} text="Free chips" textAnchor="end" fontWeight={600} />
    <Seat x={28} seat={state.seats[0]} />
    <Seat x={1032} seat={state.seats[1]} />
    <Group data-shared-table="one">
      <TextLine x={690} y={136} text={state.revealed ? "Shared showdown" : "Private hands"}
        textAnchor="middle" fontWeight={600} />
      <Panel x={392} y={160} width={596} height={180}>
        {FLOPSIDE_CARDS.board.map((value, index) => <PlayingCard key={index}
          x={30 + index * 110} y={18} width={96} height={142} value={value} />)}
      </Panel>
      {state.wagerPlaced && <Group data-wager="play-chips" y={18 * (1 - wagerProgress)}>
        <Icon name="chip" x={476} y={360} size={48} />
        <Icon name="chip" x={492} y={368} size={48} />
        <TextLine x={556} y={408} text={String(state.total) + " " + state.chipLabel.toLowerCase()} fontWeight={600} />
      </Group>}
      {state.revealed ? <g data-shared-result="one">
        <TextLine x={690} y={484} text={state.result} textAnchor="middle" fontWeight={600} />
      </g> : <TextLine x={690} y={484} text={state.wagerPlaced ? String(state.wager) + " each" : "Cards stay private"}
        textAnchor="middle" />}
    </Group>
  </Window>;
};

export const FlopsideScene = () => {
  const frame = useCurrentFrame();
  return <SceneFrame sceneId="flopside">
    <Pip x={140} y={410} scale={0.9} pose="happy" />
    <Group {...translateIn(frame, 0, beat(2), { fromY: 12 })}>
      <FlopsideTable frame={frame} />
    </Group>
  </SceneFrame>;
};
