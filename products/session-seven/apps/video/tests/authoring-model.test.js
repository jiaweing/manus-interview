import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_URL, CHAT_URL, MAX_TOKENS, MODEL_ID, TIMEOUT_MS,
  loadApiKey, parseEnv, runVerifier, verifyModel,
} from '../scripts/authoring-verify-model.js';

const SENTINEL = 'sk-or-v1-TEST_ONLY_SENTINEL_NEVER_SAVE';
const entry = {
  id: MODEL_ID, context_length: 1_000_000,
  supported_parameters: ['max_tokens', 'tools', 'structured_outputs'],
  pricing: { prompt: '0.000005', completion: '0.000025', request: '0' },
};
const completion = {
  id: 'gen-test-scoped-patch', model: MODEL_ID, created: 42,
  usage: { prompt_tokens: 101, completion_tokens: 50, total_tokens: 151 },
  choices: [{ finish_reason: 'stop', message: { content: '--- a/authoring/access-check-scene.js\n+++ b/authoring/access-check-scene.js\n@@\n-  return frame / 30;\n+  return Math.min(1, Math.max(0, frame / 30));' } }],
};

function transport({ models = [entry], result = completion, status = 200, failure } = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === CATALOG_URL) return Response.json({ data: models });
      if (url !== CHAT_URL) throw new Error(`Unexpected endpoint: ${url}`);
      if (failure) throw new Error(failure);
      return Response.json(result, { status });
    },
  };
}

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 's7-authoring-'));
  roots.push(root);
  return root;
}

// Follow relative source imports as well, so an intermediate helper cannot hide
// a script dependency. Ban scripts altogether on the runtime side of the fence.
async function assertRuntimeIsolation(srcRoot) {
  const seen = new Set();
  async function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = await readFile(file, 'utf8');
    expect(source).not.toContain('authoring-verify-model');
    expect(source).not.toContain('OPENROUTER_API_KEY');
    const imports = source.matchAll(/(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?|\b(?:import|require)\s*\(\s*)['"]([^'"]+)['"]/g);
    for (const [, specifier] of imports) {
      expect(specifier).not.toMatch(/(?:^|\/)scripts(?:\/|$)/);
      if (!specifier.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      for (const candidate of [resolved, `${resolved}.js`, `${resolved}.jsx`, path.join(resolved, 'index.js')]) {
        if (!/\.(?:js|jsx|mjs|cjs)$/.test(candidate)) continue;
        try {
          await visit(candidate);
          break;
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
        }
      }
    }
  }
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await walk(file);
      else if (/\.(?:js|jsx|mjs|cjs)$/.test(file)) await visit(file);
    }
  }
  await walk(srcRoot);
}

