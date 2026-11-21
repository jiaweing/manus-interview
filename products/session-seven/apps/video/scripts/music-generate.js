import {mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateMusic, redact} from '../src/music/openrouter-adapter.js';
import {musicContract} from '../src/music/contract.js';
import {acceptCandidate} from '../src/music/candidate-sink.js';

const approvalPath = fileURLToPath(new URL('../audio/music-approval.json', import.meta.url));
const defaultQaPath = fileURLToPath(new URL('../../../qa/music-provider.json', import.meta.url));

/** Script-only entry point. Tests inject all billable effects and the sink. */
export async function runMusicGeneration({
  env = {}, config, transport, clock, sink = acceptCandidate,
  contract = musicContract, checkedAt = new Date().toISOString(),
} = {}) {
  let approval = config;
  if (approval === undefined) {
    try { approval = await Bun.file(approvalPath).json(); } catch { approval = {}; }
  }
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) approval = {};
  const result = await generateMusic({env, config: approval, transport, clock, contract});
  let outcome = result.attempts === 0 ? 'skipped' : 'rejected';
  let reason = result.reason;
  if (result.status === 'candidate') {
    try {
      const accepted = await sink({
        bytes: result.bytes, mimeType: result.mimeType, model: result.model,
        prompt: result.prompt, usage: result.usage, requestMeta: {
          ...result.requestMeta, createdAt: checkedAt, rights: approval.rights,
          pcmFormat: contract.pcmFormat,
        },
      });
      outcome = accepted?.accepted === true ? 'validated' : 'rejected';
      reason = typeof accepted?.reason === 'string' ? accepted.reason : 'cache-rejected';
    } catch {
      reason = 'cache-sink-error'; // No exception text/stack escapes to logs or QA.
    }
  }
  const key = env.OPENROUTER_API_KEY;
  return {
    outcome, reason: redact(reason ?? 'cache-accepted', [key]).slice(0, 180),
    attempts: result.attempts, sources: [...musicContract.docs], checkedAt,
    costApproval: {
      totalBudgetUsd: typeof approval.budgetUsd === 'number' && Number.isFinite(approval.budgetUsd) && approval.budgetUsd > 0 ? approval.budgetUsd : null,
      accessApproved: approval.accessApproved === true,
      rightsApproved: approval.rightsApproved === true,
      contractValidated: approval.contractValidated === true && musicContract.validated,
    },
    networkRequests: result.attempts,
    smokeTest: result.attempts === 0 ? (reason === 'no-key' ? 'not run: no key' : 'not run: approvals or contract missing') : 'bounded fake or approved provider attempt; see outcome',
  };
}

if (import.meta.main) {
  // This is the ONLY ambient credential read; never pass the whole environment.
  const env = {OPENROUTER_API_KEY: Bun.env.OPENROUTER_API_KEY};
  const clock = {setTimeout, clearTimeout, sleep: (ms) => Bun.sleep(ms)};
  try {
    const qa = await runMusicGeneration({env, transport: globalThis.fetch, clock});
    await mkdir(dirname(defaultQaPath), {recursive: true});
    await Bun.write(defaultQaPath, `${JSON.stringify(qa, null, 2)}\n`);
    console.log(`${qa.outcome === 'validated' ? 'VALIDATED' : 'FALLBACK'} ${qa.reason} networkRequests=${qa.networkRequests}`);
  } catch {
    console.log('FALLBACK qa-write-failed');
  }
  process.exitCode = 0;
}
