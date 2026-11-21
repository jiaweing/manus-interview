import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Authoring-only: runtime/render source must never import this module.
export const MODEL_ID = 'anthropic/claude-opus-5.5';
export const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const TIMEOUT_MS = 120_000;
export const MAX_TOKENS = 768;
const PRODUCT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// Review-only specimen, not an accepted patch or a live product implementation.
// Its locked intro interval/caption come from the PRD beat table.
const LOCKED_SCENE = Object.freeze({
  id: 'intro', startBar: 0, bars: 3, fromFrame: 0, toFrame: 180,
  fps: 30, bpm: 120, framesPerBeat: 15, seed: 7,
  caption: 'Six ideas. One build session.',
  captionMinSize: 48, captionHoldFrames: 60,
});
const SPECIMEN = 'export function entranceProgress(frame) {\n  return frame / 30;\n}\n';

export function createPatchRequest() {
  return {
    model: MODEL_ID,
    max_tokens: MAX_TOKENS,
    stream: false,
    messages: [
      {
        role: 'system',
        content: 'Author one scoped JavaScript patch only. Preserve the locked scene record. No network, timers, wall clock, random sources, dependencies, other files, or changed captions/timing. Return a unified diff only. This is an access-check specimen for human review, not an automatically accepted patch.',
      },
      {
        role: 'user',
        content: `Locked intro scene record: ${JSON.stringify(LOCKED_SCENE)}\nReview-only file: authoring/access-check-scene.js\nExisting JavaScript:\n${SPECIMEN}\nPatch only entranceProgress(frame) so its entrance reaches 1 at local frame 30, clamps to [0,1] before/after the entrance, and remains deterministic. Do not modify the record or create render code. This scoped helper is for the 180-frame intro scene.`,
      },
    ],
  };
}

// Deliberately small dotenv subset: KEY=value, export, quoted values, comments.
// No expansion, execution, logging, or dependencies. Existing environment wins.
export function parseEnv(text) {
  const values = Object.create(null);
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      const end = value.indexOf(value[0], 1);
      if (end < 0) continue;
      value = value.slice(1, end);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[match[1]] = value;
  }
  return values;
}

export async function loadApiKey(productRoot, environment) {
  let values = {};
  try {
    values = parseEnv(await readFile(path.join(productRoot, '.env'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot read product .env');
  }
  return (environment.OPENROUTER_API_KEY || values.OPENROUTER_API_KEY || '').trim();
}

// Redact the exact credential, common credential forms, and encoded echoes.
// Apply to the final serialization as well as error/response text and fields.
export function sanitize(text, apiKey = '') {
  let clean = String(text);
  if (apiKey) {
    for (const secret of new Set([apiKey, encodeURIComponent(apiKey), JSON.stringify(apiKey).slice(1, -1)])) {
      clean = clean.split(secret).join('[REDACTED]');
    }
  }
  return clean
    .replace(/Bearer\s+[^\s"'<>\\]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, '[REDACTED]');
}

function sanitizeValue(value, apiKey) {
  if (typeof value === 'string') return sanitize(value, apiKey);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, apiKey));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [sanitize(key, apiKey), sanitizeValue(item, apiKey)]));
  }
  return value;
}

