import { z } from "zod";

const NONBLANK = /\S/;
const nonblank = (max: number) => z.string().max(max).regex(NONBLANK);
const identifier = nonblank(200);
const tabId = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const index = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const httpUrlSchema = z
	.url()
	.max(8192)
	.refine((value) => {
		try {
			const url = new URL(value);
			return (
				(url.protocol === "https:" || url.protocol === "http:") &&
				!url.username &&
				!url.password
			);
		} catch {
			return false;
		}
	}, "Expected a credential-free HTTP(S) URL");

export const snapshotSchema = z
	.strictObject({
		documentToken: identifier,
		elements: z
			.array(
				z.strictObject({
					enabled: z.boolean(),
					href: z.string().max(8192).optional(),
					index,
					inputType: z.string().max(100).optional(),
					name: z.string().max(2000),
					role: z.string().max(200),
				})
			)
			.max(300),
		snapshotId: identifier,
		tabId,
		text: z.string().max(20_000),
		title: z.string().max(2000),
		truncated: z.boolean(),
		url: httpUrlSchema,
	})
	.refine(
		(snapshot) =>
			new Set(snapshot.elements.map((element) => element.index)).size ===
			snapshot.elements.length,
		"Element indexes must be unique"
	);

/** One source of truth for both local validation and provider JSON schemas. */
export const toolArgsSchemas = {
	click: z.strictObject({ index }),
	fill: z.strictObject({ index, value: z.string().max(20_000) }),
	findText: z.strictObject({ query: nonblank(2000) }),
	finish: z.strictObject({ summary: nonblank(20_000) }),
	observe: z.strictObject({ query: nonblank(2000).optional(), tabId }),
	openTab: z.strictObject({ url: httpUrlSchema }),
	scroll: z.strictObject({
		direction: z.enum(["up", "down"]),
		pixels: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	}),
	switchTab: z.strictObject({ tabId }),
};

export const toolCallSchema = z.discriminatedUnion("name", [
	z.strictObject({
		args: toolArgsSchemas.observe,
		id: identifier,
		name: z.literal("observe"),
	}),
	z.strictObject({
		args: toolArgsSchemas.findText,
		id: identifier,
		name: z.literal("findText"),
	}),
	z.strictObject({
		args: toolArgsSchemas.scroll,
		id: identifier,
		name: z.literal("scroll"),
	}),
	z.strictObject({
		args: toolArgsSchemas.click,
		id: identifier,
		name: z.literal("click"),
	}),
	z.strictObject({
		args: toolArgsSchemas.fill,
		id: identifier,
		name: z.literal("fill"),
	}),
	z.strictObject({
		args: toolArgsSchemas.openTab,
		id: identifier,
		name: z.literal("openTab"),
	}),
	z.strictObject({
		args: toolArgsSchemas.switchTab,
		id: identifier,
		name: z.literal("switchTab"),
	}),
	z.strictObject({
		args: toolArgsSchemas.finish,
		id: identifier,
		name: z.literal("finish"),
	}),
]);

const actionIdentity = {
	actionId: identifier,
	documentToken: identifier,
	preview: nonblank(20_000),
	runId: identifier,
	snapshotId: identifier,
	tabId,
};

export const actionSchema = z.discriminatedUnion("tool", [
	z.strictObject({
		...actionIdentity,
		args: toolArgsSchemas.observe,
		tool: z.literal("observe"),
	}),
	z.strictObject({
		...actionIdentity,
		args: toolArgsSchemas.findText,
		tool: z.literal("findText"),
	}),
	z.strictObject({
		...actionIdentity,
		args: toolArgsSchemas.scroll,
		tool: z.literal("scroll"),
	}),
	z.strictObject({
		...actionIdentity,
		args: toolArgsSchemas.click,
		tool: z.literal("click"),
	}),
	z.strictObject({
		...actionIdentity,
		args: toolArgsSchemas.fill,
		tool: z.literal("fill"),
	}),
	z.strictObject({
		...actionIdentity,
		args: toolArgsSchemas.openTab,
		tool: z.literal("openTab"),
	}),
	z.strictObject({
		...actionIdentity,
		args: toolArgsSchemas.switchTab,
		tool: z.literal("switchTab"),
	}),
	z.strictObject({
		...actionIdentity,
		args: toolArgsSchemas.finish,
		tool: z.literal("finish"),
	}),
]);

export const turnResponseSchema = z.strictObject({
	text: z.string().max(20_000),
	toolCall: toolCallSchema.optional(),
});

export const toolCallIdSchema = identifier;
// Results are already-redacted local evidence, not arbitrary provider messages.
export const toolResultSchema = z.strictObject({
	result: z.string().max(20_000),
	role: z.literal("tool"),
	toolCallId: toolCallIdSchema,
});

export const turnMessageSchema = z.discriminatedUnion("role", [
	z.strictObject({ role: z.literal("user"), text: nonblank(20_000) }),
	z.strictObject({ role: z.literal("assistant"), ...turnResponseSchema.shape }),
	toolResultSchema,
]);

export const turnRequestSchema = z
	.strictObject({
		goal: nonblank(20_000),
		messages: z.array(turnMessageSchema).max(100),
		snapshot: snapshotSchema,
	})
	.superRefine((request, ctx) => {
		const seen = new Set<string>();
		let pending: string | undefined;
		for (const [position, message] of request.messages.entries()) {
			if (message.role === "tool") {
				if (pending !== message.toolCallId) {
					ctx.addIssue({
						code: "custom",
						message: "Tool result must match the preceding call ID",
						path: ["messages", position, "toolCallId"],
					});
				}
				pending = undefined;
				continue;
			}
			if (pending !== undefined) {
				ctx.addIssue({
					code: "custom",
					message:
						"Tool call requires a matching result before the next message",
					path: ["messages", position],
				});
			}
			if (message.role === "assistant" && message.toolCall) {
				if (seen.has(message.toolCall.id)) {
					ctx.addIssue({
						code: "custom",
						message: "Tool call IDs must be unique within a run",
						path: ["messages", position, "toolCall", "id"],
					});
				}
				seen.add(message.toolCall.id);
				pending = message.toolCall.id;
			}
		}
		if (pending !== undefined) {
			ctx.addIssue({
				code: "custom",
				message: "Transcript has an unresolved tool call",
				path: ["messages"],
			});
		}
	});

export type Snapshot = z.infer<typeof snapshotSchema>;
export type Action = z.infer<typeof actionSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
export type TurnRequest = z.infer<typeof turnRequestSchema>;
export type TurnResponse = z.infer<typeof turnResponseSchema>;
export type TurnMessage = z.infer<typeof turnMessageSchema>;
