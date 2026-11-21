import {AUDIO_GRID} from './cache.js';
import {meterAudio, measureIntegrated, measureTruePeak} from './meter.js';
import {writeWav} from './wav.js';
import {decodeWav} from './mix.js';
export const MASTER_VERSION = '1.0.0';
export const MASTER_TARGET = Object.freeze({integratedLufs: -14, maxTruePeakDbtp: -1, workingTruePeakDbtp: -1.15});
export function softLimit(value, threshold = 0.55, ceiling = 0.84) {
  const magnitude = Math.abs(value);
  if (magnitude <= threshold) return value;
  return Math.sign(value) * (threshold + (ceiling - threshold) * Math.tanh((magnitude - threshold) / (ceiling - threshold)));
}
export function masterAudio(input) {
  if (input.length !== 2 || input.some((c) => c.length !== AUDIO_GRID.samplesPerChannel)) throw new RangeError('Master requires exactly 2,880,000 stereo samples/channel');
  const initial = meterAudio(input);
  if (!Number.isFinite(initial.integratedLufs)) throw new RangeError('Cannot master silent audio');
  let gainDb = MASTER_TARGET.integratedLufs - initial.integratedLufs;
  const limited = initial.truePeakDbtp + gainDb > MASTER_TARGET.workingTruePeakDbtp;
  const ceiling = 10 ** (MASTER_TARGET.workingTruePeakDbtp / 20);
  const passes = [];
  let output, measured, wav;
  for (let pass = 0; pass < 12; pass++) {
    const gain = 10 ** (gainDb / 20);
    output = input.map((channel) => Float64Array.from(channel, (value) => limited ? softLimit(value * gain) : value * gain));
    const peak = measureTruePeak(output);
    const peakSafeGain = Math.min(1, ceiling / peak.truePeak);
    if (peakSafeGain < 1) for (const c of output) for (let i = 0; i < c.length; i++) c[i] *= peakSafeGain;
    // Measure the delivered PCM16 bytes, not just the pre-quantized accumulator.
    wav = writeWav(output);
    const delivered = decodeWav(wav).channels;
    measured = {...measureIntegrated(delivered), ...measureTruePeak(delivered)};
    passes.push({pass: pass + 1, gainDb, peakSafeGain, integratedLufs: measured.integratedLufs, truePeakDbtp: measured.truePeakDbtp});
    const error = MASTER_TARGET.integratedLufs - measured.integratedLufs;
    if (Math.abs(error) <= 0.02 && measured.truePeakDbtp <= MASTER_TARGET.maxTruePeakDbtp) break;
    gainDb += error * (limited ? 1.2 : 1);
  }
  if (Math.abs(measured.integratedLufs + 14) > 1 || measured.truePeakDbtp > -1) throw new Error('Mastering failed required loudness/true-peak gate');
  return {channels: output, wav, measurements: measured, initial, gainDb, limited, passes,
    limiter: {method: limited ? 'C1-continuous symmetric tanh soft knee + measured 4x FIR peak-safe gain; re-meter PCM16' : 'linear gain',
      threshold: 0.55, ceiling: 0.84, workingTruePeakDbtp: -1.15}};
}
