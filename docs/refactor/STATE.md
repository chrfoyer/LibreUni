# Refactor state snapshot — 2026-10-06

Branch `refactor_230826`, HEAD `5fc49c7 [Refactor] Refactor proposal Sep 2026` (previous: `aaee234 Purge for CS/SWE focus`). Worktree clean at snapshot time.

## What the refactor did

- Purged the catalog from 10 CS/SWE courses (238 lessons) to **3 reference courses**; 7 retired courses, their manifests, and 3 former career paths are kept (including uncommitted state) in [`archive/curriculum/2026-09-14/`](../../archive/curriculum/2026-09-14/README.md). Archive is a recovery source, never loaded by Astro.
- Rewrote the 3 courses ground-up; added one learning path (`src/content/careers/systems-foundations.json`).
- Reworked lesson shell (compact brief + sequence navigator; no generic injected quizzes), `Quiz`/`CaseStudy` semantics, named playgrounds, quality gates, PDF/book export.
- Added curriculum notes per course in [`docs/curriculum/`](../curriculum/) and a crosswalk.

## The three courses

| Course | Lessons | Authored interactions (per `course-quality.json`) | Notes |
|---|---|---|---|
| computer-architecture | 20 | Quiz 20, CaseStudy 20, 0 CodeExercise/Runner; 8 code blocks | Foundation of the path. Repair contract exists. |
| database-systems | 20 | CodeExercise 4; no Quiz/CaseStudy | Playgrounds exist (FD, B-tree, quorum, etc.). |
| operating-systems | 28 | **None** authored (79 code blocks) | Largest; labs claim assets that don't exist (xv6 etc.). |

## Verified baseline (updated 2026-10-30)

- Active 4-course catalog: `calculus-intro` (7 lessons, 28h), `computer-architecture` (20 lessons, 187h), `database-systems` (20 lessons, 180h), `operating-systems` (28 lessons, 189.5h) — 75 lessons total.
- `python3 scripts/course_integrity.py --strict`: **0 findings** (0 blocking, 0 non-blocking) across all 4 courses.
- `python3 scripts/audit_lesson_pedagogy.py`: **75/75 lessons pass** with **0 defects**.
- `npm run check:content`: contract tests (11/11), lesson verifier (0 errors over 75 files), course stats smoke check, course integrity (11 Python unit tests + 2 PlantUML diagnostic tests + strict audit), and deterministic playground/lab model tests (`scripts/test_os_models.mjs`, `scripts/test_architecture_models.mjs`, `tests/database-playground-models.test.mjs`) all pass.
- Worktree and repository cleanup completed: removed stale git worktrees and `swarm/*` branches, deleted 0-byte `backup.txt`, removed leftover `apps/` directory and `.venv311`, and normalized directory/file permissions.

## Why it "failed" (diagnosis, source-backed)

The structure and tooling are good; the **teaching content does not yet meet the standard it declares**. From the repair contracts:

1. Sections are exposition without an adjacent worked example, counterexample, or practice; a single opening quiz is not outcome assessment.
2. Outcome claims ("proof, transfer, design under changed parameters") exceed assessments; some exercises are **under-specified or wrong** (cache AMAT lacks inputs; VM exercise lacks PFN; OS SJF starvation example is invalid for non-preemptive SJF; capstone "68 operations" mixes multiplies/adds).
3. Labs promise runnable fixtures/oracles/xv6 repos that are not shipped. Rule: a protocol or rubric is not a runnable experiment unless a fixture/data path exists.
4. Sources are generic course landing pages, not claim-level anchors.
5. Breadth exceeds depth: specialist topics are named but not taught (see each contract's "deliberate narrowing").
6. Interaction parity is uneven: OS has 0 authored interactions; DB has no assessments; CA has stock Quiz/CaseStudy on every lesson (likely template-shaped — audit before treating as strength).
7. Structure checks pass (`verify_lessons`, smoke) so they hide the above. Do not use them as the finish line.

## Decisions in force

See [`../agent-context/DECISIONS.md`](../agent-context/DECISIONS.md): D-0001…D-0007 (D-0003 superseded). Key operational ones: D-0005 (lesson framing/interaction rules), D-0006 (three reference courses), D-0007 (pilot-then-port process, added with this hand-off).

## Known mess / cleanup candidates (not removed — owner decision)

- `CODEX.md` — tracked host adapter; keep unless `HOSTS.md` says otherwise.
- `test-results/`, `dist/`, `reports/` — generated; `reports/` is git-ignored (62 MB). Anything valuable there must be copied to `docs/` (done for the three repair contracts).
- `src/components/playgrounds/` still contains playgrounds for retired courses (Fourier, Birthday bound, Automaton…). Prune or move to archive when the pilot stabilizes; check imports first.
- The last commit added many screenshot/JSON baselines (visual/ux reports; size not measured); consider whether they belong in Git.

## Open questions for the owner

1. ~~Pilot course~~ — decided: Operating Systems (2026-10-06). Open: approve a 4th math course (`MATH_STRATEGY.md`).
2. Are xv6-style external checkouts acceptable for OS labs, or must every lab be executable inside the repo?
3. Is the 10-ECTS-level depth target still the bar? (Contracts assume university-level depth must not be lowered.)
