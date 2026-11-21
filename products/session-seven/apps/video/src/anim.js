import { FRAMES_PER_BEAT, FRAMES_PER_BAR } from "./timeline.js";

// Beat / bar indices are zero-based; durations may use fractional beats.
export const beat = (n) => n * FRAMES_PER_BEAT;
export const bar = (n) => n * FRAMES_PER_BAR;
export const clamp01 = (value) => Math.max(0, Math.min(1, value));
export function enter(frame, startFrame = 0, durationFrames = beat(2)) {
  const t = durationFrames <= 0 ? Number(frame >= startFrame) : clamp01((frame - startFrame) / durationFrames);
  return t * t * (3 - 2 * t); // smoothstep, no overshoot / continuous motion
}
// Returns a translation object accepted by <Group {...translateIn(...)}>.
// Coordinates settle to toX/toY after a bounded entrance, then hold forever.
export function translateIn(frame, startFrame = 0, durationFrames = beat(2), {
  fromX = 0, fromY = 48, toX = 0, toY = 0,
} = {}) {
  const t = enter(frame, startFrame, durationFrames);
  return { x: fromX + (toX - fromX) * t, y: fromY + (toY - fromY) * t };
}
// End-exclusive visibility hold. Use for state steps, never blinking key text.
export const hold = (frame, startFrame, durationFrames) => frame >= startFrame && frame < startFrame + durationFrames;

// Mulberry32: create anew with a fixed seed for each render/data derivation.
// Never store this generator across frames; its only state is local to the call.
export function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
