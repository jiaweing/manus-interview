import { z } from "zod";
import { TerminalError } from "../errors";
import type { Session, SessionState } from "./session";

export const MAX_INPUT_BYTES = 16_384;

export const terminalKeySchema = z.enum([
	"ENTER",
	"TAB",
	"ESC",
	"BACKSPACE",
	"ARROW_UP",
	"ARROW_DOWN",
	"ARROW_LEFT",
	"ARROW_RIGHT",
	"CTRL_C",
	"CTRL_D",
]);
export type TerminalKey = z.infer<typeof terminalKeySchema>;

const keyBytes: Record<TerminalKey, string> = {
	ARROW_DOWN: "\u001b[B",
	ARROW_LEFT: "\u001b[D",
	ARROW_RIGHT: "\u001b[C",
	ARROW_UP: "\u001b[A",
	BACKSPACE: "\u007f",
	CTRL_C: "\u0003",
	CTRL_D: "\u0004",
	ENTER: "\r",
	ESC: "\u001b",
	TAB: "\t",
};

/** Shared with future transport adapters; no MCP registration here. */
export const terminalWriteSchema = z
	.object({
		keys: z.array(terminalKeySchema).optional(),
		sessionId: z.string().min(1),
		text: z.string().optional(),
	})
	.refine(
		(input) => (input.text !== undefined) !== (input.keys !== undefined),
		{
			message: "Provide exactly one of text or keys",
		}
	);

export type WriteSessionRequest = z.infer<typeof terminalWriteSchema>;
export interface WriteSessionResult {
	acceptedBytes: number;
	state: SessionState;
}

const encoder = new TextEncoder();
const queues = new WeakMap<Session, Promise<void>>();

function requireRunning(session: Session) {
	if (
		session.state !== "running" ||
		session.pty.child.exitCode !== null ||
		session.pty.terminal.closed
	) {
		throw new TerminalError("NOT_RUNNING", "Session is not running");
	}
}

/** Encode now, before queueing, so caller mutation cannot alter queued input. */
export function encodeInput(request: WriteSessionRequest): Uint8Array {
	const input = terminalWriteSchema.parse(request);
	const bytes = encoder.encode(
		input.text ?? input.keys?.map((key) => keyBytes[key]).join("") ?? ""
	);
	if (bytes.byteLength > MAX_INPUT_BYTES) {
		throw new TerminalError(
			"LIMIT",
			"Input must not exceed 16384 encoded bytes"
		);
	}
	return bytes;
}

export async function writeSessionInput(
	session: Session,
	request: WriteSessionRequest
): Promise<WriteSessionResult> {
	const bytes = encodeInput(request);
	requireRunning(session);
	const previous = queues.get(session) ?? Promise.resolve();
	const pending = previous.then(() => {
		// A session may exit or start terminating while this submission is queued.
		requireRunning(session);
		let acceptedBytes: number;
		try {
			// Bun.Terminal accepts and buffers the full submission, including bytes
			// not immediately flushed to the PTY. Its drain callback only announces
			// that buffer has flushed. Never resend a suffix on a short return, or
			// retry a throw: either can duplicate input whose delivery is uncertain.
			acceptedBytes = session.pty.terminal.write(bytes);
		} catch {
			// biome-ignore lint/style/useErrorCause: Native causes may contain terminal input; do not expose them.
			throw new Error(
				"Terminal input acceptance is uncertain; it was not retried"
			);
		}
		return { acceptedBytes, state: session.state };
	});
	// A rejected submission must not poison subsequent explicitly requested input.
	const settled = pending.then(
		() => undefined,
		() => undefined
	);
	queues.set(session, settled);
	try {
		return await pending;
	} finally {
		if (queues.get(session) === settled) {
			queues.delete(session);
		}
	}
}
