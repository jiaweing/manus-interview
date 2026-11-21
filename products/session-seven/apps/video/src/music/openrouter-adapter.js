import {ALLOWED_MODELS, MUSIC_PROMPT, musicContract} from './contract.js';

export const REQUEST_TIMEOUT_MS = 120000;
export const MAX_ATTEMPTS = 2;
const MAX_RESPONSE_CHARS = 32 * 1024 * 1024;
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Defense in depth for script/sink errors. Provider error text is never surfaced. */
export function redact(text, secrets = []) {
  let result = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length) result = result.split(secret).join('[REDACTED]');
  }
  return result
    .replace(/\bBearer\s+[^\s,;"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-(?:or-)?[a-z0-9_-]+/gi, '[REDACTED]')
    .replace(/((?:OPENROUTER_API_KEY|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

/**
 * Pure preflight. hasKey is a boolean, not a credential. The second argument is a
 * trusted dependency for fixture tests, never read from the JSON approval file.
 * Production cannot self-validate by changing contractValidated in that file.
 */
export function planMusicRequest(config = {}, contract = musicContract) {
  if (config.hasKey !== true) return {action: 'skip', reason: 'no-key'};
  if (config.contractValidated !== true || contract.validated !== true ||
      config.accessApproved !== true || config.model !== contract.model ||
      !ALLOWED_MODELS.includes(config.model) || contract.endpoint !== ENDPOINT ||
      contract.method !== 'POST' || !contract.audio ||
      typeof contract.mimeType !== 'string' || !contract.mimeType.startsWith('audio/') ||
      contract.costCeilingValidated !== true || !contract.docs?.length) {
    return {action: 'skip', reason: 'unvalidated-contract'};
  }
  if (config.rightsApproved !== true) return {action: 'skip', reason: 'missing-rights'};
  if (typeof config.budgetUsd !== 'number' || !Number.isFinite(config.budgetUsd) || config.budgetUsd <= 0) {
    return {action: 'skip', reason: 'missing-budget'};
  }
  // Reserve half the TOTAL approved ceiling for EACH attempt, including an
  // interrupted/failed first request: unknown billing never earns a refund.
  const perAttemptBudgetUsd = config.budgetUsd / MAX_ATTEMPTS;
  if (perAttemptBudgetUsd <= 0) return {action: 'skip', reason: 'missing-budget'};
  return {
    action: 'request', endpoint: ENDPOINT, method: 'POST', model: config.model,
    prompt: MUSIC_PROMPT, mimeType: contract.mimeType,
    budgetUsd: config.budgetUsd, perAttemptBudgetUsd,
    timeoutMs: REQUEST_TIMEOUT_MS, maxAttempts: MAX_ATTEMPTS,
    sources: [...contract.docs],
    body: {
      model: config.model,
      messages: [{role: 'user', content: MUSIC_PROMPT}],
      modalities: ['text', 'audio'],
      audio: {...contract.audio},
      stream: true,
      provider: {
        allow_fallbacks: false,
        require_parameters: true,
        max_price: {request: perAttemptBudgetUsd, prompt: 0, completion: 0},
      },
    },
  };
}

function fail(reason) {
  const error = new Error(reason);
  error.fallbackReason = reason;
  return error;
}

function statusReason(status) {
  if ([401, 402, 403].includes(status)) return 'denied-access';
  if ([400, 404, 405, 415, 422, 501].includes(status)) return 'unsupported-generation';
  if (status === 429 || status >= 500) return 'provider-unavailable';
  return 'malformed-response';
}

function safeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const usage = {};
  for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost']) {
    if (typeof value[field] === 'number' && Number.isFinite(value[field]) && value[field] >= 0) usage[field] = value[field];
  }
  return Object.keys(usage).length ? usage : null;
}

async function readAudio(response, signal, key) {
  if (!response || typeof response.ok !== 'boolean') throw fail('malformed-response');
  if (!response.ok) throw fail(statusReason(response.status)); // Never read/log error bodies.
  if (!response.headers?.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
    throw fail('unsupported-generation');
  }
  if (!response.body?.getReader) throw fail('malformed-response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let buffer = '';
  let eventData = [];
  let finished = false;
  let responseChars = 0;
  let audioBase64 = '';
  let usage = null;

  const consumeEvent = () => {
    if (!eventData.length) return;
    const data = eventData.join('\n').trim();
    eventData = [];
    if (data === '[DONE]') { finished = true; return; }
    let chunk;
    try { chunk = JSON.parse(data); } catch { throw fail('malformed-response'); }
    if (!chunk || typeof chunk !== 'object') throw fail('malformed-response');
    if (chunk.error) throw fail(statusReason(Number(chunk.error.code)));
    if (chunk.usage) usage = safeUsage(chunk.usage);
    const audio = chunk.choices?.[0]?.delta?.audio;
    if (audio?.data !== undefined) {
      if (typeof audio.data !== 'string') throw fail('malformed-response');
      audioBase64 += audio.data;
    }
  };
  const consumeLine = (line) => {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) { consumeEvent(); return; }
    if (line.startsWith('data:')) eventData.push(line.slice(5).replace(/^ /, ''));
    // Comments and SSE event/id/retry fields are not audio or metadata.
  };
  const cancel = () => { Promise.resolve(reader.cancel()).catch(() => {}); };
  signal.addEventListener('abort', cancel, {once: true});
  try {
    while (!finished) {
      if (signal.aborted) throw fail('timeout');
      const {done, value} = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer) consumeLine(buffer);
        consumeEvent();
        break;
      }
      const text = decoder.decode(value, {stream: true});
      responseChars += text.length;
      if (responseChars > MAX_RESPONSE_CHARS) throw fail('malformed-response');
      buffer += text;
      let newline;
      while (!finished && (newline = buffer.indexOf('\n')) >= 0) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    if (!finished || !audioBase64 || audioBase64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64)) throw fail('malformed-response');
    const bytes = new Uint8Array(Buffer.from(audioBase64, 'base64'));
    if (!bytes.length || Buffer.from(bytes).toString('base64') !== audioBase64) throw fail('malformed-response');
    // Even malicious fixtures/provider echoes cannot put the credential in assets.
    if (key && Buffer.from(bytes).includes(Buffer.from(key))) throw fail('malformed-response');
    return {bytes, usage};
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

/** No module-level env, fetch, timers, or logging. All effects enter explicitly. */
export async function generateMusic({env = {}, config = {}, transport, clock, contract = musicContract, sleep} = {}) {
  let attempts = 0;
  try {
    const key = typeof env.OPENROUTER_API_KEY === 'string' ? env.OPENROUTER_API_KEY.trim() : '';
    const plan = planMusicRequest({...config, hasKey: Boolean(key)}, contract);
    if (plan.action === 'skip') return {status: 'fallback', reason: plan.reason, attempts};
    if (typeof transport !== 'function' || typeof clock?.setTimeout !== 'function' ||
        typeof clock?.clearTimeout !== 'function') return {status: 'fallback', reason: 'invalid-dependencies', attempts};
    // The script injects sleep; fake-clock tests need not wait in real time.
    const pause = sleep ?? clock.sleep;
    while (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      const controller = new AbortController();
      let timer;
      let timedOut = false;
      try {
        const deadline = new Promise((_, reject) => {
          timer = clock.setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(fail('timeout'));
          }, REQUEST_TIMEOUT_MS);
        });
        // Promise.race also bounds a fetch-like transport that ignores AbortSignal.
        const candidate = await Promise.race([
          Promise.resolve().then(async () => {
            if (controller.signal.aborted) throw fail('timeout');
            const response = await transport(plan.endpoint, {
              method: plan.method,
              headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
              body: JSON.stringify(plan.body), signal: controller.signal,
            });
            return readAudio(response, controller.signal, key);
          }),
          deadline,
        ]);
        if (candidate.usage?.cost > plan.perAttemptBudgetUsd) throw fail('budget-exceeded');
        return {
          status: 'candidate', bytes: candidate.bytes, mimeType: plan.mimeType,
          model: plan.model, prompt: plan.prompt, usage: candidate.usage,
          attempts,
          requestMeta: {
            attempts, timeoutMs: REQUEST_TIMEOUT_MS, maxAttempts: MAX_ATTEMPTS,
            approvedBudgetUsd: plan.budgetUsd, perAttemptBudgetUsd: plan.perAttemptBudgetUsd,
            reservedCostUsd: attempts * plan.perAttemptBudgetUsd,
            accessApproved: true, rightsApproved: true, contractValidated: true,
            sources: plan.sources,
          },
        };
      } catch (error) {
        // Fixed allowlist: never return provider/transport text, stack, headers or IDs.
        const reason = timedOut ? 'timeout' : [
          'denied-access', 'unsupported-generation', 'provider-unavailable',
          'malformed-response', 'budget-exceeded', 'timeout',
        ].includes(error?.fallbackReason) ? error.fallbackReason : 'transport-error';
        const retryable = ['timeout', 'provider-unavailable', 'transport-error'].includes(reason);
        if (!retryable || attempts >= MAX_ATTEMPTS) return {status: 'fallback', reason, attempts};
      } finally {
        if (timer !== undefined) clock.clearTimeout(timer);
        controller.abort();
      }
      if (typeof pause === 'function') await pause(250);
    }
    return {status: 'fallback', reason: 'provider-unavailable', attempts};
  } catch {
    // Malformed approval/dependency objects and injected clock/sleep errors cannot block callers.
    return {status: 'fallback', reason: 'invalid-configuration', attempts};
  }
}
