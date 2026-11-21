export type DiagnosticEvent =
	| "startup_failed"
	| "policy_denied"
	| "spawn_failed";

const MESSAGES: Record<DiagnosticEvent, string> = {
	policy_denied:
		"TetherTerm POLICY_DENIED: terminal request rejected by policy",
	spawn_failed: "TetherTerm: approved terminal could not be started",
	startup_failed: "TetherTerm: invalid required startup configuration",
};

/** Deliberately accepts no error object, environment, request, or PTY output. */
export function logDiagnostic(
	event: DiagnosticEvent,
	write: (message: string) => void = (message) => console.error(message)
): void {
	write(MESSAGES[event]);
}
