# Evidence ledger

| Issue | PR | Builder | Verifier | Result | Date |
|---|---|---|---|---|---|
| #151 | #185 | lead (Manus) | verifier agent job_4vMk27dC | verified, merged (deviation: scaffold inside repo, --no-git, per swarm prompt) | 2026-11-21 |
| #153 | #191 | builder job_lQNwNBKf | verifier job_zXGWziYJ | verified, merged | 2026-11-21 |
| #163 | #192 | builder job_JQEu69Yp | verifier job_NvHTDlj2 | verified, merged (real smoke test not run: no key) | 2026-11-21 |
| #152 | #190 | builder job_wc5IryJB | verifier job_pI4qAuSm | BLOCKED (no key); infra merged, issue open | 2026-11-21 |
| fix | #205 | lead | - | integration fix: authoring isolation test vs src/music | 2026-11-21 |

## Integration rule
After EVERY merge the integrator runs the full suite (`bun test apps/video/tests`) on main. Wave 2 merge exposed a cross-PR failure (fixed in #205).
