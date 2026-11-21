import { registerRoot } from "remotion";
import { BenchmarkRoot } from "./Root.jsx";

// Separate benchmark entry: Studio / src/index.js still register only Hero.
registerRoot(BenchmarkRoot);
