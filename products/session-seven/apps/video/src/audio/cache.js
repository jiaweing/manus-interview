import {createHash} from 'node:crypto';
import {FPS, FRAMES_PER_BAR, TOTAL_FRAMES} from '../timeline.js';

export const AUDIO_GRID = Object.freeze({
  sampleRate: 48000, channels: 2, bitsPerSample: 16,
  samplesPerChannel: TOTAL_FRAMES / FPS * 48000,
  durationSeconds: TOTAL_FRAMES / FPS, samplesPerFrame: 48000 / FPS,
  samplesPerBar: FRAMES_PER_BAR * 48000 / FPS, toleranceFrames: 1,
});

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const tag = (bytes, at) => String.fromCharCode(...bytes.subarray(at, at + 4));
const invalid = (reason) => { throw Object.assign(new Error(reason), {audioReason: reason}); };

/** Strict RIFF PCM16 parser: never trust MIME, chunk lengths, or header claims. */
export function readPcmWav(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 44 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') invalid('corrupt-wav');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) invalid('truncated-or-corrupt-wav');
  let format;
  let pcmBytes;
  for (let at = 12; at < bytes.length;) {
    if (at + 8 > bytes.length) invalid('truncated-or-corrupt-wav');
    const name = tag(bytes, at);
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size;
    const next = end + (size % 2);
    if (next > bytes.length) invalid('truncated-or-corrupt-wav');
    if (name === 'fmt ') {
      if (format || size < 16) invalid('corrupt-wav');
      const code = view.getUint16(at + 8, true);
      if (code !== 1) invalid('needs-decoder');
      format = {
        channels: view.getUint16(at + 10, true), sampleRate: view.getUint32(at + 12, true),
        byteRate: view.getUint32(at + 16, true), blockAlign: view.getUint16(at + 20, true),
        bitsPerSample: view.getUint16(at + 22, true), endianness: 'little',
      };
    }
    if (name === 'data') {
      if (pcmBytes || size === 0) invalid('corrupt-pcm');
      pcmBytes = bytes.subarray(at + 8, end);
    }
    at = next;
  }
  if (!format || !pcmBytes) invalid('corrupt-wav');
  if (format.bitsPerSample !== 16) invalid('unsupported-pcm-format');
  if (format.blockAlign !== format.channels * 2 || format.byteRate !== format.sampleRate * format.blockAlign || pcmBytes.length % format.blockAlign !== 0) invalid('corrupt-pcm');
  return {format, pcmBytes};
}

/** Lossless pure-JS wrapping of explicitly described interleaved LE PCM16. */
export function pcm16ToWav(pcmBytes, format = AUDIO_GRID) {
  const bytes = new Uint8Array(44 + pcmBytes.length);
  const view = new DataView(bytes.buffer);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, format.channels, true); view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.sampleRate * format.channels * 2, true);
  view.setUint16(32, format.channels * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, pcmBytes.length, true); bytes.set(pcmBytes, 44);
  return bytes;
}

/**
 * 160-sample (0.1 video-frame) stereo energy blocks and positive energy flux.
 * Search +/- five video frames at each expected bar, then backtrack the strongest
 * rise to its 10%-flux foot. The onset, not a requested BPM or a waveform peak,
 * is measured. No synth score/event metadata is consulted. Missing onsets fail.
 * This conservative gate is not a genre classifier or an automatic rights review.
 */
