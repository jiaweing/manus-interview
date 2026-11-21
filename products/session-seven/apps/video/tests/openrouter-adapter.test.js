import {describe, expect, test, spyOn} from 'bun:test';
import {readdir, readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ALLOWED_MODELS, MUSIC_PROMPT, musicContract} from '../src/music/contract.js';
import {generateMusic, planMusicRequest, redact, REQUEST_TIMEOUT_MS, MAX_ATTEMPTS} from '../src/music/openrouter-adapter.js';
import {acceptCandidate} from '../src/music/candidate-sink.js';
import {runMusicGeneration} from '../scripts/music-generate.js';

const SENTINEL = 'credential-sentinel-163-never-surface';
const env = {OPENROUTER_API_KEY: SENTINEL};
// HYPOTHETICAL trusted contract injection ONLY for protocol unit tests.
// alloy/pcm16 is the documented GPT Audio sample, NOT confirmed Lyria support.
// The production contract stays false and the CLI never injects this fixture.
const fixtureContract = {
  ...musicContract, validated: true, costCeilingValidated: true,
  audio: {...musicContract.documentedRequest.audio}, mimeType: 'audio/pcm',
};
const approved = {
  hasKey: true, contractValidated: true, accessApproved: true,
  model: 'google/lyria-3-pro-preview', rightsApproved: true, budgetUsd: 0.16,
};

function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const delays = [];
  const sleeps = [];
  return {
    delays, sleeps, timers,
    now: () => now,
    setTimeout(callback, delay) {
      delays.push(delay);
      timers.set(++id, {callback, at: now + delay});
      return id;
    },
    clearTimeout(handle) { timers.delete(handle); },
    async sleep(ms) { sleeps.push(ms); },
    advance(ms) {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(handle); timer.callback(); }
      }
    },
  };
}

function streamResponse(text, splitAt = 17) {
  const encoded = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < encoded.length; i += splitAt) controller.enqueue(encoded.slice(i, i + splitAt));
      controller.close();
    },
  }), {headers: {'Content-Type': 'text/event-stream; charset=utf-8'}});
}

function audioResponse(bytes = new Uint8Array([0, 1, 2, 250, 255]), extras = {}) {
  const base64 = Buffer.from(bytes).toString('base64');
  return streamResponse(': heartbeat\r\n\r\n' + [
    {choices: [{delta: {content: 'ignored', audio: {transcript: 'ignored', data: base64.slice(0, 3)}}}]},
    {choices: [{delta: {audio: {data: base64.slice(3)}}}]},
    {choices: [], usage: {prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, cost: 0.08, ...extras}},
  ].map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
}

async function settleUntil(predicate) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('fake operation did not reach expected state');
}

const run = (transport, options = {}) => generateMusic({
  env, config: approved, contract: fixtureContract, clock: fakeClock(), transport, ...options,
});

describe('zero-request fail-closed preflight', () => {
  for (const [reason, patch] of [
    ['no-key', {hasKey: false}],
    ['unvalidated-contract', {contractValidated: false}],
    ['missing-rights', {rightsApproved: false}],
    ['missing-budget', {budgetUsd: null}],
  ]) {
    test(`${reason} selects fallback without transport`, async () => {
      const config = {...approved, ...patch};
      let requests = 0;
      expect(planMusicRequest(config, fixtureContract)).toEqual({action: 'skip', reason});
      const result = await run(() => { requests += 1; throw new Error('must not request'); }, {
        config, env: reason === 'no-key' ? {} : env,
      });
      expect(result).toEqual({status: 'fallback', reason, attempts: 0});
      expect(requests).toBe(0);
    });
  }
  test('JSON approval cannot override the unvalidated production contract', async () => {
    let requests = 0;
    expect(musicContract.validated).toBe(false);
    expect(musicContract.validationGaps.length).toBeGreaterThan(0);
    const result = await generateMusic({env, config: approved, transport: () => { requests += 1; }});
    expect(result.reason).toBe('unvalidated-contract');
    expect(requests).toBe(0);
  });
  test('access approval is mandatory', () => {
    expect(planMusicRequest({...approved, accessApproved: false}, fixtureContract).reason).toBe('unvalidated-contract');
  });
  test('wrong/unsupported models do not request', () => {
    for (const model of [null, 'unknown/model', ALLOWED_MODELS[0]]) {
      expect(planMusicRequest({...approved, model}, fixtureContract).action).toBe('skip');
    }
  });
  test('invalid and nonnumeric budgets do not request', () => {
    for (const budgetUsd of [0, -1, NaN, Infinity, '0.16', Number.MIN_VALUE]) {
      expect(planMusicRequest({...approved, budgetUsd}, fixtureContract).reason).toBe('missing-budget');
    }
  });
  test('default config, empty and whitespace keys skip', async () => {
    expect(planMusicRequest()).toEqual({action: 'skip', reason: 'no-key'});
    for (const key of ['', '  ']) expect((await run(() => { throw new Error('unexpected'); }, {env: {OPENROUTER_API_KEY: key}})).reason).toBe('no-key');
  });
});

