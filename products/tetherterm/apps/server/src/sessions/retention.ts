import type { Session } from "./session";

export const EXIT_RETENTION_MS = 5 * 60 * 1000;
export const MAX_SESSION_RECORDS = 16;

/** Test seam: scheduling and cancellation share the controllable clock. */
export interface RetentionScheduler {
	schedule: (callback: () => void, delayMs: number) => () => void;
}

const scheduler: RetentionScheduler = {
	schedule(callback, delayMs) {
		const timer = setTimeout(callback, delayMs);
		timer.unref();
		return () => clearTimeout(timer);
	},
};

interface RetainedExit {
	cancel: () => void;
	expiresAt: number;
}

/** Owns only exited-record retention, never process termination or output. */
export class SessionRetention {
	// Insertion order is exit-event order, including ties on the injected clock.
	private readonly exited = new Map<string, RetainedExit>();
	private readonly sessions: Map<string, Session>;
	private readonly clock: { now: () => number };
	private readonly scheduler: RetentionScheduler;

	constructor(
		sessions: Map<string, Session>,
		clock: { now: () => number },
		timers: RetentionScheduler = scheduler
	) {
		this.sessions = sessions;
		this.clock = clock;
		this.scheduler = timers;
	}

	/** Called once actual child exit has populated the record's exit summary. */
	retain(session: Session): void {
		if (
			session.state !== "exited" ||
			this.sessions.get(session.id) !== session ||
			this.exited.has(session.id)
		) {
			return;
		}
		const retained: RetainedExit = {
			cancel: () => undefined,
			expiresAt: this.clock.now() + EXIT_RETENTION_MS,
		};
		this.exited.set(session.id, retained);
		this.schedule(session.id, retained);
		this.prune();
	}

	/** Also run on registry access/insertion so injected-clock expiry is exact. */
	prune(): void {
		const now = this.clock.now();
		for (const [id, retained] of this.exited) {
			if (now >= retained.expiresAt) {
				this.remove(id);
			}
		}
		while (this.sessions.size > MAX_SESSION_RECORDS) {
			const oldest = this.exited.keys().next().value;
			if (oldest === undefined) {
				// Never evict running/terminating records; live capacity is separate.
				break;
			}
			this.remove(oldest);
		}
	}

	private schedule(id: string, retained: RetainedExit): void {
		retained.cancel = this.scheduler.schedule(
			() => {
				this.prune();
				// A controllable clock can lag a real timer; do not expire it early.
				if (this.exited.get(id) === retained) {
					this.schedule(id, retained);
				}
			},
			Math.max(1, retained.expiresAt - this.clock.now())
		);
	}

	private remove(id: string): void {
		const retained = this.exited.get(id);
		retained?.cancel();
		this.exited.delete(id);
		const session = this.sessions.get(id);
		if (session?.state !== "exited") {
			return;
		}
		this.sessions.delete(id);
		// Keep the PTY open throughout retention: late final data must still drain.
		// Deleting the record releases attached output/queues with its native PTY.
		session.pty.terminal.close();
	}
}
