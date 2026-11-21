// Preloaded only in owned entrypoint-proof subprocesses. Delegate unchanged to
// the real Bun listener, but record every socket-open attempt before it happens.
Bun.serve = new Proxy(Bun.serve, {
	apply(target, receiver, args) {
		console.error("TetherTerm test: listening socket requested");
		return Reflect.apply(target, receiver, args);
	},
});
