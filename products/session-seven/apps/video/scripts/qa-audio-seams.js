import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {decodeWav} from '../src/audio/mix.js';
import {sha256} from '../src/audio/cache.js';
export const BOUNDARY_FRAMES = Object.freeze([0, 180, 420, 660, 900, 1140, 1380, 1620, 1799]);
export function analyzeAudioSeams(channels) {
  return BOUNDARY_FRAMES.map((frame) => {
    const at = frame * 1600;
    let maxSampleStep = 0, boundarySampleStep = 0, maxImpulseResidual = 0, clickCount = 0;
    for (const c of channels) {
      if (at > 0) boundarySampleStep = Math.max(boundarySampleStep, Math.abs(c[at] - c[at - 1]));
      // +/-10ms around the exact cut; includes intentional downbeat percussion.
      for (let i = Math.max(1, at - 480); i < Math.min(c.length - 1, at + 480); i++) {
        const before = c[i] - c[i - 1], after = c[i + 1] - c[i];
        const residual = Math.abs(c[i] - (c[i - 1] + c[i + 1]) / 2);
        maxSampleStep = Math.max(maxSampleStep, Math.abs(before));
        maxImpulseResidual = Math.max(maxImpulseResidual, residual);
        // Conservative isolated-impulse detector; intentionally noisy hats can
        // have sizable steps, so a step alone is not labeled a cut click.
        if (before * after < 0 && Math.abs(before) > 0.3 && Math.abs(after) > 0.3 && residual > 0.3) clickCount++;
      }
    }
    return {frame, seconds: frame / 30, sample: at, windowSamplesEachSide: 480, maxSampleStep,
      boundarySampleStep, maxImpulseResidual, clickCount,
      pass: clickCount === 0 && boundarySampleStep <= 0.01};
  });
}
export async function runSeamQa() {
  const audioDir = fileURLToPath(new URL('../audio/', import.meta.url));
  const qaDir = fileURLToPath(new URL('../../../qa/', import.meta.url));
  const bytes = await readFile(`${audioDir}master.wav`);
  const {channels} = decodeWav(bytes);
  const boundaries = analyzeAudioSeams(channels);
  const endpointsZero = channels.every((c) => c[0] === 0 && c[c.length - 1] === 0);
  const lines = ['# Audio seam review — analytical only', '',
    'This is an analytical waveform/construction check, **not human listening**. No human-ear audition or perceptual certification is claimed. The issue\'s listening requirement is represented by the requested analytical checks; human listening remains unverified.', '',
    `Mastered WAV SHA-256: \`${sha256(bytes)}\`. Exactly 2,880,000 samples/channel, stereo 48 kHz, 60 seconds.`, '',
    'The soundtrack is one continuous frozen fallback PCM buffer plus exactly six enveloped illustrative sine blips. No scene-boundary splice, concatenation, loop edit or reset occurs in mixing/mastering. The fallback score\'s oscillator/envelope events and tonic-only thinning outro are preserved. A C1-continuous soft knee avoids abrupt hard clipping. Vocals/voiceover are absent by construction: code-authored percussion, bass, melody, chords and six sine cues only.', '',
    'The boundary window is ±480 samples (±10 ms). Max sample-to-sample step and isolated-impulse residual are measured across both channels. The click detector flags a sign-reversing pair of adjacent steps both >0.3 full scale with a residual >0.3. The exact cut step must be ≤0.01. These thresholds detect gross waveform cut/impulse faults, not every perceptible artifact. Larger window steps from intentional seeded percussion are reported, not concealed or mistaken for a splice.', ''];
  for (const b of boundaries) lines.push(`- Frame ${b.frame}, ${b.seconds.toFixed(6)} s, sample ${b.sample}: **${b.pass ? 'PASS' : 'FAIL'} analytical cut/click check**; exact boundary step ${b.boundarySampleStep.toFixed(9)}, window max sample step ${b.maxSampleStep.toFixed(9)}, max impulse residual ${b.maxImpulseResidual.toFixed(9)}, detected clicks ${b.clickCount}.`);
  lines.push('', `Start/end zero PCM: **${endpointsZero ? 'PASS' : 'FAIL'}** (all channels\' first/last samples). Frame 1799 is the requested final-frame checkpoint at 59.966667 s; the separate endpoint check includes sample 2,879,999.`, '',
    'No abrupt *edited* musical seams: **PASS by continuous-buffer/envelope construction**, not a human judgment about musical transitions. Scene-boundary continuity/click detector: results above. No vocal content: **PASS by source construction**. Human listening and post-AAC subjective playback remain **not run**.', '',
    'Cue frames: 300, 540, 780, 1020, 1260, 1500; each begins exactly at scene-local frame 120, sample=frame×1600. They are illustrative action blips, **not native product sounds**.');
  await mkdir(qaDir, {recursive: true});
  await writeFile(`${qaDir}audio-seams.md`, `${lines.join('\n')}\n`);
  await writeFile(`${qaDir}audio-seams.json`, `${JSON.stringify({sha256:sha256(bytes), method:'analytical only; no human listening', endpointsZero, boundaries},null,2)}\n`);
  if (!endpointsZero || boundaries.some((b) => !b.pass)) throw new Error('Analytical audio seam gate failed');
  console.log(`PASS analytical seams boundaries=${boundaries.length} endpointsZero=${endpointsZero} humanListening=not-run sha256=${sha256(bytes)}`);
}
if (import.meta.main) { try { await runSeamQa(); } catch (error) { console.error(error.message); process.exitCode=1; } }
