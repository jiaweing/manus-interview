export const OVERLAY_STATES = [
	"Starting",
	"Listening",
	"Transcribing",
	"Cleaning",
	"Done",
	"Error",
] as const;

export type OverlayState = (typeof OVERLAY_STATES)[number];
export type OverlayIcon =
	| "power"
	| "microphone"
	| "text"
	| "sparkles"
	| "check"
	| "alert";

export interface OverlayPresentation {
	description: string;
	icon: OverlayIcon;
	inverted: boolean;
	label: OverlayState;
}

const presentations: Record<OverlayState, OverlayPresentation> = {
	Cleaning: {
		description: "Refining your words",
		icon: "sparkles",
		inverted: false,
		label: "Cleaning",
	},
	Done: {
		description: "Paste requested",
		icon: "check",
		inverted: false,
		label: "Done",
	},
	Error: {
		description: "Unable to complete dictation",
		icon: "alert",
		inverted: true,
		label: "Error",
	},
	Listening: {
		description: "Speak now",
		icon: "microphone",
		inverted: true,
		label: "Listening",
	},
	Starting: {
		description: "Preparing microphone",
		icon: "power",
		inverted: false,
		label: "Starting",
	},
	Transcribing: {
		description: "Converting speech to text",
		icon: "text",
		inverted: false,
		label: "Transcribing",
	},
};

export function isOverlayState(value: unknown): value is OverlayState {
	return (
		typeof value === "string" && OVERLAY_STATES.some((state) => state === value)
	);
}

export function overlayPresentation(state: OverlayState): OverlayPresentation {
	return presentations[state];
}

// Overlay messages carry status only, never dictation, errors, keys or clipboard data.
export interface OverlayUpdate {
	revision: number;
	state: OverlayState;
}

export interface OverlayBridge {
	onStatus: (listener: (update: OverlayUpdate) => void) => () => void;
}

export const OVERLAY_CHANNELS = {
	snapshot: "caret:overlay:snapshot",
	status: "caret:overlay:status",
} as const;
