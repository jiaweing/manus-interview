# Evidence ledger

| Issue | PR | Builder | Verifier | Result | Date |
|---|---|---|---|---|---|
| #151 | #185 | lead (Manus) | verifier agent job_4vMk27dC | verified, merged (deviation: scaffold inside repo, --no-git, per swarm prompt) | 2026-11-21 |
| #153 | #191 | builder job_lQNwNBKf | verifier job_zXGWziYJ | verified, merged | 2026-11-21 |
| #163 | #192 | builder job_JQEu69Yp | verifier job_NvHTDlj2 | verified, merged (real smoke test not run: no key) | 2026-11-21 |
| #152 | #190 | builder job_wc5IryJB | verifier job_pI4qAuSm | BLOCKED (no key); infra merged, issue open | 2026-11-21 |
| fix | #205 | lead | - | integration fix: authoring isolation test vs src/music | 2026-11-21 |

| #154 | #217 | builder job_9cqmrhe5 | verifier job_OH7BD4Q2 | verified, merged (benchmark PASS: 240 frames, 0 errors, ~10.6 min projected full render) | 2026-11-21 |
| #164 | #212 | builder job_BxO3HChI | verifier job_8LxNe3Of | verified, merged (analytical listen only, not human) | 2026-11-21 |
| #155 | #229 | builder job_nBXhYUnb | verifier job_QAJcb0qV | verified, merged (primitives + stub film) | 2026-11-21 |
| #165 | #228 | builder job_mmz8usBb | verifier job_q9U8AhPf | verified, merged (selected js-fallback; no provider candidate: no key) | 2026-11-21 |
## Integration rule
After EVERY merge the integrator runs the full suite (`bun test apps/video/tests`) on main. Wave 2 merge exposed a cross-PR failure (fixed in #205).