async function requestJson(fetchImpl, url, options, deadline) {
  const response = await fetchImpl(url, {
    ...options, redirect: 'error', signal: deadline(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 4096)}`);
  }
  const data = await response.json();
  if (data.error) throw new Error(`OpenRouter error: ${JSON.stringify(data.error)}`);
  return data;
}

export async function verifyModel({
  fetchImpl = globalThis.fetch,
  apiKey = '',
  preflightError = null,
  now = () => new Date().toISOString(),
  deadline = (ms) => AbortSignal.timeout(ms),
} = {}) {
  const record = {
    status: 'blocked', modelId: MODEL_ID, requestRef: null, generationId: null,
    catalog: { listed: false, checkedAt: null, evidenceUrl: CATALOG_URL, evidence: null },
    usage: null,
    timestamps: { startedAt: now(), requestStartedAt: null, responseReceivedAt: null, completedAt: null },
    chatRequests: 0, error: null,
  };
  const errors = preflightError ? [preflightError] : [];
  let patch = null;
  // Catalog check is public and always precedes credential preflight.
  record.catalog.checkedAt = now();
  try {
    const catalog = await requestJson(fetchImpl, CATALOG_URL, {
      method: 'GET', headers: { Accept: 'application/json' },
    }, deadline);
    if (!Array.isArray(catalog.data)) throw new Error('Malformed catalog: data must be an array');
    const entry = catalog.data.find((model) => model.id === MODEL_ID);
    record.catalog.listed = Boolean(entry);
    if (entry) {
      // Preserve the returned pricing keys/values and supported parameters verbatim.
      record.catalog.evidence = {
        id: entry.id, context_length: entry.context_length ?? null,
        supported_parameters: entry.supported_parameters ?? null,
        pricing: entry.pricing ?? null,
      };
    } else {
      errors.push(`catalog mismatch: ${MODEL_ID} is not listed`);
    }
  } catch (error) {
    errors.push(`catalog check failed: ${error.message}`);
    record.catalog.error = errors[errors.length - 1];
  }
  if (!apiKey) errors.unshift('no OPENROUTER_API_KEY');

  if (errors.length === 0) {
    const body = JSON.stringify(createPatchRequest());
    record.requestRef = `sha256:${createHash('sha256').update(body).digest('hex')}`;
    record.timestamps.requestStartedAt = now();
    try {
      record.chatRequests = 1;
      // Exactly one attempt, fixed provider endpoint/model, no substitute/retry.
      const response = await requestJson(fetchImpl, CHAT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
      }, deadline);
      record.timestamps.responseReceivedAt = now();
      record.generationId = typeof response.id === 'string' ? response.id : null;
      record.usage = response.usage ?? null;
      record.responseModel = response.model ?? null;
      record.responseCreated = response.created ?? null;
      record.finishReason = response.choices?.[0]?.finish_reason ?? null;
      if (response.model !== MODEL_ID) throw new Error(`response model mismatch: ${response.model ?? 'missing'}`);
      if (!record.generationId) throw new Error('Malformed completion: missing generation id');
      const content = response.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('Malformed completion: missing patch text');
      if (record.finishReason !== 'stop') throw new Error(`Incomplete patch: finish_reason=${record.finishReason}`);
      if (!response.usage || typeof response.usage !== 'object') throw new Error('Malformed completion: missing usage');
      patch = content;
      record.status = 'verified';
    } catch (error) {
      errors.push(`scoped patch request failed: ${error.message}`);
    }
  }
  record.timestamps.completedAt = now();
  record.error = errors.length ? errors.join('; ') : null;
  const safeRecord = sanitizeValue(record, apiKey);
  const output = sanitize([
    `${safeRecord.status.toUpperCase()} authoring model: ${MODEL_ID}`,
    `catalog.listed=${safeRecord.catalog.listed}`,
    `catalog.checkedAt=${safeRecord.catalog.checkedAt}`,
    `catalog.evidenceUrl=${CATALOG_URL}`,
    `chatRequests=${safeRecord.chatRequests}`,
    `error=${safeRecord.error ?? 'none'}`,
    '', JSON.stringify(safeRecord, null, 2),
    ...(patch ? ['', 'Scoped patch output (UNREVIEWED; not applied or accepted):', patch] : []),
    '',
  ].join('\n'), apiKey);
  return { record: safeRecord, output, exitCode: safeRecord.status === 'verified' ? 0 : 2 };
}

export async function runVerifier({ productRoot = PRODUCT_ROOT, environment = process.env, ...options } = {}) {
  let apiKey = '';
  let envError = null;
  try {
    apiKey = await loadApiKey(productRoot, environment);
  } catch (error) {
    envError = error.message;
  }
  const result = await verifyModel({ ...options, apiKey, preflightError: envError });
  await mkdir(path.join(productRoot, 'authoring'), { recursive: true });
  await mkdir(path.join(productRoot, 'qa'), { recursive: true });
  await writeFile(path.join(productRoot, 'authoring/model-record.json'), `${JSON.stringify(result.record, null, 2)}\n`);
  await writeFile(path.join(productRoot, 'qa/authoring-model.txt'), result.output);
  const blocker = path.join(productRoot, 'qa/authoring-blocker.txt');
  if (result.exitCode === 2) await writeFile(blocker, result.output);
  else await rm(blocker, { force: true });
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runVerifier();
    console.log(result.output.trimEnd());
    process.exitCode = result.exitCode;
  } catch {
    // Filesystem failures must not expose credentials via stack/context output.
    console.error('BLOCKED authoring verifier: unable to persist sanitized QA evidence');
    process.exitCode = 2;
  }
}
