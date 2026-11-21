import {mkdir, mkdtemp, writeFile, rename, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {validateCandidate, sha256} from '../audio/cache.js';
import {DEFAULT_CACHE_DIR} from '../audio/select-audio.js';

// No adapter import: this sink is called only by authoring scripts. Render paths
// never import this module. Unknown request fields (headers, credentials, raw
// provider responses) are dropped, not copied into the frozen cache.
function safeText(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 2000)
    .replace(/\bBearer\s+[^\s,;"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-(?:or-)?[a-z0-9_-]+/gi, '[REDACTED]')
    .replace(/((?:OPENROUTER_API_KEY|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function safeRequestMeta(meta = {}) {
  const result = {};
  for (const field of ['attempts', 'timeoutMs', 'maxAttempts', 'approvedBudgetUsd', 'perAttemptBudgetUsd', 'reservedCostUsd']) {
    if (typeof meta[field] === 'number' && Number.isFinite(meta[field]) && meta[field] >= 0) result[field] = meta[field];
  }
  for (const field of ['accessApproved', 'rightsApproved', 'contractValidated']) if (typeof meta[field] === 'boolean') result[field] = meta[field];
  if (Array.isArray(meta.sources)) result.sources = meta.sources.filter((value) => typeof value === 'string' && /^https:\/\//.test(value)).map((value) => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return ''; }
  }).filter(Boolean);
  return result;
}

function safeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const result = {};
  for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost']) {
    if (typeof usage[field] === 'number' && Number.isFinite(usage[field]) && usage[field] >= 0) result[field] = usage[field];
  }
  return result;
}

async function recordRejection(cacheDir, record) {
  let staging;
  try {
    await mkdir(dirname(cacheDir), {recursive: true});
    staging = await mkdtemp(`${cacheDir}.rejection-stage-`);
    const path = join(staging, 'rejection.json');
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
    await rename(path, `${cacheDir}.rejection.json`);
  } catch { /* Still fail closed if the rejection audit cannot be written. */ }
  finally { if (staging) await rm(staging, {recursive: true, force: true}); }
}

/**
 * Sink contract stays {accepted, reason}. Additional caller-provided audit fields
 * may be top-level or inside requestMeta: createdAt, rights {approvedBy,terms,ref},
 * pcmFormat {sampleRate,channels,bitsPerSample,endianness:'little'} for raw PCM16.
 * Compressed audio requires a decoder we deliberately do not have; never ffmpeg.
 * A completed directory is atomically renamed into cacheDir. Existing frozen
 * records are never mutated/replaced; explicitly archive them before fresh audio.
 */
export async function acceptCandidate(candidate = {}) {
  const {bytes, mimeType, model, prompt, usage, requestMeta = {}, cacheDir = DEFAULT_CACHE_DIR} = candidate;
  const format = candidate.pcmFormat ?? requestMeta.pcmFormat;
  const validated = validateCandidate(bytes, {mimeType, format});
  const createdAt = candidate.createdAt ?? requestMeta.createdAt;
  const rightsInput = candidate.rights ?? requestMeta.rights;
  const rights = Object.fromEntries(['approvedBy', 'terms', 'ref'].map((field) => [field, safeText(rightsInput?.[field])]));
  let reason = validated.reason;
  if (validated.accepted && (!safeText(model).trim() || !safeText(prompt).trim() ||
      !Object.values(rights).every((value) => value.trim()) ||
      typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt)))) reason = 'missing-audit-metadata';
  if (!validated.accepted || reason !== 'validated') {
    await recordRejection(cacheDir, {schemaVersion: 1, status: 'rejected', reason,
      createdAt: typeof createdAt === 'string' && Number.isFinite(Date.parse(createdAt)) ? createdAt : null,
      measurements: validated.measurements});
    return {accepted: false, reason};
  }
  const sourceFile = mimeType?.includes('wav') || String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' ? 'source.wav' : 'source.pcm';
  const metadata = {
    schemaVersion: 1, status: 'accepted', sourceFile,
    mimeType: sourceFile.endsWith('.wav') ? 'audio/wav' : 'audio/pcm',
    pcmFormat: {sampleRate: 48000, channels: 2, bitsPerSample: 16, endianness: 'little'},
    prompt: safeText(prompt), model: safeText(model), rights,
    usage: safeUsage(usage), requestMeta: safeRequestMeta(requestMeta), createdAt,
    sha256: {source: sha256(bytes), decodedPcm: sha256(validated.pcmBytes), decodedWav: sha256(validated.decodedWav)},
    measurements: validated.measurements,
  };
  let staging;
  try {
    await mkdir(dirname(cacheDir), {recursive: true});
    staging = await mkdtemp(`${cacheDir}.stage-`);
    await Promise.all([
      writeFile(join(staging, sourceFile), bytes),
      writeFile(join(staging, 'decoded.wav'), validated.decodedWav),
      writeFile(join(staging, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`),
    ]);
    await rename(staging, cacheDir); // Nonempty existing caches cannot be overwritten.
    staging = null;
    await rm(`${cacheDir}.rejection.json`, {force: true});
    return {accepted: true, reason: 'validated and frozen'};
  } catch (error) {
    reason = ['EEXIST', 'ENOTEMPTY'].includes(error.code) ? 'cache-already-frozen' : 'cache-write-failed';
    await recordRejection(cacheDir, {schemaVersion: 1, status: 'rejected', reason, createdAt, measurements: validated.measurements});
    return {accepted: false, reason};
  } finally { if (staging) await rm(staging, {recursive: true, force: true}); }
}
