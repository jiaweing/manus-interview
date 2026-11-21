import { AbsoluteFill, useCurrentFrame } from "remotion";
import { FILM } from "./film-config.js";

// Bootstrap placeholder; replaced by scene sequences in later issues.
export const Hero = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: "#FFF7E8",
        color: "#20212B",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Inter, sans-serif",
        fontSize: 64,
        fontWeight: 700,
      }}
    >
      {`Session Seven ${frame}/${FILM.durationInFrames}`}
    </AbsoluteFill>
  );
};
