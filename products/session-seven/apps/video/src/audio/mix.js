import {readPcmWav, AUDIO_GRID} from './cache.js';
import {createBlips} from './blips.js';
export const FADES = Object.freeze({inSamples: 480, outSamples: 96000, shape: 'raised cosine'});
export function decodeWav(bytes) {
  const {format, pcmBytes} = readPcmWav(bytes);
  if (format.sampleRate !== 48000 || format.channels !== 2) throw new RangeError('Meter/mixer requires 48kHz stereo PCM16');
  const count = pcmBytes.length / 4;
  const channels = [new Float64Array(count), new Float64Array(count)];
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  for (let i = 0; i < count; i++) {
    channels[0][i] = view.getInt16(i * 4, true) / 32768;
    channels[1][i] = view.getInt16(i * 4 + 2, true) / 32768;
  }
  return {channels, format, samplesPerChannel: count};
}
export function fadeGainAt(i, count, fades = FADES) {
  const head = i < fades.inSamples ? 0.5 - 0.5 * Math.cos(Math.PI * i / (fades.inSamples - 1)) : 1;
  const tail = i >= count - fades.outSamples
    ? 0.5 - 0.5 * Math.cos(Math.PI * (count - 1 - i) / (fades.outSamples - 1)) : 1;
  return head * tail;
}
export function mixAudio(fallbackChannels) {
  if (fallbackChannels.length !== 2 || fallbackChannels.some((c) => c.length !== AUDIO_GRID.samplesPerChannel)) {
    throw new RangeError('Mix requires exactly 2,880,000 samples per stereo channel');
  }
  const blips = createBlips();
  const channels = fallbackChannels.map((source, ch) => {
    const output = new Float64Array(source.length);
    for (let i = 0; i < source.length; i++) {
      if (!Number.isFinite(source[i])) throw new RangeError('Nonfinite input PCM');
      output[i] = (source[i] + blips.channels[ch][i]) * fadeGainAt(i, source.length);
    }
    return output;
  });
  return {channels, blips: blips.events, blipLabel: blips.label, fades: FADES};
}
