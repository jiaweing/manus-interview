// Accepted fixture patch from the #152 access check (anthropic/claude-opus-5.5, generation gen-1795276765-osnJ2plgjv4ZfRq6VcBU).
// Reviewed by the Lead: clamps negative/NaN frames to 0 and frames >= 30 to 1; pure, frame-only, deterministic.
export function entranceProgress(frame) {
  if (!(frame > 0)) return 0;
  if (frame >= 30) return 1;
  return frame / 30;
}
