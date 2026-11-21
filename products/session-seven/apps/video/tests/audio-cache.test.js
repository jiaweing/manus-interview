import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {cp, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {synthesize, MUSIC_PROMPT} from '../src/audio/synth.js';
import {writeWav} from '../src/audio/wav.js';
import {AUDIO_GRID, pcm16ToWav, readPcmWav, sha256, validateCandidate} from '../src/audio/cache.js';
import {selectAudio, DEFAULT_FALLBACK_DIR} from '../src/audio/select-audio.js';
import {acceptCandidate} from '../src/music/candidate-sink.js';
import {runAudioCacheValidation} from '../scripts/validate-audio-cache.js';

const rights = {approvedBy: 'Fixture reviewer (not real provider approval)', terms: 'Synthetic JS test content only', ref: 'test:#165'};
const createdAt = '2026-11-21T12:00:00.000Z';
const pcmFormat = {sampleRate: 48000, channels: 2, bitsPerSample: 16, endianness: 'little'};
let valid;
let workspace;
let frozen;
beforeAll(async () => {
  // Candidate deliberately generated from source, not downloaded or score-validated.
  valid = writeWav(synthesize().channels);
  workspace = await mkdtemp(join(tmpdir(), 'audio-cache-165-'));
  frozen = join(workspace, 'accepted');
  expect(await acceptCandidate(candidate(frozen))).toEqual({accepted: true, reason: 'validated and frozen'});
});
afterAll(async () => { if (workspace) await rm(workspace, {recursive: true, force: true}); });
function candidate(cacheDir, patch = {}) {
  return {bytes: valid, mimeType: 'audio/wav', model: 'synthetic/provider-fixture', prompt: MUSIC_PROMPT,
    rights, createdAt, usage: {total_tokens: 4, cost: 0, authorization: 'never-copy-this'},
    requestMeta: {attempts: 1, rightsApproved: true, authorization: 'never-copy-this', apiKey: 'never-copy-this'}, cacheDir, ...patch};
}
async function copyCache(name) {
  const path = join(workspace, name);
  await cp(frozen, path, {recursive: true});
  return path;
}
function shifted(samples) {
  const pcm = readPcmWav(valid).pcmBytes;
  const output = new Uint8Array(pcm.length);
  if (samples >= 0) output.set(pcm.subarray(0, pcm.length - samples * 4), samples * 4);
  else output.set(pcm.subarray(-samples * 4));
  return pcm16ToWav(output);
}
async function rewriteMetadata(path, update) {
  const metadata = JSON.parse(await readFile(join(path, 'metadata.json'), 'utf8'));
  update(metadata);
  await writeFile(join(path, 'metadata.json'), `${JSON.stringify(metadata)}\n`);
}
const choose = (cacheDir, options = {}) => selectAudio({cacheDir, fallbackDir: DEFAULT_FALLBACK_DIR, ...options});

 describe('candidate integrity, content and measured timing', () => {
  test('synthetic 60-second on-grid candidate measures every downbeat', () => {
    const result = validateCandidate(valid, {mimeType: 'audio/wav'});
    expect(result.accepted).toBe(true);
    expect(result.measurements.samplesPerChannel).toBe(2880000);
    expect(result.measurements.durationSeconds).toBe(60);
    expect(result.measurements.timing.downbeats).toHaveLength(30);
    expect(result.measurements.timing.samplesPerFrame).toBe(1600);
    expect(result.measurements.timing.maxAbsDriftFrames).toBeLessThanOrEqual(1);
    for (const [bar, onset] of result.measurements.timing.downbeats.entries()) {
      expect(onset.expectedSample).toBe(bar * 96000);
      expect(Math.abs(onset.driftFrames)).toBeLessThanOrEqual(1);
    }
    expect(sha256(result.decodedWav)).toBe(sha256(valid));
  });
  test('raw PCM16 needs explicit format; the only non-WAV supported decode is lossless JS wrapping', () => {
    const pcm = readPcmWav(valid).pcmBytes;
    expect(validateCandidate(pcm, {mimeType: 'audio/pcm'}).reason).toBe('pcm-format-required');
    const result = validateCandidate(pcm, {mimeType: 'audio/pcm', format: pcmFormat});
    expect(result.accepted).toBe(true);
    expect(sha256(result.decodedWav)).toBe(sha256(valid));
    expect(validateCandidate(pcm, {mimeType: 'audio/pcm', format: {...pcmFormat, endianness: 'big'}}).accepted).toBe(false);
  });
  test('compressed provider bytes need a decoder, even if PCM format metadata is supplied', () => {
    for (const mimeType of ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/flac']) {
      expect(validateCandidate(new Uint8Array([0xff, 0xfb, 0, 0]), {mimeType, format: pcmFormat})).toEqual({accepted: false, reason: 'needs-decoder', measurements: null});
    }
  });
  test('corrupt PCM block/header sizes reject', () => {
    const header = valid.slice();
    new DataView(header.buffer).setUint16(32, 6, true);
    expect(validateCandidate(header, {mimeType: 'audio/wav'}).reason).toBe('corrupt-pcm');
    expect(validateCandidate(new Uint8Array([1]), {mimeType: 'audio/pcm', format: pcmFormat}).reason).toBe('corrupt-pcm');
    const badMagic = valid.slice(); badMagic[8] = 0;
    expect(validateCandidate(badMagic, {mimeType: 'audio/wav'}).reason).toBe('corrupt-wav');
  });
  test('truncation, extra bytes, impossible chunk lengths and duplicate chunks reject', () => {
    expect(validateCandidate(valid.subarray(0, valid.length - 4), {mimeType: 'audio/wav'}).reason).toBe('truncated-or-corrupt-wav');
    const appended = new Uint8Array(valid.length + 4); appended.set(valid);
    expect(validateCandidate(appended, {mimeType: 'audio/wav'}).accepted).toBe(false);
    const oversized = valid.slice(); new DataView(oversized.buffer).setUint32(40, 0xffffffff, true);
    expect(validateCandidate(oversized, {mimeType: 'audio/wav'}).accepted).toBe(false);
    const duplicated = new Uint8Array(valid.length + 24); duplicated.set(valid); duplicated.set(valid.subarray(12, 36), valid.length);
    new DataView(duplicated.buffer).setUint32(4, duplicated.length - 8, true);
    expect(validateCandidate(duplicated, {mimeType: 'audio/wav'}).reason).toBe('corrupt-wav');
  });
  test('wrong sample rate and channel count reject without resampling', () => {
    const rate = valid.slice(); const rv = new DataView(rate.buffer);
    rv.setUint32(24, 44100, true); rv.setUint32(28, 44100 * 4, true);
    expect(validateCandidate(rate, {mimeType: 'audio/wav'}).reason).toBe('requires-48000hz-stereo');
    const mono = valid.slice(); const mv = new DataView(mono.buffer);
    mv.setUint16(22, 1, true); mv.setUint16(32, 2, true); mv.setUint32(28, 48000 * 2, true);
    expect(validateCandidate(mono, {mimeType: 'audio/wav'}).reason).toBe('requires-48000hz-stereo');
  });
  test('59.5 and 60.5 second usable arrangements reject rather than trim or pad', () => {
    const pcm = readPcmWav(valid).pcmBytes;
    expect(validateCandidate(pcm16ToWav(pcm.subarray(0, pcm.length - 96000)), {mimeType: 'audio/wav'}).reason).toBe('duration-must-be-exactly-60-seconds');
    const longer = new Uint8Array(pcm.length + 96000); longer.set(pcm);
    expect(validateCandidate(pcm16ToWav(longer), {mimeType: 'audio/wav'}).reason).toBe('duration-must-be-exactly-60-seconds');
  });
  test('delay by two video frames rejects with actual measured drift', () => {
    const result = validateCandidate(shifted(3200), {mimeType: 'audio/wav'});
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('downbeat-drift-exceeds-one-frame');
    expect(result.measurements.timing.maxAbsDriftFrames).toBeGreaterThan(1);
    expect(result.measurements.timing.downbeats[4].driftFrames).toBeCloseTo(2, 1);
  });
  test('advance by two video frames also rejects', () => {
    const result = validateCandidate(shifted(-3200), {mimeType: 'audio/wav'});
    expect(result.accepted).toBe(false);
    expect(result.measurements.timing.maxAbsDriftFrames).toBeGreaterThan(1);
    expect(result.measurements.timing.downbeats[4].driftFrames).toBeCloseTo(-2, 1);
  });
  test('sub-frame delay and advance pass the same measured gate', () => {
    for (const samples of [800, -800]) {
      const result = validateCandidate(shifted(samples), {mimeType: 'audio/wav'});
      expect(result.accepted).toBe(true);
      expect(result.measurements.timing.maxAbsDriftFrames).toBeLessThanOrEqual(1);
      expect(Math.abs(result.measurements.timing.downbeats[4].driftFrames)).toBeCloseTo(0.5, 1);
    }
  });
  test('one off-grid downbeat is not averaged away', () => {
    const pcm = readPcmWav(valid).pcmBytes.slice();
    const start = 10 * 96000 * 4;
    const bar = pcm.slice(start, start + 96000 * 4);
    pcm.fill(0, start, start + bar.length);
    pcm.set(bar.subarray(0, bar.length - 3200 * 4), start + 3200 * 4);
    const result = validateCandidate(pcm16ToWav(pcm), {mimeType: 'audio/wav'});
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('downbeat-drift-exceeds-one-frame');
    expect(result.measurements.timing.downbeats[10].driftFrames).toBeGreaterThan(1);
  });
  test('silence and near-constant DC content reject', () => {
    const silent = new Uint8Array(AUDIO_GRID.samplesPerChannel * 4);
    expect(validateCandidate(pcm16ToWav(silent), {mimeType: 'audio/wav'}).reason).toBe('unusable-silence');
    const constant = new Int16Array(AUDIO_GRID.samplesPerChannel * 2).fill(16384);
    expect(validateCandidate(pcm16ToWav(new Uint8Array(constant.buffer)), {mimeType: 'audio/wav'}).reason).toBe('unusable-near-constant');
  });
  test('clipped content rejects with a measured clipping fraction', () => {
    const pcm = readPcmWav(valid).pcmBytes.slice(); const view = new DataView(pcm.buffer);
    for (let i = 0; i < 30000; i++) view.setInt16(i * 2, i % 2 ? 32767 : -32768, true);
    const result = validateCandidate(pcm16ToWav(pcm), {mimeType: 'audio/wav'});
    expect(result.reason).toBe('unusable-clipping');
    expect(result.measurements.clippedFraction).toBeGreaterThan(0.001);
  });
  test('missing energy onset rejects rather than claiming timing', () => {
    const pcm = readPcmWav(valid).pcmBytes.slice();
    pcm.fill(0, (10 * 96000 - 9600) * 4, (10 * 96000 + 9600) * 4);
    const result = validateCandidate(pcm16ToWav(pcm), {mimeType: 'audio/wav'});
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('missing-downbeat-onset');
    expect(result.measurements.timing.downbeats[10].detectedSample).toBeNull();
  });
});

describe('auditable atomic sink and cache-first selection', () => {
  test('complete accepted cache has original bytes, decoded WAV/PCM, rights, usage and caller timestamp', async () => {
    expect((await readdir(frozen)).sort()).toEqual(['decoded.wav', 'metadata.json', 'source.wav']);
    const metadata = JSON.parse(await readFile(join(frozen, 'metadata.json'), 'utf8'));
    expect(metadata.prompt).toBe(MUSIC_PROMPT);
    expect(metadata.model).toBe('synthetic/provider-fixture');
    expect(metadata.rights).toEqual(rights);
    expect(metadata.createdAt).toBe(createdAt);
    expect(metadata.usage).toEqual({total_tokens: 4, cost: 0});
    expect(metadata.requestMeta).toEqual({attempts: 1, rightsApproved: true});
    expect(JSON.stringify(metadata)).not.toContain('never-copy-this');
    expect(sha256(await readFile(join(frozen, 'source.wav')))).toBe(metadata.sha256.source);
    expect(sha256(await readFile(join(frozen, 'decoded.wav')))).toBe(metadata.sha256.decodedWav);
    expect(sha256(readPcmWav(valid).pcmBytes)).toBe(metadata.sha256.decodedPcm);
    const selected = await choose(frozen);
    expect(selected.source).toBe('provider-cache');
    expect(selected.path).toBe(join(frozen, 'decoded.wav'));
    expect(selected.sha256).toBe(sha256(valid));
    expect(selected.networkRequests).toBe(0);
    expect(selected.measurements.timing.downbeats).toHaveLength(30);
  });
  test('raw PCM source accepted only with explicit PCM16 format and full audit', async () => {
    const path = join(workspace, 'raw');
    expect(await acceptCandidate(candidate(path, {bytes: readPcmWav(valid).pcmBytes, mimeType: 'audio/pcm', pcmFormat}))).toEqual({accepted: true, reason: 'validated and frozen'});
    expect((await readdir(path)).sort()).toEqual(['decoded.wav', 'metadata.json', 'source.pcm']);
    expect((await choose(path)).source).toBe('provider-cache');
  });
  test('already frozen cache is not replaced or mutated', async () => {
    const original = await readFile(join(frozen, 'metadata.json'), 'utf8');
    const result = await acceptCandidate(candidate(frozen, {model: 'another/fixture'}));
    expect(result).toEqual({accepted: false, reason: 'cache-already-frozen'});
    expect(await readFile(join(frozen, 'metadata.json'), 'utf8')).toBe(original);
    expect((await choose(frozen)).source).toBe('provider-cache');
    expect((await readdir(workspace)).filter((name) => name.includes('.stage-') || name.includes('.rejection-stage-'))).toEqual([]);
  });
  test('missing rights or caller-createdAt rejects otherwise-valid candidate', async () => {
    for (const patch of [{rights: null}, {createdAt: undefined}, {createdAt: 'invalid'}]) {
      const path = join(workspace, `missing-audit-${Object.keys(patch)[0]}-${String(patch.createdAt ?? 'none')}`);
      expect((await acceptCandidate(candidate(path, patch))).reason).toBe('missing-audit-metadata');
      expect((await choose(path)).reason).toBe('provider candidate rejected: missing-audit-metadata');
    }
  });
  test('MP3 needs-decoder rejection is recorded and selects fallback', async () => {
    const path = join(workspace, 'mp3');
    expect(await acceptCandidate(candidate(path, {bytes: new Uint8Array([0xff, 0xfb, 0, 0]), mimeType: 'audio/mpeg'}))).toEqual({accepted: false, reason: 'needs-decoder'});
    const record = JSON.parse(await readFile(`${path}.rejection.json`, 'utf8'));
    expect(record.status).toBe('rejected'); expect(record.reason).toBe('needs-decoder');
    const result = await choose(path);
    expect(result.source).toBe('js-fallback'); expect(result.reason).toBe('provider candidate rejected: needs-decoder');
    expect(result.networkRequests).toBe(0);
  });
  test('sink records drift rejection measurements for fallback review', async () => {
    const path = join(workspace, 'drift-rejection');
    expect((await acceptCandidate(candidate(path, {bytes: shifted(3200)}))).reason).toBe('downbeat-drift-exceeds-one-frame');
    const result = await choose(path);
    expect(result.source).toBe('js-fallback');
    expect(result.providerMeasurements.timing.maxAbsDriftFrames).toBeGreaterThan(1);
  });
  test('missing cache uses the frozen fallback with explicit reason and matching seed hash', async () => {
    const result = await choose(join(workspace, 'never-existed'));
    const metadata = JSON.parse(await readFile(join(DEFAULT_FALLBACK_DIR, 'fallback.meta.json'), 'utf8'));
    expect(result.source).toBe('js-fallback'); expect(result.reason).toBe('no accepted provider cache');
    expect(result.sha256).toBe(metadata.sha256); expect(result.networkRequests).toBe(0);
  });
  test('hash-invalid source selects fallback', async () => {
    const path = await copyCache('bad-source-hash');
    const bytes = await readFile(join(path, 'source.wav')); bytes[100] ^= 1;
    await writeFile(join(path, 'source.wav'), bytes);
    const result = await choose(path);
    expect(result.source).toBe('js-fallback'); expect(result.reason).toBe('provider cache hash mismatch');
  });
  test('hash-invalid decoded WAV and decoded PCM select fallback', async () => {
    const path = await copyCache('bad-decoded-hash');
    await rewriteMetadata(path, (metadata) => { metadata.sha256.decodedWav = '0'.repeat(64); });
    expect((await choose(path)).reason).toBe('provider cache hash mismatch');
    await rewriteMetadata(path, (metadata) => { metadata.sha256.decodedWav = sha256(valid); metadata.sha256.decodedPcm = '0'.repeat(64); });
    expect((await choose(path)).reason).toBe('provider cache PCM hash mismatch');
  });
  test('trusted manifest pins reject self-consistent but unexpected cache hashes', async () => {
    const metadata = JSON.parse(await readFile(join(frozen, 'metadata.json'), 'utf8'));
    expect((await choose(frozen, {hashes: {provider: metadata.sha256}})).source).toBe('provider-cache');
    expect((await choose(frozen, {hashes: {provider: {source: '0'.repeat(64)}}})).reason).toBe('provider cache hash mismatch');
  });
  test('corrupt/truncated PCM rejects even when its file hash has been updated', async () => {
    const path = await copyCache('corrupt-pcm');
    const bytes = valid.slice(); new DataView(bytes.buffer).setUint16(32, 6, true);
    await writeFile(join(path, 'decoded.wav'), bytes);
    await rewriteMetadata(path, (metadata) => { metadata.sha256.decodedWav = sha256(bytes); });
    expect((await choose(path)).reason).toBe('provider cache rejected: corrupt-pcm');
    const truncated = valid.subarray(0, valid.length - 100);
    await writeFile(join(path, 'decoded.wav'), truncated);
    await rewriteMetadata(path, (metadata) => { metadata.sha256.decodedWav = sha256(truncated); });
    expect((await choose(path)).reason).toBe('provider cache rejected: truncated-or-corrupt-wav');
  });
  test('wrong-length decoded arrangement selects fallback with named validation reason', async () => {
    const path = await copyCache('wrong-duration');
    const bytes = pcm16ToWav(readPcmWav(valid).pcmBytes.subarray(0, 48000 * 4));
    await writeFile(join(path, 'decoded.wav'), bytes);
    await rewriteMetadata(path, (metadata) => { metadata.sha256.decodedWav = sha256(bytes); });
    expect((await choose(path)).reason).toBe('provider cache rejected: duration-must-be-exactly-60-seconds');
  });
  test('invalid metadata, rejected metadata, and missing decoded files select fallback', async () => {
    const path = await copyCache('invalid-metadata');
    await writeFile(join(path, 'metadata.json'), '{not json');
    expect((await choose(path)).reason).toBe('provider cache metadata missing or invalid');
    await writeFile(join(path, 'metadata.json'), JSON.stringify({status: 'rejected'}));
    expect((await choose(path)).source).toBe('js-fallback');
    const missing = await copyCache('missing-decoded');
    await rm(join(missing, 'decoded.wav'));
    expect((await choose(missing)).reason).toBe('provider cache files missing or corrupt');
  });
  test('fallback itself is hash-verified and never silently accepts modified bytes', async () => {
    const path = join(workspace, 'fallback-copy');
    await cp(DEFAULT_FALLBACK_DIR, path, {recursive: true});
    const wav = await readFile(join(path, 'fallback.wav')); wav[100] ^= 1;
    await writeFile(join(path, 'fallback.wav'), wav);
    await expect(choose(join(workspace, 'missing-for-fallback'), {fallbackDir: path})).rejects.toThrow('Frozen fallback hash mismatch');
    await expect(choose(join(workspace, 'missing-for-pin'), {hashes: {fallback: '0'.repeat(64)}})).rejects.toThrow('Frozen fallback hash mismatch');
  });
  test('delete ONLY a temporary accepted cache copy; rerun selects fallback without transport/fetch/WebSocket', async () => {
    const path = await copyCache('delete-temp-only');
    let requests = 0;
    const transport = () => { requests++; throw Error('provider forbidden'); };
    const originalFetch = globalThis.fetch;
    const originalSocket = globalThis.WebSocket;
    globalThis.fetch = transport; globalThis.WebSocket = class { constructor() { transport(); } };
    try {
      expect((await choose(path, {transport})).source).toBe('provider-cache');
      await rm(path, {recursive: true});
      const result = await choose(path, {transport});
      expect(result.source).toBe('js-fallback'); expect(result.networkRequests).toBe(0);
      expect(requests).toBe(0);
      expect((await readdir(frozen)).sort()).toEqual(['decoded.wav', 'metadata.json', 'source.wav']);
    } finally { globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; }
  });
});

describe('render-import isolation and frozen report', () => {
  test('selector/validation dependency graph imports nothing from src/music or network/model modules', async () => {
    const visited = new Set();
    const walk = async (path) => {
      if (visited.has(path)) return;
      visited.add(path);
      const source = await readFile(path, 'utf8');
      expect(source).not.toMatch(/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/);
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        expect(specifier).not.toMatch(/music|openrouter|https?:|node:(?:https?|net|tls)|model|child_process/);
        if (specifier.startsWith('.')) await walk(resolve(dirname(path), specifier));
      }
    };
    await walk(fileURLToPath(new URL('../src/audio/cache.js', import.meta.url)));
    await walk(fileURLToPath(new URL('../src/audio/select-audio.js', import.meta.url)));
    expect(visited.size).toBeGreaterThanOrEqual(3);
  });
  test('dynamic module imports and validation use zero requests under throwing globals', async () => {
    const fetch = globalThis.fetch; const socket = globalThis.WebSocket;
    let requests = 0;
    const forbidden = () => { requests++; throw Error('network forbidden'); };
    globalThis.fetch = forbidden; globalThis.WebSocket = class { constructor() { forbidden(); } };
    try {
      const validator = await import('../src/audio/cache.js?guard=165');
      const selector = await import('../src/audio/select-audio.js?guard=165');
      expect(validator.validateCandidate(valid, {mimeType: 'audio/wav'}).accepted).toBe(true);
      expect((await selector.selectAudio({cacheDir: frozen, fallbackDir: DEFAULT_FALLBACK_DIR})).source).toBe('provider-cache');
      expect(requests).toBe(0);
    } finally { globalThis.fetch = fetch; globalThis.WebSocket = socket; }
  });
  test('explicit freeze and later validation preserve manifest and write sample/timing QA', async () => {
    const manifestPath = join(workspace, 'audio-manifest.json'); const qaPath = join(workspace, 'audio-cache.json');
    const options = {cacheDir: join(workspace, 'freeze-missing'), fallbackDir: DEFAULT_FALLBACK_DIR, manifestPath, qaPath};
    await runAudioCacheValidation({...options, freeze: true});
    const original = await readFile(manifestPath, 'utf8');
    const report = await runAudioCacheValidation(options);
    expect(report.networkRequests).toBe(0); expect(report.source).toBe('js-fallback');
    expect(report.manifestHashMatches).toBe(true);
    expect(report.sampleValidation.samplesPerChannel).toBe(2880000);
    expect(report.measurements.timing.downbeats).toHaveLength(30);
    expect(await readFile(manifestPath, 'utf8')).toBe(original);
    expect(JSON.parse(await readFile(qaPath, 'utf8')).status).toBe('pass');
  });
  test('a frozen provider manifest still allows verified fallback after cache damage', async () => {
    const cacheDir = join(workspace, 'manifest-provider');
    expect((await acceptCandidate(candidate(cacheDir, {bytes: shifted(800)}))).accepted).toBe(true);
    const manifestPath = join(workspace, 'provider-manifest.json');
    const qaPath = join(workspace, 'provider-fallback-qa.json');
    const options = {cacheDir, fallbackDir: DEFAULT_FALLBACK_DIR, manifestPath, qaPath};
    expect((await runAudioCacheValidation({...options, freeze: true})).source).toBe('provider-cache');
    expect((await runAudioCacheValidation(options)).manifestHashMatches).toBe(true);
    const frozenManifest = await readFile(manifestPath, 'utf8');
    await rm(join(cacheDir, 'decoded.wav'));
    const report = await runAudioCacheValidation(options);
    expect(report.status).toBe('pass'); expect(report.source).toBe('js-fallback');
    expect(report.reason).toBe('provider cache files missing or corrupt');
    expect(report.networkRequests).toBe(0); expect(report.hashesMatch).toBe(true);
    expect(report.manifestHashMatches).toBe(false);
    expect(await readFile(manifestPath, 'utf8')).toBe(frozenManifest);
  });
  test('real CLI with no API key and throwing fetch/WebSocket guard reports zero attempts', async () => {
    const guard = join(workspace, 'guard.js');
    await writeFile(guard, 'let calls=0;const fail=()=>{calls++;throw Error("network forbidden")};globalThis.fetch=fail;globalThis.WebSocket=class{constructor(){fail()}};process.on("exit",()=>console.log(`guardNetworkRequests=${calls}`));\n');
    const env = {...process.env}; delete env.OPENROUTER_API_KEY;
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const child = Bun.spawn([process.execPath, '--preload', guard, 'apps/video/scripts/validate-audio-cache.js', '--qa', join(workspace, 'cli-qa.json')], {cwd: root, env, stdout: 'pipe', stderr: 'pipe'});
    const output = await new Response(child.stdout).text(); const error = await new Response(child.stderr).text();
    expect(await child.exited).toBe(0); expect(error).toBe('');
    expect(output).toContain('networkRequests=0'); expect(output).toContain('guardNetworkRequests=0');
    expect(output).toContain('selected source=js-fallback'); expect(output).toContain('matchingHashes=true');
  });
});
