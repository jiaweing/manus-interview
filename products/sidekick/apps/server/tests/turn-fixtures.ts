import { mock } from "bun:test";
import type { TurnRequest, TurnResponse } from "../../../packages/protocol/src";

export const TEST_TOKEN = "test-token-not-secret";
export const SERVER_KEY_SENTINEL = "SERVER_KEY_SENTINEL_NOT_A_REAL_KEY_79";

export const VALID_TURN: TurnRequest = {
	goal: "Read the page",
	messages: [],
	snapshot: {
		documentToken: "document-1",
		elements: [
			{
				enabled: true,
				href: "https://example.com/notes",
				index: 1,
				name: "Notes",
				role: "link",
			},
		],
		snapshotId: "snapshot-1",
		tabId: 1,
		text: "Ada Lovelace published notes on the Analytical Engine.",
		title: "Ada Lovelace",
		truncated: false,
		url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
	},
};

/** No network or browser execution: contract tests inject only this adapter. */
export function fakeAdapter(
	response: unknown = { text: "Adapter test response" } satisfies TurnResponse
) {
	return {
		turn: mock(async (_request: TurnRequest, _signal: AbortSignal) => response),
	};
}
