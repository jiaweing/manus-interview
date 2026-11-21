// Diagnostic only: the deadline observes whether a real native EOF occurs;
// it is not used to finalize output or determine production completion.
const modes = ["reusable-setsid", "inline-setsid", "inline-native"] as const;
for (const mode of modes) {
	const { promise, resolve } = Promise.withResolvers<void>();
	let ended = false;
	let bytes = 0;
	const options: Bun.TerminalOptions = {
		cols: 80,
		rows: 24,
		data(_terminal, chunk) {
			bytes += chunk.byteLength;
			console.log(mode, "DATA", JSON.stringify(new TextDecoder().decode(chunk)));
		},
		exit(_terminal, status, signal) {
			ended = true;
			console.log(mode, "PTY_EOF", status, signal);
			resolve();
		},
	};
	const terminal = mode === "reusable-setsid" ? new Bun.Terminal(options) : undefined;
	const cmd = ["/usr/bin/python3", "-c", "import os; print('PID=%s PGID=%s SID=%s TPGID=%s' % (os.getpid(), os.getpgrp(), os.getsid(0), os.tcgetpgrp(0)), flush=True); os.write(1, bytes([0x61,0xf0,0x9f]))"];
	if (mode !== "inline-native") {
		cmd.unshift("/usr/bin/setsid", "-c");
	}
	const child = Bun.spawn(cmd, { terminal: terminal ?? options });
	await child.exited;
	console.log(mode, "CHILD_EXIT", child.pid, child.exitCode, child.signalCode);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([promise, new Promise<void>((done) => { timer = setTimeout(done, 100); })]);
		console.log(mode, "OBSERVED_AFTER_EXIT", JSON.stringify({ bytes, nativeEof: ended }));
	} finally {
		clearTimeout(timer);
		(terminal ?? child.terminal)?.close();
	}
}
