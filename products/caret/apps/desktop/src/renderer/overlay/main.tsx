import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import { createRoot } from "react-dom/client";
import type { OverlayBridge } from "../../shared/overlay-state";
import { Overlay } from "./overlay";
import "./overlay.css";

declare global {
	interface Window {
		caretOverlay: OverlayBridge;
	}
}

const root = document.getElementById("root");
if (!root) {
	throw new Error("Missing overlay root");
}
createRoot(root).render(<Overlay bridge={window.caretOverlay} />);
