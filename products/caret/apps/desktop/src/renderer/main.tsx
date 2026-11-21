import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root");
}
createRoot(root).render(
  <h1 style={{ fontFamily: "system-ui", fontWeight: 600 }}>Caret</h1>
);
