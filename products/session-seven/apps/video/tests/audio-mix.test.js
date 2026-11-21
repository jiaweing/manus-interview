import {describe, expect, test} from 'bun:test';
import {readFile, mkdtemp, cp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BLIP_FRAMES, BLIP_LENGTH_SAMPLES, createBlips, frameToSample} from '../src/audio/blips.js';
import {mixAudio, decodeWav, fadeGainAt} from '../src/audio/mix.js';
import {meterAudio, measureIntegrated, measureTruePeak} from '../src/audio/meter.js';
import {masterAudio, softLimit} from '../src/audio/master.js';
import {sha256} from '../src/audio/cache.js';
import {selectAudio, selectFilmAudio, DEFAULT_FALLBACK_DIR} from '../src/audio/select-audio.js';
const sourcePath = new URL('../audio/fallback.wav', import.meta.url);
function sine({seconds = 4, frequency = 997, amplitude = 0.1, phase = 0, taper = false} = {}) {
  const c = new Float64Array(seconds * 48000);
  for (let i = 0; i < c.length; i++) {
    const envelope = taper ? Math.min(1, i / 480, (c.length - 1 - i) / 480) : 1;
    c[i] = amplitude * envelope * Math.sin(2 * Math.PI * frequency * i / 48000 + phase);
  }
  return [c, c.slice()];
}
describe('locked cue alignment and deterministic mix', () => {
  test('exactly six illustrative cues at product-local frame 120, with exact sample starts', () => {
    const blips = createBlips();
    expect(BLIP_FRAMES).toEqual([300, 540, 780, 1020, 1260, 1500]);
    expect(blips.events).toHaveLength(6);
    expect(blips.label).toContain('not native product sounds');
    for (const cue of blips.events) {
      expect(cue.localFrame).toBe(120);
      expect(cue.startSample).toBe(cue.frame * 1600);
      expect(frameToSample(cue.frame)).toBe(cue.startSample);
      expect(blips.channels[0][cue.startSample - 1]).toBe(0);
      expect(blips.channels[0][cue.startSample]).toBe(0);
      expect(blips.channels[0][cue.startSample + 1]).not.toBe(0);
      expect(blips.channels[0][cue.startSample + BLIP_LENGTH_SAMPLES - 1]).toBe(0);
    }
    let outsideNonzero = 0;
    for (let i = 0; i < 2880000; i++) {
      if (!blips.events.some((cue) => i >= cue.startSample && i < cue.startSample + cue.lengthSamples) && blips.channels[0][i] !== 0) outsideNonzero++;
    }
    expect(outsideNonzero).toBe(0);
    expect(() => frameToSample(1800)).toThrow();
    expect(() => frameToSample(1.5)).toThrow();
  });
  test('mix has exact zero fade endpoints and unchanged stereo sample count', async () => {
    const decoded = decodeWav(await readFile(sourcePath));
    const mixed = mixAudio(decoded.channels);
    expect(mixed.channels).toHaveLength(2);
    expect(fadeGainAt(0, 2880000)).toBe(0);
    expect(fadeGainAt(2879999, 2880000)).toBe(0);
    expect(fadeGainAt(480, 2880000)).toBe(1);
    for (const c of mixed.channels) {
      expect(c.length).toBe(2880000); expect(c[0]).toBe(0); expect(c[c.length - 1]).toBe(0);
    }
    expect(() => mixAudio([new Float64Array(4), new Float64Array(4)])).toThrow();
  });
  test('mixing/mastering twice produces identical bytes matching the committed hash', async () => {
    const source = decodeWav(await readFile(sourcePath)).channels;
    const a = masterAudio(mixAudio(source).channels);
    const b = masterAudio(mixAudio(source).channels);
    expect(sha256(a.wav)).toBe(sha256(b.wav));
    expect(sha256(a.wav)).toBe(sha256(await readFile(new URL('../audio/master.wav', import.meta.url))));
    expect(a.measurements.integratedLufs).toBeGreaterThanOrEqual(-15);
    expect(a.measurements.integratedLufs).toBeLessThanOrEqual(-13);
    expect(Math.abs(a.measurements.integratedLufs + 14)).toBeLessThanOrEqual(0.02);
    expect(a.measurements.truePeakDbtp).toBeLessThanOrEqual(-1);
    const c = decodeWav(a.wav).channels;
    expect(c[0].length).toBe(2880000); expect(c[1].length).toBe(2880000);
    expect(c[0][0]).toBe(0); expect(c[1][2879999]).toBe(0);
    expect(a.limited).toBe(true);
  }, 240000);
  test('soft limiter is odd, transparent below knee, bounded and continuous', () => {
    expect(softLimit(0)).toBe(0); expect(softLimit(0.3)).toBe(0.3);
    expect(softLimit(100)).toBeLessThanOrEqual(0.84);
    expect(softLimit(-100)).toBe(-softLimit(100));
    expect(Math.abs(softLimit(0.55 + 1e-7) - 0.55)).toBeLessThan(2e-7);
  });
});
describe('BS.1770-4 calibration and gates', () => {
  test('997Hz peak -20dBFS stereo is -20.0 LUFS +/-0.1 and -20 dBTP +/-0.1', () => {
    const measured = meterAudio(sine());
    expect(Math.abs(measured.integratedLufs + 20)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(measured.truePeakDbtp + 20)).toBeLessThanOrEqual(0.1);
    expect(measured.oversampling).toBe(4);
    expect(measured.totalBlocks).toBe(37);
  });
  test('EBU case 1: 20s 1000Hz peak -23dBFS stereo is -23 LUFS +/-0.1', () => {
    expect(Math.abs(measureIntegrated(sine({seconds: 20, frequency: 1000, amplitude: 10 ** (-23 / 20)})).integratedLufs + 23)).toBeLessThanOrEqual(0.1);
  });
  test('one active channel is 3.0103 LU below the two-channel reference', () => {
    const stereo = sine();
    const a = measureIntegrated(stereo).integratedLufs;
    const b = measureIntegrated([stereo[0], new Float64Array(stereo[0].length)]).integratedLufs;
    expect(a - b).toBeCloseTo(10 * Math.log10(2), 5);
  });
  test('EBU cases 3/4: quiet and below-absolute-gate tails are excluded', () => {
    for (const extra of [false, true]) {
      const levels = extra ? [[10,-72],[10,-36],[60,-23],[10,-36],[10,-72]] : [[10,-36],[60,-23],[10,-36]];
      const samples = levels.reduce((sum, [seconds]) => sum + seconds * 48000, 0);
      const c = new Float64Array(samples); let at = 0;
      for (const [seconds, db] of levels) {
        for (let i = 0; i < seconds * 48000; i++) c[at + i] = 10 ** (db / 20) * Math.sin(2 * Math.PI * 1000 * i / 48000);
        at += seconds * 48000;
      }
      const r = measureIntegrated([c, c]);
      expect(Math.abs(r.integratedLufs + 23)).toBeLessThanOrEqual(0.1);
      expect(r.relativeGatedBlocks).toBeLessThan(r.totalBlocks);
      if (extra) expect(r.absoluteGatedBlocks).toBeLessThan(r.totalBlocks);
    }
  }, 30000);
  test('silence, below-absolute gate and incomplete blocks do not become finite loudness', () => {
    expect(measureIntegrated([new Float64Array(48000),new Float64Array(48000)]).integratedLufs).toBe(-Infinity);
    expect(measureIntegrated(sine({amplitude: 10 ** (-80 / 20)})).integratedLufs).toBe(-Infinity);
    expect(measureIntegrated([new Float64Array(19199),new Float64Array(19199)]).totalBlocks).toBe(0);
    expect(() => meterAudio(sine(), 44100)).toThrow();
  });
  for (const [id, frequency, phaseDeg, amplitude, reference] of [[15,12000,0,0.5,-6],[16,12000,45,0.5,-6],[17,8000,60,0.5,-6],[18,6000,67.5,0.5,-6],[19,12000,45,1.41,3]]) {
    test(`EBU true-peak case ${id}: ${frequency}Hz phase ${phaseDeg}deg`, () => {
      const r = measureTruePeak(sine({seconds: 1, frequency, phase: phaseDeg * Math.PI / 180, amplitude, taper: true}));
      expect(r.truePeakDbtp).toBeGreaterThanOrEqual(reference - 0.4);
      expect(r.truePeakDbtp).toBeLessThanOrEqual(reference + 0.2);
      if (id === 16) expect(r.truePeakDbtp - r.samplePeakDbfs).toBeGreaterThan(2.5);
    });
  }
});
describe('frozen film-master routing', () => {
  test('film selector returns pinned mastered WAV; legacy source selection remains unchanged', async () => {
    const film = await selectFilmAudio();
    const manifest = JSON.parse(await readFile(new URL('../audio/audio-manifest.json', import.meta.url), 'utf8'));
    expect(film.path).toBe(join(DEFAULT_FALLBACK_DIR, 'master.wav'));
    expect(film.sha256).toBe(manifest.mastered.sha256);
    expect(film.source).toBe('js-fallback');
    expect(film.processing).toBe('js-fallback + blips + master');
    expect(film.networkRequests).toBe(0);
    const raw = await selectAudio({cacheDir: join(DEFAULT_FALLBACK_DIR, 'no-cache-fixture')});
    expect(raw.path).toBe(join(DEFAULT_FALLBACK_DIR, 'fallback.wav'));
    expect(raw.sha256).toBe(manifest.hashes.fallback);
  }, 30000);
  test('master hash and source provenance mismatches fail closed', async () => {
    const path = await mkdtemp(join(tmpdir(), 'audio-master-166-'));
    try {
      await cp(DEFAULT_FALLBACK_DIR, path, {recursive:true});
      const manifest = JSON.parse(await readFile(join(path,'audio-manifest.json'),'utf8'));
      const bytes = await readFile(join(path,'master.wav')); bytes[100] ^= 1;
      await writeFile(join(path,'master.wav'),bytes);
      await expect(selectAudio({cacheDir:join(path,'cache'),fallbackDir:path,hashes:manifest.hashes})).rejects.toThrow('Frozen master hash mismatch');
      await cp(join(DEFAULT_FALLBACK_DIR,'master.wav'),join(path,'master.wav'));
      const meta = JSON.parse(await readFile(join(path,'master.meta.json'),'utf8')); meta.sourceSha256='0'.repeat(64);
      await writeFile(join(path,'master.meta.json'),JSON.stringify(meta));
      await expect(selectAudio({cacheDir:join(path,'cache'),fallbackDir:path,hashes:manifest.hashes})).rejects.toThrow('Frozen master provenance/levels invalid');
    } finally { await rm(path,{recursive:true,force:true}); }
  }, 30000);
});
