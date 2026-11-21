import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {DEFAULT_SEED, GENERATOR_VERSION, GRID, MUSIC_PROMPT, VOICES, synthesize} from '../src/audio/synth.js';
import {writeWav} from '../src/audio/wav.js';

// I/O and hashing live only in this CLI, never in the browser-compatible core.
const audioDirectory = new URL('../audio/', import.meta.url);
const {channels, peak, gain} = synthesize({seed: DEFAULT_SEED});
const wav = writeWav(channels);
const metadata = {
  seed: DEFAULT_SEED,
  promptEquivalent: MUSIC_PROMPT,
  bpm: GRID.bpm,
  timeSignature: GRID.timeSignature,
  bars: GRID.bars,
  sampleRate: GRID.sampleRate,
  channels: GRID.channels,
  samplesPerChannel: GRID.samplesPerChannel,
  durationSeconds: GRID.durationSeconds,
  sha256: createHash('sha256').update(wav).digest('hex'),
  voices: VOICES,
  generatorVersion: GENERATOR_VERSION,
  generator: 'pure JavaScript Float64 synthesis, seeded mulberry32 noise, PCM16 WAV',
  determinism: 'Byte identity within pinned Bun 1.4.5; Math.sin/libm may differ across runtimes.',
  peakDbfs: 20 * Math.log10(peak),
  headroomGain: gain,
  wavBytes: wav.length,
};
await mkdir(audioDirectory, {recursive: true});
await writeFile(new URL('fallback.wav', audioDirectory), wav);
await writeFile(new URL('fallback.meta.json', audioDirectory), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify({...metadata, output: fileURLToPath(new URL('fallback.wav', audioDirectory))}, null, 2));