describe('authoring model gate (fake transport only)', () => {
  test('catalog present + exactly one scoped completion produces verified metadata', async () => {
    const fake = transport();
    const deadlines = [];
    const result = await verifyModel({
      fetchImpl: fake.fetchImpl, apiKey: SENTINEL,
      now: () => '2026-11-21T00:00:00.000Z',
      deadline: (ms) => { deadlines.push(ms); return new AbortController().signal; },
    });
    expect(result.exitCode).toBe(0);
    expect(result.record.status).toBe('verified');
    expect(result.record.modelId).toBe(MODEL_ID);
    expect(result.record.catalog.evidence).toEqual(entry);
    expect(result.record.catalog.evidenceUrl).toBe(CATALOG_URL);
    expect(result.record.generationId).toBe(completion.id);
    expect(result.record.usage).toEqual(completion.usage);
    expect(result.record.timestamps.responseReceivedAt).toBe('2026-11-21T00:00:00.000Z');
    expect(result.record.error).toBeNull();
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].options.method).toBe('GET');
    expect(fake.calls[0].options.headers.Authorization).toBeUndefined();
    const chat = fake.calls[1];
    expect(chat.url).toBe(CHAT_URL);
    expect(chat.options.method).toBe('POST');
    expect(chat.options.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
    expect(chat.options.redirect).toBe('error');
    const body = JSON.parse(chat.options.body);
    expect(body.model).toBe(MODEL_ID);
    expect(body.models).toBeUndefined();
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(MAX_TOKENS);
    expect(MAX_TOKENS).toBeLessThanOrEqual(1024);
    expect(body.messages[1].content).toContain('Locked intro scene record');
    expect(chat.options.body).not.toContain(SENTINEL);
    expect(result.record.requestRef).toBe(`sha256:${createHash('sha256').update(chat.options.body).digest('hex')}`);
    expect(deadlines).toEqual([TIMEOUT_MS, TIMEOUT_MS]);
    expect(TIMEOUT_MS).toBe(120000);
    expect(result.output).toContain('UNREVIEWED');
  });

  test('missing catalog model blocks without sending chat, even with a key', async () => {
    const fake = transport({ models: [{ id: 'different/model' }] });
    const result = await verifyModel({ fetchImpl: fake.fetchImpl, apiKey: SENTINEL });
    expect(result.exitCode).toBe(2);
    expect(result.record.status).toBe('blocked');
    expect(result.record.catalog.listed).toBe(false);
    expect(result.record.catalog.evidence).toBeNull();
    expect(result.record.error).toContain('catalog mismatch');
    expect(result.record.requestRef).toBeNull();
    expect(result.record.generationId).toBeNull();
    expect(fake.calls.map((call) => call.url)).toEqual([CATALOG_URL]);
  });

  test('no key still checks catalog, records blocker and sends zero chat requests', async () => {
    const fake = transport();
    const root = await temporaryRoot();
    const result = await runVerifier({ productRoot: root, environment: {}, fetchImpl: fake.fetchImpl });
    expect(result.exitCode).toBe(2);
    expect(result.record.status).toBe('blocked');
    expect(result.record.catalog.listed).toBe(true);
    expect(result.record.error).toBe('no OPENROUTER_API_KEY');
    expect(result.record.chatRequests).toBe(0);
    expect(fake.calls).toHaveLength(1);
    const saved = JSON.parse(await readFile(path.join(root, 'authoring/model-record.json'), 'utf8'));
    expect(saved).toEqual(result.record);
    expect(await readFile(path.join(root, 'qa/authoring-blocker.txt'), 'utf8')).toBe(result.output);
    expect(await readFile(path.join(root, 'qa/authoring-model.txt'), 'utf8')).toBe(result.output);
  });

  test('no key + missing model truthfully records both independent blockers', async () => {
    const fake = transport({ models: [] });
    const result = await verifyModel({ fetchImpl: fake.fetchImpl });
    expect(result.record.error).toBe(`no OPENROUTER_API_KEY; catalog mismatch: ${MODEL_ID} is not listed`);
    expect(result.record.chatRequests).toBe(0);
  });

  test('product .env key works unchanged; all saved/output fields redact echoed key', async () => {
    const root = await temporaryRoot();
    await writeFile(path.join(root, '.env'), `# ignored local credential\nexport OPENROUTER_API_KEY="${SENTINEL}" # comment\n`);
    const fake = transport({
      models: [{ ...entry, pricing: { extra: SENTINEL } }],
      result: { ...completion, id: `gen-${SENTINEL}`, usage: { ...completion.usage, echo: SENTINEL }, choices: [{ finish_reason: 'stop', message: { content: `diff text ${SENTINEL}` } }] },
    });
    const result = await runVerifier({ productRoot: root, environment: {}, fetchImpl: fake.fetchImpl });
    expect(result.exitCode).toBe(0);
    expect(fake.calls[1].options.headers.Authorization).toBe(`Bearer ${SENTINEL}`);
    expect(result.output).not.toContain(SENTINEL);
    expect(JSON.stringify(result.record)).not.toContain(SENTINEL);
    for (const file of ['authoring/model-record.json', 'qa/authoring-model.txt']) {
      expect(await readFile(path.join(root, file), 'utf8')).not.toContain(SENTINEL);
    }
    expect(result.output).toContain('[REDACTED]');
    await expect(readFile(path.join(root, 'qa/authoring-blocker.txt'))).rejects.toThrow();
  });

  test('HTTP denial and thrown transport errors redact keys without retries', async () => {
    for (const options of [
      { status: 401, result: { error: { message: `denied Bearer ${SENTINEL}` } } },
      { failure: `transport ${SENTINEL}` },
    ]) {
      const fake = transport(options);
      const result = await verifyModel({ fetchImpl: fake.fetchImpl, apiKey: SENTINEL });
      expect(result.exitCode).toBe(2);
      expect(result.record.status).toBe('blocked');
      expect(result.record.chatRequests).toBe(1);
      expect(fake.calls).toHaveLength(2);
      expect(result.output).not.toContain(SENTINEL);
      expect(JSON.stringify(result.record)).not.toContain(SENTINEL);
      expect(result.record.error).toContain('[REDACTED]');
    }
  });

  test('malformed, truncated, or substitute-model responses cannot pass', async () => {
    for (const result of [
      { ...completion, id: null },
      { ...completion, model: 'different/model' },
      { ...completion, usage: null },
      { ...completion, choices: [] },
      { ...completion, choices: [{ finish_reason: 'length', message: { content: 'truncated diff' } }] },
    ]) {
      const fake = transport({ result });
      const outcome = await verifyModel({ fetchImpl: fake.fetchImpl, apiKey: SENTINEL });
      expect(outcome.exitCode).toBe(2);
      expect(outcome.record.status).toBe('blocked');
      expect(fake.calls).toHaveLength(2);
    }
  });

  test('malformed catalog records failure and cannot authorize a completion', async () => {
    const result = await verifyModel({ apiKey: SENTINEL, fetchImpl: async () => Response.json({ data: null }) });
    expect(result.record.catalog.listed).toBe(false);
    expect(result.record.error).toContain('Malformed catalog');
    expect(result.record.chatRequests).toBe(0);
  });

  test('tiny parser handles comments, whitespace, quotes and export without expansion', async () => {
    expect({ ...parseEnv('\uFEFF# comment\nexport A="a value" # trailing\nB=bare # comment\nC=\'literal $A\'\ninvalid\nD="unclosed') }).toEqual({ A: 'a value', B: 'bare', C: 'literal $A' });
    const root = await temporaryRoot();
    await writeFile(path.join(root, '.env'), `OPENROUTER_API_KEY=${SENTINEL}\n`);
    expect(await loadApiKey(root, { OPENROUTER_API_KEY: 'environment-wins' })).toBe('environment-wins');
  });

  test('other provider environment variables are never a substitute', async () => {
    const fake = transport();
    const root = await temporaryRoot();
    const result = await runVerifier({ productRoot: root, environment: { OPENAI_API_KEY: SENTINEL, OPENAI_API_BASE: 'https://never-call.invalid' }, fetchImpl: fake.fetchImpl });
    expect(result.record.error).toBe('no OPENROUTER_API_KEY');
    expect(fake.calls.map((call) => call.url)).toEqual([CATALOG_URL]);
  });

  test('nothing in apps/video/src imports the authoring verifier (directly or transitively)', async () => {
    await assertRuntimeIsolation(fileURLToPath(new URL('../src', import.meta.url)));
  });
});
