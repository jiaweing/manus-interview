import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256, validateCandidate} from './cache.js';

export const DEFAULT_FALLBACK_DIR = fileURLToPath(new URL('../../audio/', import.meta.url));
export const DEFAULT_CACHE_DIR = join(DEFAULT_FALLBACK_DIR, 'cache');
const hashPattern = /^[a-f0-9]{64}$/;

export function hasApprovalRecord(metadata) {
  return metadata?.schemaVersion === 1 && metadata.status === 'accepted' &&
    typeof metadata.prompt === 'string' && metadata.prompt.trim().length > 0 &&
    typeof metadata.model === 'string' && metadata.model.trim().length > 0 &&
    ['approvedBy', 'terms', 'ref'].every((field) => typeof metadata.rights?.[field] === 'string' && metadata.rights[field].trim().length > 0) &&
    typeof metadata.createdAt === 'string' && Number.isFinite(Date.parse(metadata.createdAt)) &&
    /^source\.(?:wav|pcm)$/.test(metadata.sourceFile) &&
    ['source', 'decodedPcm', 'decodedWav'].every((field) => hashPattern.test(metadata.sha256?.[field] ?? ''));
}

/**
 * Filesystem-only preparation for render scripts, NOT a browser/audio generator.
 * hashes.provider = {source, decodedPcm, decodedWav}; hashes.fallback = WAV hash.
 * Optional trusted manifest pins supplement mandatory cache/fallback metadata hashes.
 * No transport argument is read or invoked. Invalid fallback throws: never play
 * unaudited bytes when both frozen choices are unavailable or invalid.
 */
export async function selectAudio({cacheDir = DEFAULT_CACHE_DIR, fallbackDir = DEFAULT_FALLBACK_DIR, hashes = {}} = {}) {
  let reason = 'no accepted provider cache';
  let providerMeasurements = null;
  let metadata;
  try {
    metadata = JSON.parse(await readFile(join(cacheDir, 'metadata.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') reason = 'provider cache metadata missing or invalid';
    else {
      try {
        const rejected = JSON.parse(await readFile(`${cacheDir}.rejection.json`, 'utf8'));
        // Only sink-authored fixed reason codes are surfaced, not arbitrary text.
        if (/^[a-z0-9-]{1,80}$/.test(rejected.reason)) reason = `provider candidate rejected: ${rejected.reason}`;
        providerMeasurements = rejected.measurements ?? null;
      } catch { /* A missing rejection record does not change the no-cache reason. */ }
    }
  }
  if (metadata) {
    if (!hasApprovalRecord(metadata)) reason = 'provider cache metadata missing or invalid';
    else {
      try {
        const [source, decoded] = await Promise.all([
          readFile(join(cacheDir, metadata.sourceFile)), readFile(join(cacheDir, 'decoded.wav')),
        ]);
        const sourceHash = sha256(source);
        const decodedWavHash = sha256(decoded);
        const pins = hashes.provider ?? {};
        if (sourceHash !== metadata.sha256.source || decodedWavHash !== metadata.sha256.decodedWav ||
            (pins.source && pins.source !== sourceHash) || (pins.decodedWav && pins.decodedWav !== decodedWavHash)) {
          reason = 'provider cache hash mismatch';
        } else {
          const validation = validateCandidate(decoded, {mimeType: 'audio/wav'});
          providerMeasurements = validation.measurements;
          if (!validation.accepted) reason = `provider cache rejected: ${validation.reason}`;
          else {
            const pcmHash = sha256(validation.pcmBytes);
            if (pcmHash !== metadata.sha256.decodedPcm || (pins.decodedPcm && pins.decodedPcm !== pcmHash)) reason = 'provider cache PCM hash mismatch';
            else {
              // A hash-valid but unrelated source/decoded pair is not an accepted decode.
              const original = validateCandidate(source, {mimeType: metadata.mimeType, format: metadata.pcmFormat});
              if (!original.accepted || sha256(original.pcmBytes) !== pcmHash) reason = 'provider cache source/PCM mismatch';
              else return {source: 'provider-cache', path: join(cacheDir, 'decoded.wav'), sha256: decodedWavHash,
                hashes: {source: sourceHash, decodedPcm: pcmHash, decodedWav: decodedWavHash},
                reason: 'verified accepted provider cache', networkRequests: 0, measurements: validation.measurements};
            }
          }
        }
      } catch { reason = 'provider cache files missing or corrupt'; }
    }
  }
  const fallbackPath = join(fallbackDir, 'fallback.wav');
  const fallbackMetadata = JSON.parse(await readFile(join(fallbackDir, 'fallback.meta.json'), 'utf8'));
  const fallback = await readFile(fallbackPath);
  const hash = sha256(fallback);
  if (!hashPattern.test(fallbackMetadata.sha256 ?? '') || hash !== fallbackMetadata.sha256 ||
      (hashes.fallback && hashes.fallback !== hash)) throw new Error('Frozen fallback hash mismatch');
  const validation = validateCandidate(fallback, {mimeType: 'audio/wav'});
  if (!validation.accepted) throw new Error(`Frozen fallback invalid: ${validation.reason}`);
  if (fallbackMetadata.sampleRate !== 48000 || fallbackMetadata.channels !== 2 ||
      fallbackMetadata.samplesPerChannel !== 2880000 || fallbackMetadata.durationSeconds !== 60 ||
      !Number.isInteger(fallbackMetadata.seed) || typeof fallbackMetadata.promptEquivalent !== 'string') {
    throw new Error('Frozen fallback seed/sample metadata invalid');
  }
  return {source: 'js-fallback', path: fallbackPath, sha256: hash,
    hashes: {fallback: hash, decodedPcm: sha256(validation.pcmBytes)}, reason, networkRequests: 0,
    measurements: validation.measurements, providerMeasurements};
}
