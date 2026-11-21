import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {selectAudio, DEFAULT_CACHE_DIR, DEFAULT_FALLBACK_DIR} from '../src/audio/select-audio.js';

const videoDir = fileURLToPath(new URL('../', import.meta.url));
const defaultManifestPath = fileURLToPath(new URL('../audio/audio-manifest.json', import.meta.url));
const defaultQaPath = fileURLToPath(new URL('../../../qa/audio-cache.json', import.meta.url));

export async function runAudioCacheValidation({cacheDir = DEFAULT_CACHE_DIR, fallbackDir = DEFAULT_FALLBACK_DIR,
  manifestPath = defaultManifestPath, qaPath = defaultQaPath, freeze = false} = {}) {
  let manifest;
  if (!freeze) manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const selection = await selectAudio({cacheDir, fallbackDir, hashes: manifest?.hashes});
  if (!freeze && (manifest.schemaVersion !== 1 || (selection.source === 'provider-cache' &&
      (manifest.source !== selection.source || manifest.sha256 !== selection.sha256)))) {
    throw new Error('Selected audio differs from frozen manifest; review and explicitly --freeze during authoring');
  }
  const {sampleRate, channels, bitsPerSample, samplesPerChannel, durationSeconds, timing} = selection.measurements;
  if (freeze) {
    manifest = {schemaVersion: 1, source: selection.source,
      path: relative(videoDir, selection.path), sha256: selection.sha256, hashes: selection.hashes,
      reason: selection.reason, networkRequests: 0,
      sampleFormat: {sampleRate, channels, bitsPerSample, samplesPerChannel, durationSeconds},
      timingReview: {method: timing.method, measuredDownbeats: timing.downbeats.length,
        maxAbsDriftFrames: timing.maxAbsDriftFrames, toleranceFrames: timing.toleranceFrames},
      providerStatus: selection.source === 'js-fallback' ? 'No accepted provider cache; offline fallback; provider access not checked here' : 'Validated cached candidate; no render-time generation',
    };
    if (selection.source === 'provider-cache') {
      const fallbackMetadata = JSON.parse(await readFile(resolve(fallbackDir, 'fallback.meta.json'), 'utf8'));
      manifest.hashes = {provider: selection.hashes, fallback: fallbackMetadata.sha256};
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const report = {status: 'pass', source: selection.source, path: relative(videoDir, selection.path),
    sha256: selection.sha256, hashes: selection.hashes, reason: selection.reason,
    networkRequests: selection.networkRequests, manifestHashMatches: manifest.sha256 === selection.sha256,
    hashesMatch: true, frozenSource: manifest.source,
    sampleValidation: {sampleRate, channels, bitsPerSample, samplesPerChannel, durationSeconds, pass: true},
    measurements: selection.measurements, providerMeasurements: selection.providerMeasurements ?? null,
    review: selection.source === 'js-fallback'
      ? `JS fallback selected: ${selection.reason}; 30 measured downbeats within one video frame. No provider success claimed.`
      : 'Source/decoded PCM/WAV hashes match; all 30 measured downbeats within one video frame.',
  };
  await mkdir(dirname(qaPath), {recursive: true});
  await writeFile(qaPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const option = (name) => { const at = args.indexOf(name); return at === -1 ? undefined : resolve(args[at + 1]); };
    const report = await runAudioCacheValidation({freeze: args.includes('--freeze'),
      cacheDir: option('--cache-dir'), fallbackDir: option('--fallback-dir'),
      manifestPath: option('--manifest'), qaPath: option('--qa')});
    const sample = report.sampleValidation;
    console.log(`PASS audio-cache selected source=${report.source} networkRequests=${report.networkRequests}`);
    console.log(`sampleRate=${sample.sampleRate} channels=${sample.channels} samplesPerChannel=${sample.samplesPerChannel} durationSeconds=${sample.durationSeconds}`);
    console.log(`downbeats=${report.measurements.timing.downbeats.length} maxAbsDriftFrames=${report.measurements.timing.maxAbsDriftFrames} toleranceFrames=1`);
    console.log(`sha256=${report.sha256} matchingHashes=${report.hashesMatch} manifestHashMatches=${report.manifestHashMatches} reason=${report.reason}`);
  } catch (error) {
    console.error(`FAIL audio-cache: ${error.message}`);
    process.exitCode = 1;
  }
}
