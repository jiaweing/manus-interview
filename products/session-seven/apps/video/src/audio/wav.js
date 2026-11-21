// No codecs: quantize Float64 PCM once, then write the canonical 44-byte header.
export const WAV_FORMAT = Object.freeze({sampleRate: 48000, channels: 2, bitsPerSample: 16, headerBytes: 44});

export function quantizePcm16(value) {
  if (!Number.isFinite(value)) throw new RangeError('PCM samples must be finite');
  return Math.round(Math.max(-1, Math.min(1, value)) * 32767);
}

export function writeWav(channels) {
  if (!Array.isArray(channels) || channels.length !== WAV_FORMAT.channels) throw new RangeError('WAV requires two channels');
  const samples = channels[0].length;
  if (!Number.isSafeInteger(samples) || samples <= 0 || channels[1].length !== samples) throw new RangeError('WAV requires equal nonempty channel lengths');
  const dataBytes = samples * WAV_FORMAT.channels * WAV_FORMAT.bitsPerSample / 8;
  if (dataBytes + 36 > 0xffffffff) throw new RangeError('PCM exceeds RIFF size limit');
  const bytes = new Uint8Array(WAV_FORMAT.headerBytes + dataBytes);
  const view = new DataView(bytes.buffer);
  function text(offset, value) {
    for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index);
  }
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // Linear PCM, not IEEE float or compressed audio.
  view.setUint16(22, WAV_FORMAT.channels, true);
  view.setUint32(24, WAV_FORMAT.sampleRate, true);
  view.setUint32(28, WAV_FORMAT.sampleRate * WAV_FORMAT.channels * 2, true);
  view.setUint16(32, WAV_FORMAT.channels * 2, true);
  view.setUint16(34, WAV_FORMAT.bitsPerSample, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = WAV_FORMAT.headerBytes;
  for (let index = 0; index < samples; index++) {
    for (const channel of channels) {
      view.setInt16(offset, quantizePcm16(channel[index]), true);
      offset += 2;
    }
  }
  return bytes;
}
