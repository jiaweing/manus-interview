import {AUDIO_GRID} from './cache.js';
import {SCENES, sceneStartFrame} from '../timeline.js';

export const BLIP_LABEL = 'Illustrative action blips, not native product sounds';
export const BLIP_FRAMES = Object.freeze([300, 540, 780, 1020, 1260, 1500]);
export const BLIP_LENGTH_SAMPLES = 5760; // 120 ms, no repeat/echo or other SFX.
export function frameToSample(frame) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= 1800) throw new RangeError('Invalid locked film frame');
  return frame * 1600;
}
export function createBlips() {
  const products = SCENES.filter((scene) => scene.product);
  const events = BLIP_FRAMES.map((frame, index) => {
    if (sceneStartFrame(products[index]) + 120 !== frame) throw new Error('Action cue differs from locked timeline');
    return {sceneId: products[index].id, frame, localFrame: 120, startSample: frameToSample(frame),
      lengthSamples: BLIP_LENGTH_SAMPLES, frequencyHz: [880, 660, 1046.5, 784, 587.33, 987.77][index],
      label: BLIP_LABEL};
  });
  const channels = [new Float64Array(AUDIO_GRID.samplesPerChannel), new Float64Array(AUDIO_GRID.samplesPerChannel)];
  for (const event of events) {
    for (let i = 0; i < event.lengthSamples; i++) {
      // The event begins AT startSample; its first value is exactly zero for continuity.
      // 5 ms cosine attack, 115 ms cosine-squared release; band-limited sine only.
      const attack = i < 240 ? 0.5 - 0.5 * Math.cos(Math.PI * i / 240) : 1;
      const release = (0.5 + 0.5 * Math.cos(Math.PI * i / (event.lengthSamples - 1))) ** 2;
      const value = i === 0 || i === event.lengthSamples - 1 ? 0
        : 0.075 * attack * release * Math.sin(2 * Math.PI * event.frequencyHz * i / 48000);
      channels[0][event.startSample + i] = value;
      channels[1][event.startSample + i] = value;
    }
  }
  return {channels, events, label: BLIP_LABEL};
}
