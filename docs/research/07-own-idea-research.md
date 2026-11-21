# Almost: limited research notes

Research checked on 21 November 2026. Ideation is a compact creative shortlist, not independent market research on eight companies.

- WIP describes itself as makers shipping together, helping each other stay accountable, and building a habit of shipping through daily incremental progress. Almost will instead center private re-entry into dormant creative projects, with no streak or feed. This is positioning differentiation, not a claim of market uniqueness. Source visited: https://wip.co/
- MDN explains IndexedDB as browser storage for larger structures; origin storage is best-effort by default. Persistent storage may be requested with navigator.storage.persist(), but granting it depends on browser policy. Private browsing storage is usually deleted when the session ends. IndexedDB writes can fail with QuotaExceededError. Therefore Almost needs transactional writes, explicit local-only warnings, bounded image sizes, and export/import backup in P0. Preview and final published origins have distinct browser storage; export/import is the migration path. Source visited: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria

No external images are needed for the PRD. The proposed product uses user-provided images and original CSS/SVG sample artifacts created during the build.
