# Pilot backlog — Operating Systems

Source: [`os-repair-contract.md`](../curriculum/repair-contracts/os-repair-contract.md) (audit 2026-09; **re-verify each claim against current source before acting**). Status: `OPEN` → `CLAIMED` → `REVIEW` → `ACCEPTED`/`REJECTED`. Lessons: `src/content/lessons/operating-systems/<slug>.mdx`. Existing playgrounds: Scheduler, ConditionVariable, CrashConsistency, DiskScheduling, IsolationBoundary, Interleaving, LockScalability, PageReplacement, PageTable, SystemCallPath, AllocationFailure, DeviceIO. All 12 OS playgrounds plus `src/lib/osLabModels.mjs` have deterministic model tests in `scripts/test_os_models.mjs`.

Disposition legend: **K** = keep with targeted repair; **R** = rebuild/narrow without lowering level.

## Track E — executable evidence (engineers; blocks the labs)

| ID | Unit | Status |
|---|---|---|
| OS-E1 | Decide fixture policy with owner: (a) pinned xv6-rev5 checkout instructions + patch points, (b) in-repo executable model, or both. Record in DECISIONS (`D-0009`) | ACCEPTED |
| OS-E2 | Scheduler-lab fixture: runnable WVT scheduler model with state transitions, failure injection, independent oracle that kills named wrong implementations (`src/lib/osLabModels.mjs`) | ACCEPTED |
| OS-E3 | Device-driver-lab fixture: one complete Virtio lifecycle, deterministic completion/fault oracle (`src/lib/osLabModels.mjs`) | ACCEPTED |
| OS-E4 | Filesystem-lab fixture: runnable rename core; crash extension separable (`src/lib/osLabModels.mjs`) | ACCEPTED |
| OS-E5 | Model tests for **every** shipped OS playground (extended `scripts/test_os_models.mjs`) | ACCEPTED |

## Exemplars (Phase 1, owner-approved)

| ID | Lesson | Notes | Status |
|---|---|---|---|
| OS-X1 | interleavings-and-atomicity | K. Contract example 2 (lost update, linearization) is independently solved — reuse as the model-checked trace | ACCEPTED |
| OS-X2 | page-tables-and-tlbs | K. Contract example 3 (Sv39 walk: VPN 7/12/301, offset 0x2A0, 2 MiB leaf R-X, permission failure) | ACCEPTED |

## Lessons (one writer unit each)

| ID | Lesson | Disp. | Key repair | Status |
|---|---|---|---|---|
| OS-01 | operating-system-contract | K | claim-level sources, solved exercise | ACCEPTED |
| OS-02 | traps-interrupts-system-calls | K | worked trap trace | ACCEPTED |
| OS-03 | boot-and-kernel-organization | K | | OPEN |
| OS-04 | processes-threads-context-switches | K | | OPEN |
| OS-05 | process-api-ipc-signals | K | solved fork/exec/pipe trace | ACCEPTED |
| OS-06 | cpu-scheduling | **R** | SJF/SRTF boundary: starvation example invalid for non-preemptive SJF (long job 100, short arrivals) — fix with preemptive SRTF; add solved schedules | ACCEPTED |
| OS-07 | locks-and-memory-ordering | K | worked enqueue trace + preservation derivation | ACCEPTED |
| OS-08 | condition-variables-and-semaphores | K | | OPEN |
| OS-09 | deadlock-liveness-priority-inversion | K | | OPEN |
| OS-10 | address-spaces-and-translation | K | covered every `##` heading with formal/worked artifacts | ACCEPTED |
| OS-11 | page-faults-cow-mmap | K | covered every `##` heading with formal/worked artifacts | ACCEPTED |
| OS-12 | replacement-working-sets-thrashing | K | covered every `##` heading with formal/worked artifacts | ACCEPTED |
| OS-13 | device-io-interrupts-dma | K | DMA crossover + worked trace | ACCEPTED |
| OS-14 | storage-devices-and-io-scheduling | K | worked scheduling trace + heading artifacts | ACCEPTED |
| OS-15 | file-system-interface-and-names | K | heading artifacts + crash/rename invariants | ACCEPTED |
| OS-16 | file-system-implementation | K | heading artifacts + layout calculation | ACCEPTED |
| OS-17 | crash-consistency-and-journaling | K | heading artifacts + redo/revoke boundaries | ACCEPTED |
| OS-18 | protection-and-authority | K | heading artifacts + capability/DAC/MAC matrix | ACCEPTED |
| OS-19 | virtual-machines | K | heading artifacts + trap-and-emulate cost model | ACCEPTED |
| OS-20 | containers-and-resource-control | K | shared-kernel counterexample + heading artifacts | ACCEPTED |
| OS-21 | multicore-scalability-observability | K | heading artifacts + coherence/RCU bounds | ACCEPTED |
| OS-22 | comparative-kernel-design | **R** | fewer systems, two complete worked traces | ACCEPTED |
| OS-23 | scheduler-lab | **R** | depends on OS-E2; runnable WVT model + xv6 path | ACCEPTED |
| OS-24 | device-driver-lab | **R** | depends on OS-E3; Virtio lifecycle + heading artifacts | ACCEPTED |
| OS-25 | file-system-lab | **R** | depends on OS-E4; fix same-inode rename: no-op, nlink stays 2 | ACCEPTED |
| OS-26 | operating-systems-capstone | **R** | depends on real prior artifacts, not prose promises | ACCEPTED |

OS-X1/X2 plus OS-01…OS-26 account for 28 lessons — verify slugs against `src/data/course-manifests/operating-systems.yml` in Phase 0 (two lessons in the manifest may map to units not listed; add units for any gap).

## Contract priorities (in order)
1. Ship or explicitly constrain executable lab fixtures and independent oracles.
2. Test every shipped OS playground model.
3. Repair the four assessment boundaries (scheduling SJF, lost update, Sv39 walk, rename identity).
4. Reduce specialist comparison breadth, keep core mechanisms.
5. Report mechanical vs pedagogical evidence separately.

## Cross-cutting (integrator only)
| ID | Task | Status |
|---|---|---|
| OS-S1 | Claim-level sources per lesson; keep xv6-rev5 pin consistent | OPEN |
| OS-S2 | OS has 0 authored Quiz/CaseStudy/CodeExercise: add only where an outcome demands unaided retrieval, per D-0005 | OPEN |
| OS-S3 | Keep `docs/curriculum/OPERATING_SYSTEMS.md`, manifest, `course-quality.json` in step after each accepted batch | OPEN |