describe('documented contract mapping', () => {
  test('records fetched docs, retrieval date, exact sample and response path', () => {
    expect(musicContract.retrievedAt).toBe('2026-11-21');
    expect(musicContract.docs).toContain('https://openrouter.ai/docs/guides/overview/multimodal/audio');
    expect(musicContract.documentedRequest).toEqual({
      model: 'openai/gpt-audio', messages: [{role: 'user', content: 'Say hello in a friendly tone.'}],
      modalities: ['text', 'audio'], audio: {voice: 'alloy', format: 'pcm16'}, stream: true,
    });
    expect(musicContract.documentedResponse.audioDataPath).toBe('choices[0].delta.audio.data');
    expect(musicContract.documentedResponse.completion).toBe('data: [DONE]');
    expect(musicContract.audio).toBeNull();
    expect(musicContract.costCeilingValidated).toBe(false);
  });
  test('uses exact PRD prompt and only documented fields; reserves total budget', async () => {
    let request;
    const result = await run((url, options) => { request = {url, ...options}; return audioResponse(); });
    expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(request.method).toBe('POST');
    expect(request.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
    const body = JSON.parse(request.body);
    expect(body).toEqual({
      model: approved.model, messages: [{role: 'user', content: MUSIC_PROMPT}],
      modalities: ['text', 'audio'], audio: {voice: 'alloy', format: 'pcm16'}, stream: true,
      provider: {allow_fallbacks: false, require_parameters: true, max_price: {request: 0.08, prompt: 0, completion: 0}},
    });
    expect(MUSIC_PROMPT).toBe('60-second instrumental, 120 BPM, 4/4, playful cartoon chiptune, clear downbeats, sparse melody, resolve over final three bars; no vocals or artist imitation.');
    expect(body.duration).toBeUndefined();
    expect(body.bpm).toBeUndefined();
    expect(result.status).toBe('candidate');
    expect([...result.bytes]).toEqual([0, 1, 2, 250, 255]);
    expect(result.requestMeta.reservedCostUsd).toBe(0.08);
    expect(result.requestMeta.approvedBudgetUsd).toBe(0.16);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });
  test('accepts arbitrary byte splits and LF SSE, ignores text/transcript metadata', async () => {
    const result = await run(() => streamResponse('data: {"choices":[{"delta":{"audio":{"data":"AQID","transcript":"unused"}}}]}\n\ndata: [DONE]\n\n', 1));
    expect([...result.bytes]).toEqual([1, 2, 3]);
    expect(result.transcript).toBeUndefined();
  });
  test('usage is numeric allowlisted, not raw provider metadata', async () => {
    const result = await run(() => audioResponse(undefined, {key: SENTINEL, raw_headers: `Bearer ${SENTINEL}`, total_tokens: SENTINEL}));
    expect(result.usage).toEqual({prompt_tokens: 1, completion_tokens: 2, cost: 0.08});
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });
  test('reported cost above reserved ceiling rejects', async () => {
    const result = await run(() => audioResponse(undefined, {cost: 0.081}));
    expect(result).toEqual({status: 'fallback', reason: 'budget-exceeded', attempts: 1});
  });
});

describe('deadlines, retry and fallback outcomes', () => {
  test('AbortController deadline is exactly 120000ms, including stalled transport; max two attempts', async () => {
    const clock = fakeClock();
    const signals = [];
    const pending = run((_, options) => { signals.push(options.signal); return new Promise(() => {}); }, {clock});
    await settleUntil(() => signals.length === 1);
    expect(clock.delays).toEqual([120000]);
    clock.advance(119999);
    expect(signals[0].aborted).toBe(false);
    clock.advance(1);
    expect(signals[0].aborted).toBe(true);
    await settleUntil(() => signals.length === 2);
    expect(clock.delays).toEqual([120000, 120000]);
    clock.advance(120000);
    expect(await pending).toEqual({status: 'fallback', reason: 'timeout', attempts: 2});
    expect(signals[1].aborted).toBe(true);
    expect(clock.timers.size).toBe(0);
    expect(clock.sleeps).toEqual([250]);
    expect(REQUEST_TIMEOUT_MS).toBe(120000);
    expect(MAX_ATTEMPTS).toBe(2);
  });
  test('deadline includes a stalled SSE body, not just response headers', async () => {
    const clock = fakeClock();
    let calls = 0;
    const pending = run(() => {
      calls += 1;
      return new Response(new ReadableStream({start() {}}), {headers: {'Content-Type': 'text/event-stream'}});
    }, {clock});
    await settleUntil(() => calls === 1);
    clock.advance(120000);
    await settleUntil(() => calls === 2);
    clock.advance(120000);
    expect((await pending).reason).toBe('timeout');
  });
  test('transient failures stop after one retry', async () => {
    let calls = 0;
    const result = await run(() => { calls += 1; return new Response('', {status: 503}); });
    expect(result).toEqual({status: 'fallback', reason: 'provider-unavailable', attempts: 2});
    expect(calls).toBe(2);
  });
  test('one retry can produce a candidate within the total approved ceiling', async () => {
    let calls = 0;
    const result = await run(() => ++calls === 1 ? new Response('', {status: 429}) : audioResponse());
    expect(result.status).toBe('candidate');
    expect(result.attempts).toBe(2);
    expect(result.requestMeta.reservedCostUsd).toBe(approved.budgetUsd);
  });
  for (const status of [401, 402, 403]) {
    test(`denial ${status} is fallback with no retry or error-body disclosure`, async () => {
      const response = new Response(`Bearer ${SENTINEL}`, {status});
      const result = await run(() => response);
      expect(result).toEqual({status: 'fallback', reason: 'denied-access', attempts: 1});
      expect(response.bodyUsed).toBe(false);
    });
  }
  test('unsupported HTTP generation response is fallback', async () => {
    for (const status of [400, 404, 415, 422, 501]) expect((await run(() => new Response('', {status}))).reason).toBe('unsupported-generation');
  });
  test('non-streaming JSON is not misrepresented as accepted audio', async () => {
    expect((await run(() => Response.json({audio: {data: 'AQID'}}))).reason).toBe('unsupported-generation');
  });
  for (const [label, text] of [
    ['invalid JSON', 'data: {oops}\n\n'],
    ['empty audio', 'data: [DONE]\n\n'],
    ['truncated stream', 'data: {"choices":[{"delta":{"audio":{"data":"AQID"}}}]}\n\n'],
    ['invalid base64', 'data: {"choices":[{"delta":{"audio":{"data":"!!!="}}}]}\n\ndata: [DONE]\n\n'],
    ['wrong audio type', 'data: {"choices":[{"delta":{"audio":{"data":123}}}]}\n\ndata: [DONE]\n\n'],
  ]) {
    test(`${label} returns malformed-response fallback`, async () => {
      expect(await run(() => streamResponse(text))).toEqual({status: 'fallback', reason: 'malformed-response', attempts: 1});
    });
  }
  test('SSE error with denied access discards arbitrary error text', async () => {
    const result = await run(() => streamResponse(`data: ${JSON.stringify({error: {code: 403, message: `Bearer ${SENTINEL}`}})}\n\n`));
    expect(result).toEqual({status: 'fallback', reason: 'denied-access', attempts: 1});
  });
  test('missing dependencies and malformed configuration never throw', async () => {
    expect((await run(undefined)).reason).toBe('invalid-dependencies');
    expect((await generateMusic({env: null, config: null})).status).toBe('fallback');
    expect((await run(() => { throw Error('ignored'); }, {clock: {...fakeClock(), sleep: () => { throw Error(SENTINEL); }}})).status).toBe('fallback');
  });
});

describe('credential exclusion and cache handoff', () => {
  test('transport exception with sentinel never rejects or logs sensitive text', async () => {
    const logs = [];
    const spies = ['log', 'warn', 'error'].map((name) => spyOn(console, name).mockImplementation((...args) => logs.push(args)));
    try {
      const result = await run(() => { throw new Error(`Authorization: Bearer ${SENTINEL}; api_key=${SENTINEL}`); });
      expect(result).toEqual({status: 'fallback', reason: 'transport-error', attempts: 2});
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect(logs).toEqual([]);
    } finally { spies.forEach((spy) => spy.mockRestore()); }
  });
  test('redacts Bearer, OpenRouter/key patterns and exact arbitrary credentials', () => {
    const shaped = 'sk-' + 'or-v1-' + 'fictionaltestcredential';
    const result = redact(`Bearer ${SENTINEL} ${shaped} OPENROUTER_API_KEY=${SENTINEL} api-key=other-secret`, [SENTINEL]);
    expect(result).not.toContain(SENTINEL);
    expect(result).not.toContain(shaped);
    expect(result).not.toContain('other-secret');
  });
  test('credential echo in generated bytes is rejected rather than cached', async () => {
    expect((await run(() => audioResponse(Buffer.from(SENTINEL)))).reason).toBe('malformed-response');
  });
  test('candidate-sink interface never fabricates acceptance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sink-invalid-'));
    try {
      expect(await acceptCandidate({bytes: new Uint8Array([1]), mimeType: 'audio/pcm', model: approved.model, prompt: MUSIC_PROMPT, usage: null, requestMeta: {}, cacheDir: join(dir, 'cache')})).toEqual({accepted: false, reason: 'corrupt-pcm'});
    } finally { await rm(dir, {recursive: true, force: true}); }
  });
  test('script hands candidate bytes and safe metadata to the named sink; QA is redacted', async () => {
    let received;
    const qa = await runMusicGeneration({env, config: approved, contract: fixtureContract, clock: fakeClock(), transport: () => audioResponse(), checkedAt: '2026-11-21T00:00:00.000Z', sink: async (candidate) => {
      received = candidate;
      return {accepted: false, reason: `Bearer ${SENTINEL}`};
    }});
    expect(Object.keys(received).sort()).toEqual(['bytes', 'mimeType', 'model', 'prompt', 'requestMeta', 'usage']);
    expect([...received.bytes]).toEqual([0, 1, 2, 250, 255]);
    expect(qa.outcome).toBe('rejected');
    expect(qa.attempts).toBe(1);
    expect(JSON.stringify(qa)).not.toContain(SENTINEL);
  });
  test('sink exceptions also become redacted fallback outcomes', async () => {
    const qa = await runMusicGeneration({env, config: approved, contract: fixtureContract, clock: fakeClock(), transport: () => audioResponse(), sink: () => { throw Error(SENTINEL); }});
    expect(qa.outcome).toBe('rejected');
    expect(qa.reason).toBe('cache-sink-error');
    expect(JSON.stringify(qa)).not.toContain(SENTINEL);
  });
  test('no-key script entry point returns skipped with zero injected requests', async () => {
    let requests = 0;
    const qa = await runMusicGeneration({env: {}, transport: () => { requests += 1; }, clock: fakeClock()});
    expect(qa.outcome).toBe('skipped');
    expect(qa.reason).toBe('no-key');
    expect(qa.attempts).toBe(0);
    expect(qa.networkRequests).toBe(0);
    expect(qa.smokeTest).toBe('not run: no key');
    expect(requests).toBe(0);
  });
  test('real Bun command has exit zero and no fetch calls when key is unset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'music-no-key-'));
    const guard = join(dir, 'guard.js');
    await Bun.write(guard, 'let calls=0; globalThis.fetch=()=>{calls++;throw Error("network forbidden")}; process.on("exit",()=>console.log(`guardNetworkRequests=${calls}`));\n');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const childEnv = {...process.env};
    delete childEnv.OPENROUTER_API_KEY;
    try {
      const child = Bun.spawn([process.execPath, '--preload', guard, 'apps/video/scripts/music-generate.js'], {cwd: root, env: childEnv, stdout: 'pipe', stderr: 'pipe'});
      const output = await new Response(child.stdout).text();
      const error = await new Response(child.stderr).text();
      expect(await child.exited).toBe(0);
      expect(output).toContain('FALLBACK no-key networkRequests=0');
      expect(output).toContain('guardNetworkRequests=0');
      expect(error).toBe('');
    } finally { await rm(dir, {recursive: true, force: true}); }
  });
  test('no render path or other non-music src file imports/reexports the adapter', async () => {
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const walk = async (dir) => {
      for (const entry of await readdir(dir, {withFileTypes: true})) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (/\.(?:js|jsx)$/.test(path) && !path.startsWith(join(src, 'music') + '/')) {
          expect(await readFile(path, 'utf8')).not.toMatch(/openrouter-adapter|music-generate/);
        }
      }
    };
    await walk(src);
  });
  test('importing adapter triggers no network calls', async () => {
    const original = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = () => { requests += 1; throw Error('forbidden'); };
    try {
      await import(`../src/music/openrouter-adapter.js?isolation-test=163`);
      expect(requests).toBe(0);
    } finally { globalThis.fetch = original; }
  });
});