function measurePcm(pcmBytes) {
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  const block = 160;
  const energies = new Float64Array(AUDIO_GRID.samplesPerChannel / block);
  let sum = 0;
  let sumSquares = 0;
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < AUDIO_GRID.samplesPerChannel; i++) {
    let power = 0;
    for (let channel = 0; channel < 2; channel++) {
      const integer = view.getInt16(i * 4 + channel * 2, true);
      const value = integer / 32768;
      peak = Math.max(peak, Math.abs(value));
      if (Math.abs(integer) >= 32760) clipped++;
      sum += value;
      sumSquares += value * value;
      power += value * value / 2;
    }
    energies[Math.floor(i / block)] += power / block;
  }
  const count = AUDIO_GRID.samplesPerChannel * 2;
  const rms = Math.sqrt(sumSquares / count);
  const dc = sum / count;
  const variance = Math.max(0, sumSquares / count - dc * dc);
  let minEnergy = Infinity;
  let maxEnergy = 0;
  for (const energy of energies) { minEnergy = Math.min(minEnergy, energy); maxEnergy = Math.max(maxEnergy, energy); }
  const measurements = {
    sampleRate: 48000, channels: 2, bitsPerSample: 16,
    samplesPerChannel: AUDIO_GRID.samplesPerChannel, durationSeconds: AUDIO_GRID.durationSeconds,
    rms, peak, dc, variance, clippedFraction: clipped / count,
    energyRange: maxEnergy - minEnergy,
    timing: {method: '160-sample stereo energy-flux; strongest-rise 10% foot',
      samplesPerFrame: AUDIO_GRID.samplesPerFrame, samplesPerBar: AUDIO_GRID.samplesPerBar,
      toleranceFrames: 1, resolutionFrames: block / AUDIO_GRID.samplesPerFrame,
      searchRadiusFrames: 5, downbeats: [], maxAbsDriftFrames: 0},
  };
  if (rms < 0.001) return {reason: 'unusable-silence', measurements};
  if (variance < 0.000001 || maxEnergy - minEnergy < 0.000001) return {reason: 'unusable-near-constant', measurements};
  if (measurements.clippedFraction > 0.001) return {reason: 'unusable-clipping', measurements};
  // Average two energy blocks to reduce individual oscillator-cycle fluctuations.
  const smooth = new Float64Array(energies.length);
  const flux = new Float64Array(energies.length);
  for (let i = 0; i < energies.length; i++) {
    smooth[i] = (energies[i] + (energies[i - 1] ?? 0)) / 2;
    flux[i] = Math.max(0, smooth[i] - (smooth[i - 1] ?? 0));
  }
  let missing = false;
  for (let expectedSample = 0; expectedSample < AUDIO_GRID.samplesPerChannel; expectedSample += AUDIO_GRID.samplesPerBar) {
    const center = expectedSample / block;
    const lo = Math.max(0, center - 50);
    const hi = Math.min(flux.length - 1, center + 50);
    let strongest = lo;
    for (let i = lo; i <= hi; i++) if (flux[i] > flux[strongest]) strongest = i;
    if (flux[strongest] < 0.000002) {
      measurements.timing.downbeats.push({expectedSample, expectedFrame: expectedSample / 1600, detectedSample: null, driftFrames: null, reason: 'missing-energy-onset'});
      missing = true;
      continue;
    }
    let onset = strongest;
    // Follow the connected rise; a single low-flux block can occur at a cycle zero.
    while (onset > lo && (flux[onset - 1] > flux[strongest] * 0.1 ||
      (onset > lo + 1 && flux[onset - 2] > flux[strongest] * 0.1))) onset--;
    const detectedSample = onset * block;
    const driftFrames = (detectedSample - expectedSample) / AUDIO_GRID.samplesPerFrame;
    measurements.timing.downbeats.push({expectedSample, expectedFrame: expectedSample / 1600, detectedSample, driftSamples: detectedSample - expectedSample, driftFrames, energyFlux: flux[strongest]});
    measurements.timing.maxAbsDriftFrames = Math.max(measurements.timing.maxAbsDriftFrames, Math.abs(driftFrames));
  }
  if (missing) return {reason: 'missing-downbeat-onset', measurements};
  if (measurements.timing.maxAbsDriftFrames > 1) return {reason: 'downbeat-drift-exceeds-one-frame', measurements};
  return {reason: 'validated', measurements};
}

/** No decode executable, dependency, network, resampling, trim, or time-stretch. */
export function validateCandidate(bytes, opts = {}) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) invalid('corrupt-pcm');
    const wav = tag(bytes, 0) === 'RIFF' || /wav|wave/.test(opts.mimeType ?? '');
    let format;
    let pcmBytes;
    if (wav) ({format, pcmBytes} = readPcmWav(bytes));
    else if (/^audio\/(?:pcm|pcm16|raw)(?:;|$)/i.test(opts.mimeType ?? '') || (!opts.mimeType && opts.format)) {
      if (bytes.length % 4 !== 0) invalid('corrupt-pcm');
      format = opts.format;
      if (!format || format.bitsPerSample !== 16 || format.endianness !== 'little') invalid('pcm-format-required');
      pcmBytes = bytes;
    } else invalid('needs-decoder');
    if (format.sampleRate !== 48000 || format.channels !== 2) invalid('requires-48000hz-stereo');
    if (pcmBytes.length !== AUDIO_GRID.samplesPerChannel * 4) {
      return {accepted: false, reason: 'duration-must-be-exactly-60-seconds', measurements: {
        sampleRate: format.sampleRate, channels: format.channels, samplesPerChannel: pcmBytes.length / 4,
        durationSeconds: pcmBytes.length / 4 / format.sampleRate,
      }};
    }
    const result = measurePcm(pcmBytes);
    if (result.reason !== 'validated') return {accepted: false, ...result};
    return {accepted: true, ...result, pcmBytes, decodedWav: pcm16ToWav(pcmBytes)};
  } catch (error) {
    return {accepted: false, reason: error.audioReason ?? 'corrupt-pcm', measurements: null};
  }
}
