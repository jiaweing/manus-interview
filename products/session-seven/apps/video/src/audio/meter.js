// ITU-R BS.1770-4 Annex 1 Tables 1/2 and Annex 2 four-phase FIR.
// https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-4-201510-S!!PDF-E.pdf
// Stereo-only 48 kHz implementation; no RMS shortcut or calibration fudge factor.
export const K_SHELF = Object.freeze({b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585]});
export const K_HIGHPASS = Object.freeze({b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621]});
export const TRUE_PEAK_FIR = Object.freeze([
  [0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.026611328125, 0.014892578125, -0.00830078125],
  [-0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625, 0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375],
  [-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625, 0.465087890625, -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875],
  [-0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875, 0.97216796875, 0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375],
].map((phase) => Object.freeze(phase)));
export const METER_REFERENCE = Object.freeze({standard: 'ITU-R BS.1770-4', sampleRate: 48000,
  blockSamples: 19200, hopSamples: 4800, absoluteGateLufs: -70, relativeGateLu: -10,
  truePeakOversampling: 4, truePeakMethod: 'Annex 2 48-tap, four-phase FIR; includes zero-padded filter tail and sample peak',
  calibration: '997Hz stereo in-phase sine, per-channel PEAK -20dBFS: -20.0 LUFS +/-0.1; 1kHz stereo -23dBFS: -23.0 +/-0.1 (EBU Tech 3341 case 1)',
});
function check(channels, sampleRate) {
  if (sampleRate !== 48000 || !Array.isArray(channels) || channels.length !== 2 ||
      channels[0].length !== channels[1].length || !channels[0].length) throw new RangeError('Meter requires equal nonempty 48kHz stereo channels');
}
function biquad(input, {b, a}) {
  const result = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    if (!Number.isFinite(x)) throw new RangeError('Meter requires finite PCM');
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    result[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return result;
}
export function kWeight(channel) { return biquad(biquad(channel, K_SHELF), K_HIGHPASS); }
const loudness = (power) => power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
export function measureIntegrated(channels, sampleRate = 48000) {
  check(channels, sampleRate);
  const count = channels[0].length;
  const hop = 4800, block = 19200;
  // 100ms energy bins avoid summing every overlapping 400ms window repeatedly.
  const bins = new Float64Array(Math.floor(count / hop));
  for (const channel of channels) {
    const weighted = kWeight(channel);
    for (let i = 0; i < bins.length * hop; i++) bins[Math.floor(i / hop)] += weighted[i] * weighted[i] / block;
  }
  const blocks = [];
  for (let i = 0; i + 3 < bins.length; i++) blocks.push(bins[i] + bins[i + 1] + bins[i + 2] + bins[i + 3]);
  const absolute = blocks.filter((power) => loudness(power) > -70);
  if (!absolute.length) return {integratedLufs: -Infinity, totalBlocks: blocks.length, absoluteGatedBlocks: 0, relativeGatedBlocks: 0, relativeThresholdLufs: -Infinity};
  const relativeThresholdLufs = loudness(mean(absolute)) - 10;
  const gated = absolute.filter((power) => loudness(power) > relativeThresholdLufs);
  return {integratedLufs: loudness(mean(gated)), totalBlocks: blocks.length,
    absoluteGatedBlocks: absolute.length, relativeGatedBlocks: gated.length, relativeThresholdLufs};
}
export function measureTruePeak(channels, sampleRate = 48000) {
  check(channels, sampleRate);
  let peak = 0, samplePeak = 0;
  for (const channel of channels) {
    // 11 leading/trailing zero samples retain all convolution transients.
    const padded = new Float64Array(channel.length + 22);
    padded.set(channel, 11);
    for (const x of channel) {
      if (!Number.isFinite(x)) throw new RangeError('Meter requires finite PCM');
      samplePeak = Math.max(samplePeak, Math.abs(x));
    }
    for (const h of TRUE_PEAK_FIR) {
      const [h0, h1, h2, h3, h4, h5, h6, h7, h8, h9, h10, h11] = h;
      for (let i = 11; i < padded.length; i++) {
        // Fixed ordering and unrolled FIR keep 60-second offline metering inexpensive.
        const y = h0*padded[i] + h1*padded[i-1] + h2*padded[i-2] + h3*padded[i-3] +
          h4*padded[i-4] + h5*padded[i-5] + h6*padded[i-6] + h7*padded[i-7] +
          h8*padded[i-8] + h9*padded[i-9] + h10*padded[i-10] + h11*padded[i-11];
        peak = Math.max(peak, Math.abs(y));
      }
    }
  }
  peak = Math.max(peak, samplePeak); // Never under-read the known original samples.
  return {truePeak: peak, truePeakDbtp: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    samplePeakDbfs: samplePeak > 0 ? 20 * Math.log10(samplePeak) : -Infinity, oversampling: 4};
}
export function meterAudio(channels, sampleRate = 48000) {
  return {...measureIntegrated(channels, sampleRate), ...measureTruePeak(channels, sampleRate)};
}
