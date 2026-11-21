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
| #156 | #238 | builder job_6SJiE9zz | verifier job_g2Ce8z9s | verified, merged (intro/outro) | 2026-11-21 |
| #157 | #237 | builder job_A82XJZl1 | verifier job_GdJUNh0R | verified, merged (Caret) | 2026-11-21 |
| #158 | #242 | builder job_HZgKkPbd | verifier job_gBSDBZuZ | verified, merged (Flopside) | 2026-11-21 |
| #159 | #239 | builder job_DJaSzsxd | verifier job_TfWOvrFX | verified, merged (Patchbay) | 2026-11-21 |
| #160 | #241 | builder job_yUMhY2IG | verifier job_MfV5h3Ec | verified, merged (Sidekick) | 2026-11-21 |
| #161 | #236 | builder job_2qVKVy85 | verifier job_wxjgdrRe | verified, merged (TetherTerm) | 2026-11-21 |
| #162 | #244 | builder job_Jt1QtP1Q | verifier job_iV34d40k | verified, merged (Glassroom) | 2026-11-21 |
| #166 | #250 | builder job_KxjblG4M | verifier job_GOTLZNNX | objective checks PASS; human listening waived (analytical seams only), merged | 2026-11-21 |
| #152 | #262 | lead | - | key arrived 2026-11-21 (Manus OpenRouter connector): access verified, generation gen-1795276765-osnJ2plgjv4ZfRq6VcBU, initial fixture patch accepted. Scene authoring pass by Opus: in progress | 2026-11-22 |
## Integration rule
After EVERY merge the integrator runs the full suite (`bun test apps/video/tests`) on main. Wave 2 merge exposed a cross-PR failure (fixed in #205).
