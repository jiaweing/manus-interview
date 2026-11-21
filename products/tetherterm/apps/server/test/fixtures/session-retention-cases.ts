import { expect, test } from "bun:test";
import {
	EXIT_RETENTION_MS,
	MAX_SESSION_RECORDS,
	type RetentionScheduler,
	SessionRetention,
} from "../../src/sessions/retention";
import type { PtyHandle, Session } from "../../src/sessions/session";

class ManualClock implements RetentionScheduler {
	now = 1000;
	private nextId = 0;
	readonly timers = new Map<number, { at: number; callback: () => void }>();

	schedule(callback: () => void, delayMs: number): () => void {
		const id = this.nextId;
		this.nextId += 1;
		this.timers.set(id, { at: this.now + delayMs, callback });
		return () => {
			this.timers.delete(id);
		};
	}

	advance(milliseconds: number): void {
		this.now += milliseconds;
		for (const [id, timer] of [...this.timers]) {
			if (this.timers.has(id) && timer.at <= this.now) {
				this.timers.delete(id);
				timer.callback();
			}
		}
	}
}

function fixture() {
	const clock = new ManualClock();
	const sessions = new Map<string, Session>();
	const retention = new SessionRetention(
		sessions,
		{ now: () => clock.now },
		clock
	);
	const closed = new Set<string>();
	function add(id: string, state: Session["state"] = "exited") {
		// Native PTYs are exercised separately; this seam observes disposal only.
		const pty = {
			terminal: {
				close() {
					expect(closed.has(id)).toBe(false);
					closed.add(id);
				},
			},
		} as unknown as PtyHandle;
		const session: Session = {
			createdAt: clock.now,
			cwd: "/fixture",
			dimensions: { cols: 80, rows: 24 },
			executable: "/fixture/executable",
			exitCode: state === "exited" ? 7 : null,
			id,
			pty,
			receivedBytes: 0,
			runtimeDeadline: clock.now + 900_000,
			signal: null,
			state,
		};
		sessions.set(id, session);
		retention.retain(session);
		retention.prune();
		return session;
	}
	return { add, clock, closed, retention, sessions };
}

// Export the cases so the issue's exact verification command includes unit proof.
export function retentionUnitCases(): void {
	test("five-minute automatic expiry cancels timers and closes only the expired record", () => {
		const f = fixture();
		const first = f.add("first");
		const finalOutput = new TextEncoder().encode("final output\u001b[0m\n");
		const buffered = Object.assign(first, { finalOutput });
		f.clock.advance(1000);
		f.add("second");
		f.clock.advance(EXIT_RETENTION_MS - 1001);
		expect(f.sessions.get(first.id)).toBe(buffered);
		expect(buffered.finalOutput).toBe(finalOutput);
		expect(f.closed.size).toBe(0);
		expect(f.clock.timers.size).toBe(2);
		f.clock.advance(1);
		expect(f.sessions.has("first")).toBe(false);
		expect(f.sessions.has("second")).toBe(true);
		expect(f.closed).toEqual(new Set(["first"]));
		expect(f.clock.timers.size).toBe(1);
		f.clock.advance(1000);
		expect(f.sessions.size).toBe(0);
		expect(f.clock.timers.size).toBe(0);
		expect(f.closed).toEqual(new Set(["first", "second"]));
	});

	test("clock-driven lazy expiry also clears a not-yet-fired native timer", () => {
		const f = fixture();
		f.add("exit");
		f.clock.now += EXIT_RETENTION_MS;
		expect(f.clock.timers.size).toBe(1);
		f.retention.prune();
		expect(f.sessions.size).toBe(0);
		expect(f.clock.timers.size).toBe(0);
		expect(f.closed.has("exit")).toBe(true);
		f.retention.prune();
		expect(f.closed.size).toBe(1);
	});

	test("sixteen-record cap evicts oldest exited records, never running or terminating", () => {
		const f = fixture();
		f.add("running", "running");
		f.add("terminating", "terminating");
		for (let index = 0; index < MAX_SESSION_RECORDS - 2; index += 1) {
			f.add(`exit-${index}`);
		}
		expect(f.sessions.size).toBe(MAX_SESSION_RECORDS);
		f.add("another-running", "running");
		expect(f.sessions.has("exit-0")).toBe(false);
		f.add("new-exit");
		expect(f.sessions.has("exit-1")).toBe(false);
		expect(f.sessions.size).toBe(MAX_SESSION_RECORDS);
		expect(f.clock.timers.size).toBe(MAX_SESSION_RECORDS - 3);
		f.clock.advance(EXIT_RETENTION_MS);
		expect([...f.sessions.keys()]).toEqual([
			"running",
			"terminating",
			"another-running",
		]);
		expect(f.clock.timers.size).toBe(0);
		expect(f.closed.size).toBe(MAX_SESSION_RECORDS - 1);
	});

	test("cap ordering follows actual exits, not creation order, including equal-clock ties", () => {
		const f = fixture();
		const createdFirst = f.add("created-first", "running");
		f.add("exited-first");
		createdFirst.state = "exited";
		f.retention.retain(createdFirst);
		f.retention.retain(createdFirst);
		expect(f.clock.timers.size).toBe(2);
		for (let index = 0; index < MAX_SESSION_RECORDS - 1; index += 1) {
			f.add(`later-${index}`);
		}
		expect(f.sessions.has("exited-first")).toBe(false);
		expect(f.sessions.has("created-first")).toBe(true);
		f.clock.advance(EXIT_RETENTION_MS);
		expect(f.clock.timers.size).toBe(0);
	});

	test("retention ignores non-exited or unregistered records and never disposes a live record", () => {
		const f = fixture();
		const running = f.add("running", "running");
		f.retention.retain(running);
		expect(f.clock.timers.size).toBe(0);
		const removed = f.add("removed", "running");
		f.sessions.delete(removed.id);
		removed.state = "exited";
		f.retention.retain(removed);
		expect(f.clock.timers.size).toBe(0);
		const guarded = f.add("guarded");
		guarded.state = "terminating";
		f.clock.advance(EXIT_RETENTION_MS);
		expect(f.sessions.get(guarded.id)).toBe(guarded);
		expect(f.closed.size).toBe(0);
		expect(f.clock.timers.size).toBe(0);
	});
}
