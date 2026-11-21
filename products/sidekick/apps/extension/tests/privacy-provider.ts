import { turnRequestSchema } from "../../../packages/protocol/src";
import { createOpenRouterAdapter } from "../../server/src/agent/openrouter";
import type { Snapshot } from "../src/page/snapshot";

/** Exercise the production serializer, never a real provider/network call. */
export async function serializedPrivacyPayload(
	snapshot: Snapshot,
	toolResults: Snapshot[]
): Promise<string> {
	const request = turnRequestSchema.parse({
		goal: "Read permitted evidence",
		messages: toolResults.flatMap((result, index) => [
			{
				role: "assistant",
				text: "Read current permitted evidence",
				toolCall: {
					args: { tabId: snapshot.tabId },
					id: `read-${index}`,
					name: "observe",
				},
			},
			{
				result: JSON.stringify(result),
				role: "tool",
				toolCallId: `read-${index}`,
			},
		]),
		snapshot,
	});
	let body = "";
	const adapter = createOpenRouterAdapter(
		{ OPENROUTER_API_KEY: "test-token-not-secret" },
		((_url, options) => {
			body = String(options?.body);
			return Promise.resolve(
				Response.json({
					choices: [
						{
							finish_reason: "stop",
							message: { content: "Done", role: "assistant" },
						},
					],
				})
			);
		}) as typeof fetch
	);
	if (!adapter) {
		throw new Error("Synthetic adapter unavailable");
	}
	await adapter.turn(request, new AbortController().signal);
	return body;
}
