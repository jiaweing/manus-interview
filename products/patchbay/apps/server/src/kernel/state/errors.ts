export type StateErrorCode =
	| "INVALID_STATE_PATH"
	| "STATE_READ_FAILED"
	| "STATE_WRITE_FAILED"
	| "INSTALL_SNAPSHOT_FAILED"
	| "INSTALL_STAGING_FAILED"
	| "INVALID_INSTALL_REVIEW";

const messages: Record<StateErrorCode, string> = {
	INSTALL_SNAPSHOT_FAILED:
		"The local package snapshot could not be reviewed safely.",
	INSTALL_STAGING_FAILED: "The reviewed package could not be installed.",
	INVALID_INSTALL_REVIEW:
		"The installation review is invalid or has already been consumed.",
	INVALID_STATE_PATH:
		"State must be beneath an existing absolute HOME directory.",
	STATE_READ_FAILED: "The installed registry could not be read safely.",
	STATE_WRITE_FAILED: "The state update could not be committed.",
};

/** Deliberately retains no native cause, untrusted path, or supplied value. */
export class StateError extends Error {
	readonly code: StateErrorCode;
	constructor(code: StateErrorCode) {
		super(messages[code]);
		this.name = "StateError";
		this.code = code;
	}
}
