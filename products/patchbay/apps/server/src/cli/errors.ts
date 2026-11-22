export const EXIT_CODES = {
	FATAL: 2,
	OK: 0,
	STARTUP: 1,
} as const;

export const ERROR_CODES = {
	SESSION_FAILED: "SESSION_FAILED",
	STARTUP_FAILED: "STARTUP_FAILED",
	UNKNOWN_COMMAND: "UNKNOWN_COMMAND",
	UNSUPPORTED_PLATFORM: "UNSUPPORTED_PLATFORM",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class CliError extends Error {
	readonly code: ErrorCode;

	constructor(code: ErrorCode, message: string) {
		super(message);
		this.name = "CliError";
		this.code = code;
	}
}

/** Never include raw exception messages, command text, paths, or secrets. */
export function formatError(error: { code: string; message: string }): string {
	return `ERROR [${error.code}]: ${error.message}\n`;
}
