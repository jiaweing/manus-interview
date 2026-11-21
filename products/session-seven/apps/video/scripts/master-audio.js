import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {sha256, AUDIO_GRID} from '../src/audio/cache.js';
import {decodeWav, mixAudio} from '../src/audio/mix.js';
import {masterAudio, MASTER_VERSION, MASTER_TARGET} from '../src/audio/master.js';
import {METER_REFERENCE} from '../src/audio/meter.js';
const audioDir = fileURLToPath(new URL('../audio/', import.meta.url));
export async function runMasterAudio() {
  const source = await readFile(`${audioDir}fallback.wav`);
  const sourceMetadata = JSON.parse(await readFile(`${audioDir}fallback.meta.json`, 'utf8'));
  if (sha256(source) !== sourceMetadata.sha256) throw new Error('Frozen fallback hash mismatch');
  const mixed = mixAudio(decodeWav(source).channels);
  const master = masterAudio(mixed.channels);
  const hash = sha256(master.wav);
  const metadata = {schemaVersion: 1, generatorVersion: MASTER_VERSION, source: 'js-fallback + blips + master',
    sourceSha256: sourceMetadata.sha256, sha256: hash, ...AUDIO_GRID, blipFrames: mixed.blips.map((cue) => cue.frame),
    blips: mixed.blips, blipLabel: mixed.blipLabel, fades: mixed.fades, target: MASTER_TARGET,
    integratedLufs: master.measurements.integratedLufs, truePeakDbtp: master.measurements.truePeakDbtp,
    meter: METER_REFERENCE, initial: master.initial, limiter: master.limiter, passes: master.passes,
    networkRequests: 0, determinism: 'Pure JavaScript Float64, fixed operation order, canonical PCM16; pinned Bun 1.4.5'};
  await mkdir(audioDir, {recursive: true});
  await writeFile(`${audioDir}master.wav`, master.wav);
  await writeFile(`${audioDir}master.meta.json`, `${JSON.stringify(metadata, null, 2)}\n`);
  const manifestPath = `${audioDir}audio-manifest.json`;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // Historical #165 input selection is retained intact, not recast as provider audio.
  const inputSelection = manifest.selectedInput ?? {...manifest};
  const mastered = {path: 'audio/master.wav', metadataPath: 'audio/master.meta.json', sha256: hash,
    sourceSha256: sourceMetadata.sha256, source: metadata.source, blipFrames: metadata.blipFrames,
    blipLabel: metadata.blipLabel, integratedLufs: metadata.integratedLufs, truePeakDbtp: metadata.truePeakDbtp};
  const updated = {...manifest, source: 'js-fallback', processing: metadata.source, path: mastered.path, sha256: hash,
    hashes: {...manifest.hashes, mastered: hash}, selectedInput: inputSelection, mastered};
  await writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
  return metadata;
}
if (import.meta.main) {
  try {
    const result = await runMasterAudio();
    console.log(`PASS audio-master durationSeconds=${result.durationSeconds} sampleRate=${result.sampleRate} channels=${result.channels} samplesPerChannel=${result.samplesPerChannel}`);
    console.log(`integratedLufs=${result.integratedLufs.toFixed(4)} truePeakDbtp=${result.truePeakDbtp.toFixed(4)} networkRequests=0`);
    console.log(`blipFrames=${result.blipFrames.join(',')} sha256=${result.sha256}`);
  } catch (error) { console.error(`FAIL audio-master: ${error.message}`); process.exitCode = 1; }
}
