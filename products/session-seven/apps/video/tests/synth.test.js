import {beforeAll, describe, expect, test} from 'bun:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {CHORDS, DEFAULT_SEED, ENVELOPES, GRID, MUSIC_PROMPT, VOICES, createScore, envelopeAt, mulberry32, synthesize} from '../src/audio/synth.js';
import {WAV_FORMAT, quantizePcm16, writeWav} from '../src/audio/wav.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let audio;
let wav;
let view;
beforeAll(() => {
  audio = synthesize();
  wav = writeWav(audio.channels);
  view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
}, 30000);

function rms(start, end) {
  let squares = 0;
  for (const channel of audio.channels) {
    for (let index = start; index < end; index++) squares += channel[index] ** 2;
  }
  return Math.sqrt(squares / ((end - start) * 2));
}

function text(offset, length) {
  return String.fromCharCode(...wav.slice(offset, offset + length));
}

describe('fallback PCM WAV', () => {
  test('canonical RIFF/WAVE PCM header, byte rate and exact 60-second sample counts', () => {
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(text(12, 4)).toBe('fmt ');
    expect(text(36, 4)).toBe('data');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(28, true)).toBe(192000);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(11520000);
    expect(wav.length).toBe(44 + 11520000);
    expect(audio.channels.map((channel) => channel.length)).toEqual([2880000, 2880000]);
    expect(view.getUint32(40, true) / 4 / 48000).toBe(60);
    expect(WAV_FORMAT.headerBytes).toBe(44);
  });

  test('PCM interleaves left/right little-endian with explicit quantization', () => {
    const bytes = writeWav([new Float64Array([0, 0.5, -0.5]), new Float64Array([1, -1, 0])]);
    const pcm = new DataView(bytes.buffer);
    expect([44, 46, 48, 50, 52, 54].map((offset) => pcm.getInt16(offset, true))).toEqual([0, 32767, 16384, -32767, -16383, 0]);
    expect(quantizePcm16(2)).toBe(32767);
    expect(quantizePcm16(-2)).toBe(-32767);
    expect(() => quantizePcm16(NaN)).toThrow();
    expect(() => writeWav([new Float64Array(1)])).toThrow();
    expect(() => writeWav([new Float64Array(1), new Float64Array(2)])).toThrow();
    expect(() => writeWav([new Float64Array(0), new Float64Array(0)])).toThrow();
  });

  test('Float64 accumulation, stereo content and at least 3 dBFS headroom', () => {
    expect(audio.channels.every((channel) => channel instanceof Float64Array)).toBe(true);
    expect(audio.peak).toBeLessThanOrEqual(0.68);
    expect(audio.peak).toBeGreaterThan(0.15);
    let differentSamples = 0;
    let quantizedPeak = 0;
    for (let offset = 44; offset < wav.length; offset += 4) {
      const left = view.getInt16(offset, true);
      const right = view.getInt16(offset + 2, true);
      if (left !== right) differentSamples++;
      quantizedPeak = Math.max(quantizedPeak, Math.abs(left), Math.abs(right));
    }
    expect(differentSamples).toBeGreaterThan(100000);
    expect(quantizedPeak / 32767).toBeLessThanOrEqual(0.681);
  });

  test('startup and ending have zero PCM samples, not clicks', () => {
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(wav.length - 4, true)).toBe(0);
    expect(view.getInt16(wav.length - 2, true)).toBe(0);
    for (let offset = 44; offset < 44 + 4 * 10; offset += 2) expect(Math.abs(view.getInt16(offset, true))).toBeLessThanOrEqual(2);
    expect(rms(GRID.samplesPerChannel - 480, GRID.samplesPerChannel)).toBeLessThan(0.00001);
  });
});

