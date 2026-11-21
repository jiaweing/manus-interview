import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Environment, ServerConfig } from "../config";
import { TerminalError } from "../errors";
import { spawnWithPolicy } from "../policy";
import { type SpawnPtyOptions, spawnPty } from "../pty/spawn";
import { OutputRing, type OutputRingRead } from "./ring";
import {
	type WriteSessionRequest,
	type WriteSessionResult,
	writeSessionInput,
} from "./input";
import {
	dimensionsSchema,
	type ResizeSessionRequest,
	type ResizeSessionResult,
	resizeSession,
} from "./resize";
import { SessionRetention } from "./retention";
import {
	type PtyHandle,
	type Session,
	type SessionState,
	type SessionSummary,
	summarize,
} from "./session";

export const MAX_LIVE_SESSIONS = 4;
export const DEFAULT_RUNTIME_MS = 15 * 60 * 1000;

const limitsSchema = dimensionsSchema.extend({
	cols: dimensionsSchema.shape.cols.default(80),
	rows: dimensionsSchema.shape.rows.default(24),
	timeoutMs: z.number().int().positive().default(DEFAULT_RUNTIME_MS),
});

export interface CreateSessionRequest {
	args?: string[];
	cols?: number;
	cwd: string;
	executable: string;
	rows?: number;
	timeoutMs?: number;
}

export interface CreateSessionResult {
	cursor: string;
	sessionId: string;
	state: SessionState;
}

export interface ReadSessionRequest {
	cursor: string;
	maxBytes?: number;
	sessionId: string;
}

export interface SessionClock {
	now: () => number;
}

export interface SessionManagerOptions {
	clock?: SessionClock;
	env?: Environment;
	/** Test seam only: still called exclusively inside spawnWithPolicy. */
	spawn?: (options: SpawnPtyOptions) => PtyHandle;
}

/** Own one manager per server process, never one per MCP connection. */
export class SessionManager {
	private readonly sessions = new Map<string, Session>();
	private readonly config: ServerConfig;
	private readonly options: SessionManagerOptions;
	private readonly clock: SessionClock;
	private readonly retention: SessionRetention;
	// Includes in-flight policy checks as well as running/terminating sessions.
	private liveSlots = 0;

	constructor(config: ServerConfig, options: SessionManagerOptions = {}) {
		this.config = config;
		this.options = options;
		this.clock = options.clock ?? { now: Date.now };
		this.retention = new SessionRetention(this.sessions, this.clock);
	}

	async create(request: CreateSessionRequest): Promise<CreateSessionResult> {
		const limits = limitsSchema.safeParse(request);
		if (!limits.success) {
			throw new TerminalError(
				"LIMIT",
				"Dimensions must be 1–240 columns and 1–80 rows; runtime must be a positive finite integer"
			);
		}
		const createdAt = this.clock.now();
		const runtimeDeadline = createdAt + limits.data.timeoutMs;
		if (!Number.isSafeInteger(runtimeDeadline)) {
			throw new TerminalError("LIMIT", "Runtime deadline must be finite");
		}
		if (this.liveSlots >= MAX_LIVE_SESSIONS) {
			throw new TerminalError(
				"LIMIT",
				"At most four live sessions are allowed"
			);
		}
		// No await before reservation: concurrent creates cannot spawn a fifth PTY.
		this.liveSlots += 1;
		let session: Session | undefined;
		let receivedBytes = 0;
		const output = new OutputRing();
		let { executable, cwd } = request;
		let pty: PtyHandle;
		try {
			pty = await spawnWithPolicy(
				this.config,
				{
					...request,
					cols: limits.data.cols,
					onData(bytes) {
						output.append(bytes);
						receivedBytes += bytes.byteLength;
						if (session) {
							session.receivedBytes = receivedBytes;
						}
					},
					rows: limits.data.rows,
				},
				{
					env: this.options.env,
					spawn: (validated) => {
						({ executable, cwd } = validated);
						return (this.options.spawn ?? spawnPty)(validated);
					},
				}
			);
		} catch (error) {
			this.liveSlots -= 1;
			throw error;
		}
		// spawnWithPolicy always invokes the spawn callback with canonical metadata.
		const record: Session = {
			createdAt,
			cwd,
			dimensions: { cols: limits.data.cols, rows: limits.data.rows },
			executable,
			exitCode: null,
			id: randomUUID(),
			output,
			pty,
			receivedBytes,
			runtimeDeadline,
			signal: null,
			state: "running",
		};
		session = record;
		this.sessions.set(record.id, record);
		this.retention.prune();
		// Observe actual exit without awaiting it in create/status/list.
		pty.child.exited.then(() => {
			record.state = "exited";
			record.exitCode = pty.child.exitCode;
			record.signal = pty.child.signalCode ?? null;
			this.liveSlots -= 1;
			this.retention.retain(record);
		});
		return { cursor: "0", sessionId: record.id, state: record.state };
	}

	/** Internal service access for later output/input/lifecycle modules. */
	get(sessionId: string): Session {
		this.retention.prune();
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new TerminalError("NOT_FOUND", "Session was not found");
		}
		return session;
	}

	read(request: ReadSessionRequest): OutputRingRead & { state: SessionState } {
		const session = this.get(request.sessionId);
		return {
			...session.output.read(request.cursor, request.maxBytes),
			state: session.state,
		};
	}

	resize(
		sessionId: string,
		request: ResizeSessionRequest
	): ResizeSessionResult {
		return resizeSession(this.get(sessionId), request);
	}

	async write(request: WriteSessionRequest): Promise<WriteSessionResult> {
		return await writeSessionInput(this.get(request.sessionId), request);
	}

	status(sessionId: string): SessionSummary {
		return summarize(this.get(sessionId));
	}

	list(): { sessions: SessionSummary[] } {
		this.retention.prune();
		return { sessions: [...this.sessions.values()].map(summarize) };
	}
}
