import type { spawnPty } from "../pty/spawn";

export type SessionState = "running" | "terminating" | "exited";
export type PtyHandle = ReturnType<typeof spawnPty>;

export interface SessionSummary {
	cwd: string;
	dimensions: { cols: number; rows: number };
	executable: string;
	exitCode: number | null;
	id: string;
	signal: PtyHandle["child"]["signalCode"];
	state: SessionState;
}

/**
 * In-memory, transport-independent record. The PTY handle is deliberately not
 * part of a summary. Later services can attach a ring/write queue/waiters here,
 * use dimensions for resize, and use runtimeDeadline for termination scheduling.
 * This issue counts bytes only: it neither retains nor persists terminal data.
 */
export interface Session extends SessionSummary {
	readonly createdAt: number;
	readonly pty: PtyHandle;
	receivedBytes: number;
	readonly runtimeDeadline: number;
}

export function summarize(session: Session): SessionSummary {
	return {
		cwd: session.cwd,
		dimensions: { ...session.dimensions },
		executable: session.executable,
		exitCode: session.exitCode,
		id: session.id,
		signal: session.signal,
		state: session.state,
	};
}
