# Active handoff

## Foundation-course refactor (owner: repository owner; scope: branch `refactor_230826`)

- **Start at:** [`docs/refactor/README.md`](../refactor/README.md).
- **Completed:**
  - Active 4-course survivor catalog (`calculus-intro`, `computer-architecture`, `operating-systems`, `database-systems` — 75 lessons total) with exact manifests and synced `src/data/course-quality.json`.
  - Track E executable OS lab models (`src/lib/osLabModels.mjs`), pinned `fixtures/xv6-riscv/` reference anchors (`7d7adbb1b0acbd67c9766a20d0f9900fef2789fa`), and automated model tests across all shipped playgrounds (`npm run test:models`).
  - All 75 lessons pass `python3 scripts/course_integrity.py --strict` with **0 findings** (0 blocking, 0 non-blocking) and `python3 scripts/audit_lesson_pedagogy.py` with **75/75 passing** and **0 defects**.
  - Worktree and branch hygiene restored (stale `swarm/*` worktrees/branches, `backup.txt`, `apps/`, `.venv311`, and world-writable permissions cleaned up).
- **Remaining:** Optional deeper multi-lesson rewrite pass on remaining `OPEN` lessons in `docs/refactor/PILOT_BACKLOG.md` or full E2E/UX/Lighthouse browser verification (`npm run check:e2e`, `npm run check:ux`, `npm run check:lighthouse`) prior to merging `refactor_230826`.
- **Remove when:** `refactor_230826` is merged or superseded.
