import { z } from "zod";
import { TerminalError } from "../errors";
import type { Session } from "./session";

/** Inclusive PTY bounds shared by creation (with defaults) and resize. */
export const dimensionsSchema = z.object({
	cols: z.number().int().min(1).max(240),
	rows: z.number().int().min(1).max(80),
});

export interface ResizeSessionRequest {
	cols: number;
	rows: number;
}

export type ResizeSessionResult = ResizeSessionRequest;

export function resizeSession(
	session: Session,
	request: ResizeSessionRequest
): ResizeSessionResult {
	// The native child may have exited before the lifecycle observer runs.
	if (session.state !== "running" || session.pty.child.exitCode !== null) {
		throw new TerminalError("NOT_RUNNING", "Session is not running");
	}
	const dimensions = dimensionsSchema.safeParse(request);
	if (!dimensions.success) {
		throw new TerminalError(
			"LIMIT",
			"Dimensions must be 1–240 columns and 1–80 rows"
		);
	}
	const { cols, rows } = dimensions.data;
	session.pty.terminal.resize(cols, rows);
	// Publish only after native resize succeeds; return a detached snapshot.
	session.dimensions = { cols, rows };
	return { cols, rows };
}
