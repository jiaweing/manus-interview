export interface SpawnPtyOptions {
	args?: string[];
	cols: number;
	cwd: string;
	env: Record<string, string>;
	executable: string;
	onData: (bytes: Uint8Array) => void;
	/** PTY stream EOF/read-error, not the subprocess exit code or input drain. */
	onEof?: () => void;
	rows: number;
}

export function spawnPty(options: SpawnPtyOptions) {
	const { promise: eof, resolve: resolveEof } = Promise.withResolvers<void>();
	let ended = false;
	// Bun 1.4.5 inline terminals establish setsid+TIOCSCTTY natively on Linux:
	// child.pid is PID/PGID/SID/TPGID, so negative-PID signals own only this group.
	// A reusable new Bun.Terminal retains its parent slave descriptor and cannot
	// report child-stream EOF. Inline ownership releases it without closing output.
	const child = Bun.spawn([options.executable, ...(options.args ?? [])], {
		cwd: options.cwd,
		env: options.env,
		terminal: {
			cols: options.cols,
			data(_terminal, bytes) {
				options.onData(bytes);
			},
			exit() {
				if (ended) {
					return;
				}
				ended = true;
				// Native stream completion follows final data, independently of exit
				// status. Finish consumers synchronously before resolving the promise.
				options.onEof?.();
				resolveEof();
			},
			rows: options.rows,
		},
	});
	const { terminal } = child;
	if (!terminal) {
		child.kill("SIGKILL");
		throw new Error("Inline PTY spawn did not provide a terminal");
	}
	return { child, eof, terminal };
}