describe('score, oscillators and envelopes', () => {
  test('exports percussion, triangle bass, square melody and repeating chord voice', () => {
    expect(Object.keys(VOICES)).toEqual(['kick', 'snare', 'hat', 'bass', 'melody', 'chord']);
    expect(VOICES.kick.family).toBe('percussion');
    expect(VOICES.snare.waveform).toContain('seeded');
    expect(VOICES.hat.waveform).toContain('seeded');
    expect(VOICES.bass.waveform).toBe('triangle');
    expect(VOICES.melody.waveform).toContain('square');
    expect(VOICES.chord.family).toBe('chord');
    for (const voice of Object.keys(VOICES)) expect(audio.events.some((event) => event.voice === voice)).toBe(true);
    expect(CHORDS.C).toEqual([60, 64, 67]);
  });

  test('every note has an ADSR-ish envelope with exact zero endpoints', () => {
    for (const event of audio.events) {
      const envelope = ENVELOPES[event.voice];
      expect(envelope.attackSamples).toBeGreaterThan(0);
      expect(envelope.decaySamples).toBeGreaterThan(0);
      expect(envelope.sustainLevel).toBeGreaterThan(0);
      expect(envelope.sustainLevel).toBeLessThanOrEqual(1);
      expect(envelope.releaseFraction).toBeGreaterThan(0);
      expect(envelopeAt(0, event.lengthSamples, envelope)).toBe(0);
      expect(envelopeAt(event.lengthSamples - 1, event.lengthSamples, envelope)).toBe(0);
      expect(envelopeAt(Math.floor(event.lengthSamples / 3), event.lengthSamples, envelope)).toBeGreaterThan(0);
    }
    for (const definition of Object.values(ENVELOPES)) {
      for (let index = 0; index < 9600; index++) {
        const amplitude = envelopeAt(index, 9600, definition);
        expect(amplitude >= 0 && amplitude <= 1).toBe(true);
      }
    }
  });

  test('120 BPM downbeats and beat-3 kicks are integer-aligned to the video beat grid', () => {
    expect(GRID.samplesPerBeat).toBe(24000);
    expect(GRID.samplesPerBar).toBe(96000);
    expect(GRID.samplesPerBar).toBe(4 * GRID.samplesPerBeat);
    expect(GRID.framesPerBeat).toBe(15);
    expect(GRID.samplesPerBeat / GRID.sampleRate * 30).toBe(15);
    const kicks = audio.events.filter((event) => event.voice === 'kick');
    const downbeats = kicks.filter((event) => event.beat === 0);
    expect(downbeats.length).toBe(29);
    for (const event of downbeats) expect(event.startSample % 96000).toBe(0);
    for (let index = 1; index < downbeats.length; index++) expect(downbeats[index].startSample - downbeats[index - 1].startSample).toBe(96000);
    for (const event of kicks) {
      expect(event.startSample % 24000).toBe(0);
      expect([0, 2]).toContain(event.beat);
    }
    const firstKicks = kicks.filter((event) => event.bar === 1);
    expect(firstKicks[0].amplitude).toBeGreaterThan(firstKicks[1].amplitude);
    const snares = audio.events.filter((event) => event.voice === 'snare');
    expect(snares.every((event) => [1, 3].includes(event.beat))).toBe(true);
    expect(snares.filter((event) => event.bar === 4).map((event) => event.startSample)).toEqual([312000, 360000]);
    expect(audio.events.every((event) => Number.isInteger(event.startSample) && event.startSample + event.lengthSamples <= 2880000)).toBe(true);
  });

  test('C-major repeating progression, sparse melody, and a short intro build', () => {
    const chords = (bar) => audio.events.filter((event) => event.bar === bar && event.voice === 'chord');
    expect([1, 2, 3, 4, 5].map((bar) => chords(bar)[0].chord)).toEqual(['C', 'Am', 'F', 'G', 'C']);
    const majorScale = [0, 2, 4, 5, 7, 9, 11];
    for (const event of audio.events.filter((event) => event.midi !== null)) expect(majorScale).toContain(event.midi % 12);
    expect(audio.events.filter((event) => event.voice === 'melody' && event.bar <= 2)).toHaveLength(0);
    expect(audio.events.filter((event) => event.voice === 'snare' && event.bar === 1)).toHaveLength(0);
    for (let bar = 3; bar <= 27; bar++) expect(audio.events.filter((event) => event.bar === bar && event.voice === 'melody').length).toBeLessThanOrEqual(3);
    expect(rms(0, 96000)).toBeLessThan(rms(192000, 288000));
  });

  test('bars 28–30 resolve to tonic only, thin percussion and decay to silence', () => {
    const endNotes = audio.events.filter((event) => event.midi !== null && event.startSample + event.lengthSamples > 27 * 96000);
    expect(endNotes.length).toBeGreaterThan(0);
    for (const event of endNotes) {
      expect(event.chord).toBe('C');
      expect([0, 4, 7]).toContain(event.midi % 12);
    }
    const percussionCount = (bar) => audio.events.filter((event) => event.bar === bar && VOICES[event.voice].family === 'percussion').length;
    expect(percussionCount(28)).toBeGreaterThan(percussionCount(29));
    expect(percussionCount(29)).toBeGreaterThan(percussionCount(30));
    expect(percussionCount(30)).toBe(0);
    const finalMelody = audio.events.filter((event) => event.voice === 'melody').at(-1);
    expect(finalMelody.midi % 12).toBe(0);
    expect(finalMelody.lengthSamples).toBe(3 * 48000);
    expect(finalMelody.startSample + finalMelody.lengthSamples).toBe(2880000);
    const levels = [27, 28, 29].map((bar) => rms(bar * 96000, (bar + 1) * 96000));
    expect(levels[0]).toBeGreaterThan(levels[1]);
    expect(levels[1]).toBeGreaterThan(levels[2]);
    expect(rms(59 * 48000, 60 * 48000)).toBeLessThan(rms(58 * 48000, 59 * 48000));
  });
});

