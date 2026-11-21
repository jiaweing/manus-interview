import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app";
import "./style.css";

const root = document.getElementById("root");
if (!root) {
	throw new Error("Sidekick panel root is missing");
}
createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>
);
