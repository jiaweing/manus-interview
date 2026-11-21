import { Composition } from "remotion";
import { BenchmarkScene } from "./BenchmarkScene.jsx";

// BENCHMARK-ONLY composition. This root is not imported by ../Root.jsx or ../index.js.
// The separate entry is the opt-in boundary; no environment-dependent film registry.
export const BenchmarkRoot = () => (
  <Composition id="Benchmark" component={BenchmarkScene}
    width={1920} height={1080} fps={30} durationInFrames={240} />
);
