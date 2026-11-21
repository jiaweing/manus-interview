import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeWav} from '../src/audio/mix.js';
import {meterAudio, METER_REFERENCE} from '../src/audio/meter.js';
import {sha256} from '../src/audio/cache.js';
const defaultQaPath = fileURLToPath(new URL('../../../qa/audio-master.json', import.meta.url));
export async function runAudioQa({file, qaPath = defaultQaPath, crossCheckPath} = {}) {
  if (!file) throw new Error('Usage: qa:audio --file <path> [--cross-check <independent-result.json>]');
  const bytes = await readFile(file);
  const pcm = decodeWav(bytes);
  const measurements = meterAudio(pcm.channels);
  const hash = sha256(bytes);
  let crossCheck = {status: 'not-run', reason: 'Independent FFmpeg analysis is not part of JS audio authoring; attach an independently recorded result with --cross-check', toleranceLu: 0.5, toleranceDb: 0.5};
  if (crossCheckPath) {
    const external = JSON.parse(await readFile(crossCheckPath, 'utf8'));
    if (external.sha256 !== hash || !Number.isFinite(external.integratedLufs) || !Number.isFinite(external.truePeakDbtp)) throw new Error('Cross-check must match WAV hash and contain finite levels');
    const deltaLu = Math.abs(measurements.integratedLufs - external.integratedLufs);
    const deltaDb = Math.abs(measurements.truePeakDbtp - external.truePeakDbtp);
    crossCheck = {...external, deltaLu, deltaDb, toleranceLu: 0.5, toleranceDb: 0.5,
      status: deltaLu <= 0.5 && deltaDb <= 0.5 ? 'pass' : 'fail'};
  } else {
    // Keep same-file independent evidence when the exact issue command is rerun.
    try {
      const previous = JSON.parse(await readFile(qaPath, 'utf8'));
      if (previous.sha256 === hash && previous.crossCheck?.sha256 === hash && previous.crossCheck.status === 'pass') crossCheck = previous.crossCheck;
    } catch { /* First QA run has no independent attachment yet. */ }
  }
  const pass = pcm.samplesPerChannel === 2880000 && measurements.integratedLufs >= -15 &&
    measurements.integratedLufs <= -13 && measurements.truePeakDbtp <= -1 && crossCheck.status !== 'fail';
  const report = {status: pass ? 'pass' : 'fail', file: resolve(file), sha256: hash,
    durationSeconds: pcm.samplesPerChannel / pcm.format.sampleRate, sampleRate: pcm.format.sampleRate,
    channels: pcm.format.channels, bitsPerSample: pcm.format.bitsPerSample, samplesPerChannel: pcm.samplesPerChannel,
    integratedLufs: measurements.integratedLufs, truePeakDbtp: measurements.truePeakDbtp, measurements, meter: METER_REFERENCE,
    networkRequests: 0, crossCheck};
  await mkdir(dirname(qaPath), {recursive: true});
  await writeFile(qaPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const option = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing ${name} value`); return resolve(args[i + 1]); };
    if (args.some((arg) => arg.startsWith('--') && !['--file', '--qa', '--cross-check'].includes(arg))) throw new Error('Unknown QA option');
    const report = await runAudioQa({file: option('--file'), qaPath: option('--qa'), crossCheckPath: option('--cross-check')});
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'pass') process.exitCode = 1;
  } catch (error) { console.error(`FAIL qa-audio: ${error.message}`); process.exitCode = 1; }
}
