// Throwaway-but-committed feasibility fixture; never imported by the film entry.
import { useEffect, useState } from "react";
import {
  AbsoluteFill, cancelRender, continueRender, delayRender, interpolate,
  staticFile, useCurrentFrame,
} from "remotion";
import { ILLUSTRATED_LABEL, READINESS_LABEL, SCENES } from "../timeline.js";

export const BENCHMARK_CAPTION = SCENES.find((scene) => scene.id === "caret").captions[0].text;
export const BENCHMARK_TEXT = Object.freeze({ captionSize: 60, labelSize: 48, holdFrames: 240 });

export function BenchmarkScene() {
  const frame = useCurrentFrame();
  const [fontHandle] = useState(() => delayRender("Load bundled benchmark Inter"));
  useEffect(() => {
    let mounted = true;
    document.fonts.load('700 60px "Benchmark Inter"').then((faces) => {
      if (faces.length === 0) throw new Error("Bundled Inter did not load");
      if (mounted) continueRender(fontHandle);
    }).catch((error) => cancelRender(error));
    return () => { mounted = false; };
  }, [fontHandle]);

  // A two-second initial hold, one 30-frame translation, then a five-second result hold.
  const translateX = interpolate(frame, [60, 90], [80, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: "#FFF7E8" }}>
      <style>{`@font-face {
        font-family: 'Benchmark Inter'; font-style: normal; font-weight: 700;
        src: url('${staticFile("fonts/inter-latin-700-normal.woff2")}') format('woff2');
        font-display: block;
      }`}</style>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080"
        style={{ fontFamily: '"Benchmark Inter"', fontWeight: 700 }}>
        <defs>
          <filter id="benchmark-soft-shadow" x="-30%" y="-30%" width="160%" height="180%">
            <feDropShadow dx="0" dy="16" stdDeviation="14" floodColor="#20212B" floodOpacity="0.16" />
          </filter>
        </defs>
        {/* Flat exterior scenery, offset silhouette, overlap, and soft depth. */}
        <circle cx="370" cy="388" r="224" fill="#FFD166" />
        <rect x="264" y="345" width="208" height="326" rx="104" fill="#20212B" opacity="0.12" />
        <ellipse cx="383" cy="700" rx="266" ry="58" fill="#6DD6BC" />
        <g filter="url(#benchmark-soft-shadow)">
          <rect x="242" y="318" width="208" height="326" rx="104" fill="#FFF7E8" />
          <circle cx="304" cy="424" r="13" fill="#20212B" />
          <circle cx="387" cy="424" r="13" fill="#20212B" />
          <ellipse cx="345" cy="486" rx="23" ry="12" fill="#20212B" />
        </g>
        {/* Only monochrome fills/text inside the interface: 10px radii, no strokes. */}
        <g transform={`translate(${translateX} 0)`} filter="url(#benchmark-soft-shadow)">
          <rect x="650" y="246" width="1050" height="474" rx="10" fill="#FAFAFA" />
          <text x="710" y="334" fill="#18181B" fontSize="48">Sample draft</text>
          <rect x="710" y="380" width="930" height="266" rx="10" fill="#F4F4F5" />
          <text x="760" y="470" fill="#18181B" fontSize="48">The sample draft is</text>
          <text x="760" y="535" fill="#18181B" fontSize="48">ready for review.</text>
          <rect x="1190" y="491" width="5" height="52" rx="0" fill="#18181B" />
          <text x="760" y="604" fill="#18181B" fontSize="48">Inserted text · illustration</text>
        </g>
        {/* Labels and captions stay fixed for all 240 frames, inside 5% safe margins. */}
        <text x="120" y="146" fill="#20212B" fontSize={BENCHMARK_TEXT.labelSize}>{ILLUSTRATED_LABEL}</text>
        <text x="1800" y="146" textAnchor="end" fill="#20212B" fontSize={BENCHMARK_TEXT.labelSize}>{READINESS_LABEL.concept}</text>
        <text x="960" y="884" textAnchor="middle" fill="#20212B" fontSize={BENCHMARK_TEXT.captionSize}>
          {BENCHMARK_CAPTION.split("\n").map((line, index) => (
            <tspan key={line} x="960" dy={index === 0 ? 0 : 78}>{line}</tspan>
          ))}
        </text>
      </svg>
    </AbsoluteFill>
  );
}