describe('offline determinism and frozen fallback', () => {
  test('same seed produces byte-identical WAV twice in-process', () => {
    const second = writeWav(synthesize({seed: DEFAULT_SEED}).channels);
    expect(hash(second)).toBe(hash(wav));
    expect(Buffer.compare(Buffer.from(second), Buffer.from(wav))).toBe(0);
    expect(createScore()).toEqual(audio.events);
  }, 30000);

  test('changing only the seed changes percussion and WAV bytes', () => {
    const different = writeWav(synthesize({seed: DEFAULT_SEED + 1}).channels);
    expect(hash(different)).not.toBe(hash(wav));
    const a = mulberry32(5);
    const b = mulberry32(5);
    expect(Array.from({length: 16}, a)).toEqual(Array.from({length: 16}, b));
    expect(() => synthesize({seed: -1})).toThrow();
    expect(() => synthesize({seed: 1.5})).toThrow();
  }, 30000);

  test('frozen WAV and metadata match the generator, prompt and exact format', () => {
    const frozen = readFileSync(new URL('../audio/fallback.wav', import.meta.url));
    const metadata = JSON.parse(readFileSync(new URL('../audio/fallback.meta.json', import.meta.url), 'utf8'));
    expect(frozen.length).toBe(11520044);
    expect(hash(frozen)).toBe(hash(wav));
    expect(metadata.sha256).toBe(hash(frozen));
    expect(metadata.seed).toBe(DEFAULT_SEED);
    expect(metadata.promptEquivalent).toBe(MUSIC_PROMPT);
    expect(metadata.bpm).toBe(120);
    expect(metadata.timeSignature).toBe('4/4');
    expect(metadata.bars).toBe(30);
    expect(metadata.sampleRate).toBe(48000);
    expect(metadata.channels).toBe(2);
    expect(metadata.samplesPerChannel).toBe(2880000);
    expect(metadata.durationSeconds).toBe(60);
    expect(metadata.voices).toEqual(VOICES);
    expect(metadata.generatorVersion).toBe('1.0.0');
  });

  test('source has no network, clock or unseeded randomness; core has no Node APIs or dependencies', () => {
    const forbidden = /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|https?:\/\/|Date\.now\s*\(|Math\.random\s*\(/;
    for (const file of ['../src/audio/synth.js', '../src/audio/wav.js', '../scripts/music-fallback.js']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(forbidden);
      if (file.includes('/src/')) expect(source).not.toMatch(/\bimport\b|\brequire\s*\(|\bBuffer\b|\bprocess\b|node:/);
    }
  });
});
