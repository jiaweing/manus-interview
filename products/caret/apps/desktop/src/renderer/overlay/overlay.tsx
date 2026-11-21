import { type ReactNode, useEffect, useState } from "react";
import {
	type OverlayBridge,
	type OverlayIcon,
	type OverlayState,
	overlayPresentation,
} from "../../shared/overlay-state";

const iconPaths: Record<OverlayIcon, ReactNode> = {
	alert: (
		<>
			<path d="m12 3 10 18H2Z" />
			<path d="M12 9v5M12 17v.5" />
		</>
	),
	check: <path d="m5 12 4 4L19 6" />,
	microphone: (
		<>
			<rect height="12" rx="3" width="6" x="9" y="2" />
			<path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
		</>
	),
	power: (
		<>
			<path d="M12 3v8" />
			<path d="M7 5.7a8 8 0 1 0 10 0" />
		</>
	),
	sparkles: (
		<>
			<path d="m12 4 2.5 5.5L20 12l-5.5 2.5L12 20l-2.5-5.5L4 12l5.5-2.5ZM20 2v4M18 4h4" />
		</>
	),
	text: (
		<>
			<path d="M4 4h16M12 4v16M8 20h8M4 8V4M20 8V4" />
		</>
	),
};

export function Overlay({ bridge }: { bridge: OverlayBridge }) {
	const [state, setState] = useState<OverlayState>("Starting");
	useEffect(
		() => bridge.onStatus((update) => setState(update.state)),
		[bridge]
	);
	return <OverlayStatus state={state} />;
}

export function OverlayStatus({ state }: { state: OverlayState }) {
	const presentation = overlayPresentation(state);
	return (
		<section
			aria-atomic="true"
			aria-live="polite"
			className={
				presentation.inverted ? "overlay overlay--inverted" : "overlay"
			}
			data-state={state}
			role="status"
		>
			<div className="overlay__content" key={state}>
				<span aria-hidden="true" className="overlay__icon">
					<svg
						aria-hidden="true"
						fill="none"
						focusable="false"
						height="24"
						stroke="currentColor"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth="1.7"
						viewBox="0 0 24 24"
						width="24"
					>
						{iconPaths[presentation.icon]}
					</svg>
				</span>
				<div className="overlay__copy">
					<span className="overlay__label">{presentation.label}</span>
					<span className="overlay__description">
						{presentation.description}
					</span>
				</div>
			</div>
		</section>
	);
}
