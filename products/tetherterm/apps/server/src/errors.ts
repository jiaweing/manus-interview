export type TerminalErrorCode =
	| "NOT_FOUND"
	| "POLICY_DENIED"
	| "BAD_CURSOR"
	| "LIMIT"
	| "NOT_RUNNING";

export class TerminalError extends Error {
	readonly code: TerminalErrorCode;

	constructor(code: TerminalErrorCode, message: string) {
		super(message);
		this.name = "TerminalError";
		this.code = code;
	}
}

/** Startup errors are separate from the PRD's terminal-tool error codes. */
export class ConfigurationError extends Error {
	constructor(message: string) {
		super(`TetherTerm configuration: ${message}`);
		this.name = "ConfigurationError";
	}
}
