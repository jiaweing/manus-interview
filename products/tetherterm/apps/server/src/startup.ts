import { ConfigurationError } from "./errors";

/** Only loader-owned readable errors are safe; discard raw transport errors. */
export function reportStartupFailure(mode: "HTTP" | "stdio", error: unknown) {
	console.error(
		error instanceof ConfigurationError
			? error.message
			: `TetherTerm ${mode} startup failed`
	);
	process.exitCode = 1;
}
