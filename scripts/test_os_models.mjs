import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeChild, renameEntry, requestTransition, selectWvt, weightedCharge } from '../src/components/playgrounds/osLabModels.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// The playgrounds keep their deterministic models beside the visual treatment.
// Bundle those exports for a model-only test; this does not start React or a browser.
const temp = mkdtempSync(join(tmpdir(), 'libreuni-os-models-'));
const modules = {};
try {
  for (const name of [
    'SchedulerPlayground',
    'PageReplacementPlayground',
    'PageTablePlayground',
    'CrashConsistencyPlayground',
    'ConditionVariablePlayground',
    'IsolationBoundaryPlayground',
    'DeviceIOPlayground',
    'InterleavingPlayground',
    'LockScalabilityPlayground',
    'DiskSchedulingPlayground',
    'SystemCallPathPlayground',
    'AllocationFailurePlayground',
    'AmdahlPlayground',
    'EpsilonDeltaPlayground',
    'TangentPlayground',
    'RiemannPlayground',
  ]) {
    const outfile = join(temp, `${name}.mjs`);
    buildSync({ entryPoints: [join(repositoryRoot, 'src/components/playgrounds', `${name}.tsx`)], bundle: true, format: 'esm', platform: 'node', outfile });
    modules[name] = await import(outfile);
  }

  const scheduler = modules.SchedulerPlayground.scheduleJobs;
  const jobs = [{ id: 'A', arrival: 0, burst: 8 }, { id: 'B', arrival: 0, burst: 2 }, { id: 'C', arrival: 1, burst: 1 }, { id: 'D', arrival: 2, burst: 2 }];
  const rr = scheduler(jobs, 'RR', 2, 0);
  assert.deepEqual(rr.response, [0, 2, 3, 3]);
  assert.deepEqual(rr.turnaround, [13, 4, 4, 5]);
  const costly = scheduler(jobs, 'RR', 1, 2);
  assert.equal(costly.utilization, 13 / (13 + 8 * 2));
  assert.equal(scheduler([{ id: 'A', arrival: 3, burst: 2 }], 'FCFS', 2, 0).response[0], 0);

  const replace = modules.PageReplacementPlayground.simulate;
  const belady = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5];
  assert.equal(replace(belady, 3, 'FIFO').at(-1).faults, 9);
  assert.equal(replace(belady, 4, 'FIFO').at(-1).faults, 10);
  assert.ok(replace(belady, 4, 'LRU').at(-1).faults <= replace(belady, 3, 'LRU').at(-1).faults);

  const outcome = modules.PageTablePlayground.outcome;
  assert.equal(outcome('A', 0x4a3, 'read').physical, 0x2a3);
  assert.equal(outcome('A', 0x4a3, 'read').kind, 'TLB hit');
  assert.equal(outcome('A', 0x4a3, 'execute').kind, 'protection fault');
  assert.equal(outcome('A', 0x8a3, 'read').kind, 'page fault');
  assert.equal(outcome('B', 0x4a3, 'read').physical, 0x9a3);

  const { diskAtCrash, recover } = modules.CrashConsistencyPlayground;
  for (const protocol of ['unsafe', 'ordered', 'journal', 'cow']) {
    const events = { unsafe: 3, ordered: 3, journal: 6, cow: 3 }[protocol];
    const before = recover(protocol, diskAtCrash(protocol, 0));
    assert.equal(before.state.referenced, false, `${protocol}: pre-state must remain unreferenced`);
    const after = recover(protocol, diskAtCrash(protocol, events));
    assert.equal(after.state.data, true, `${protocol}: complete update must expose data`);
    assert.equal(after.state.referenced, true, `${protocol}: complete update must expose reference`);
  }
  assert.match(recover('unsafe', diskAtCrash('unsafe', 1)).verdict, /Inconsistent/);
  assert.match(recover('journal', diskAtCrash('journal', 1)).verdict, /ignored/);
  assert.match(recover('cow', diskAtCrash('cow', 1)).verdict, /Old root/);

  // Condition variable protocol: correct trace finishes cleanly, lost wakeup
  // leaves consumer sleeping beside buffered data, and if-check violates safety.
  const cvTraces = modules.ConditionVariablePlayground.traces;
  assert.equal(cvTraces.correct.states.at(-1).consumerA, 'done');
  assert.equal(cvTraces.correct.states.at(-1).buffer.length, 0);
  assert.equal(cvTraces.lost.states.at(-1).consumerA, 'sleeping');
  assert.deepEqual(cvTraces.lost.states.at(-1).buffer, ['X']);
  const lostCheck = cvTraces.lost.states.find((state) => state.consumerA === 'running');
  assert.match(lostCheck.event, /releases the mutex before sleeping/, 'lesson: the consumer checks, then releases the mutex before sleeping');
  assert.doesNotMatch(lostCheck.event, /without holding/, 'the check is not described as unlocked');
  assert.equal(lostCheck.mutex, 'free', 'the mutex is already released in the gap');
  assert.equal(cvTraces.ifcheck.states.at(-1).consumerB, 'running');
  assert.equal(cvTraces.ifcheck.states.at(-1).buffer.length, 0);

  // Isolation boundary blast radius: tenant compromise stays local, shared
  // kernel/VMM compromise affects sibling tenant, substrate affects all layers.
  const { blastRadius } = modules.IsolationBoundaryPlayground;
  assert.deepEqual(blastRadius('container', 0).map(c => c.affected), [true, false, false, false]);
  assert.deepEqual(blastRadius('container', 1).map(c => c.affected), [true, true, true, false]);
  assert.deepEqual(blastRadius('vm', 2).map(c => c.affected), [true, true, true, true]);

  // Device I/O timing: polling busy-waits during device latency, interrupt
  // avoids busy-wait but pays copy cycles, DMA removes byte-copy cycles.
  const ioModel = modules.DeviceIOPlayground.model;
  assert.ok(ioModel('polling', 4096, 1, 100).busyWaitCycles > 0);
  assert.equal(ioModel('interrupt', 4096, 1, 100).busyWaitCycles, 0);
  assert.equal(ioModel('interrupt', 4096, 1, 100).copyCycles, 8192);
  assert.equal(ioModel('dma', 65536, 1, 100).copyCycles, 0);
  assert.ok(ioModel('dma', 65536, 1, 100).busyMs < ioModel('interrupt', 65536, 1, 100).busyMs);

  // Interleaving schedules: unsafe interleaving loses one increment, while
  // serialized critical sections and atomic fetch-add both reach 2.
  const { schedules: interleavingSchedules, run: runInterleaving } = modules.InterleavingPlayground;
  assert.equal(runInterleaving(interleavingSchedules.lost.operations, 6).counter, 1);
  assert.equal(runInterleaving(interleavingSchedules.serial.operations, 6).counter, 2);
  assert.equal(runInterleaving(interleavingSchedules.atomic.operations, 2).counter, 2);

  // Lock scalability: global lock is bounded by 1/f, sharding improves over
  // global lock, and read-heavy RCU scales beyond 8-way sharding at 16 cores.
  const lockSpeedup = modules.LockScalabilityPlayground.speedup;
  assert.equal(lockSpeedup('global', 1, 0.1, 0.9), 1);
  assert.ok(lockSpeedup('global', 64, 0.1, 0.9) < 10);
  assert.ok(lockSpeedup('sharded', 16, 0.1, 0.9) > lockSpeedup('global', 16, 0.1, 0.9));
  assert.ok(lockSpeedup('rcu', 16, 0.1, 0.9) > lockSpeedup('global', 16, 0.1, 0.9));
  assert.ok(lockSpeedup('rcu', 64, 0.3, 0.98) > lockSpeedup('sharded', 64, 0.3, 0.98));

  // Disk scheduling: SSTF reduces seek distance relative to FCFS on mixed
  // queue, and SCAN sweeps to 199 before reversing.
  const { workloads: diskWorkloads, route: diskRoute, distance: diskDistance } = modules.DiskSchedulingPlayground;
  assert.equal(diskDistance(diskRoute(diskWorkloads.mixed, 53, 'FCFS')), 640);
  assert.equal(diskDistance(diskRoute(diskWorkloads.mixed, 53, 'SSTF')), 236);
  const scanPath = diskRoute(diskWorkloads.mixed, 53, 'SCAN');
  assert.ok(scanPath.includes(199));
  assert.equal(diskDistance(scanPath), 331);

  // System-call path contract: the lesson's eight-stage xv6 read path. Trap
  // hardware switches privilege but not stack, page table, or registers;
  // validation, the first possible block, and result commit come in that
  // order, and the return resumes after the ecall.
  const { stages } = modules.SystemCallPathPlayground;
  const at = (pattern) => stages.findIndex((stage) => pattern.test(stage.actor));
  assert.equal(stages.length, 8, 'eight-stage model');
  const order = [/^Application$/, /Library wrapper/, /RISC-V trap hardware/, /trampoline entry/, /Dispatcher and read handler/, /VFS and device path/, /Kernel completion/, /Trampoline.*sret/];
  assert.deepEqual(order.map(at), [0, 1, 2, 3, 4, 5, 6, 7], 'stages follow the ecall-to-sret sequence');
  assert.deepEqual(stages.slice(0, 2).map((stage) => stage.mode), ['user', 'user'], 'the library wrapper is not the privilege boundary');
  assert.equal(stages[2].mode, 'hardware');
  assert.match(stages[2].state, /not switched by hardware/, 'hardware does not select stack, page table, or save registers');
  assert.doesNotMatch(stages[2].action, /stack|satp|saves/i, 'the trap-hardware action claims no stack, satp, or register switch');
  assert.match(stages[3].action, /Saves user registers.*kernel stack and page table/, 'trampoline software performs the switch');
  assert.ok(stages.slice(3, 7).every((stage) => stage.mode === 'kernel'), 'kernel software runs between entry and return');
  assert.equal(stages.at(-1).mode, 'kernel', 'trampoline assembly restores registers; hardware does not restore them from the trapframe');
  assert.equal(stages.filter((stage) => stage.mode === 'hardware').length, 1, 'only the ecall trap is a hardware stage');
  assert.match(stages.at(-1).action, /sret/, 'the return stage still ends in sret');
  const firstValidation = stages.findIndex((stage) => /validat/i.test(stage.action));
  assert.equal(firstValidation, at(/Dispatcher and read handler/), 'descriptor, count, and buffer are first checked in the handler stage');
  assert.ok(stages.slice(0, firstValidation).every((stage) => !/validat/i.test(stage.action)), 'trap entry is not proof of legality');
  assert.equal(stages.findIndex((stage) => /block/i.test(stage.action)), at(/VFS and device path/), 'VFS/device path is the first stage that may block');
  assert.match(stages[6].action, /Copies completed bytes.*trapframe/, 'data and result are committed before return');
  assert.match(stages[6].state, /committed before user registers or privilege are restored/, 'commit precedes the restore');
  assert.match(stages.at(-1).state, /a0 contains/, 'the result returns in a0');
  assert.match(stages.at(-1).state, /resumes after the ecall/, 'ecall return advances past the trapping instruction');

  // Allocation failure ownership: direct assignment leaks on failure, while
  // temporary-pointer pattern keeps original block reachable.
  const { ownershipState } = modules.AllocationFailurePlayground;
  assert.deepEqual(ownershipState(false, true, 96), { pointer: 'NULL', allocation: 'original 32-byte block', reachable: false });
  assert.deepEqual(ownershipState(true, true, 96), { pointer: '0x7f20', allocation: 'original 32-byte block', reachable: true });

  // Architecture Amdahl and Calculus playgrounds:
  assert.equal(modules.AmdahlPlayground.speedup(0.9, 1), 1);
  assert.ok(modules.AmdahlPlayground.speedup(0.9, 64) < 10);
  assert.equal(modules.EpsilonDeltaPlayground.deltaWindow(0.45), 0.15);
  assert.ok(Math.abs(modules.TangentPlayground.tangentSlope(0) - (-0.5)) < 1e-12);
  assert.ok(modules.RiemannPlayground.leftRiemannSum(32) > modules.RiemannPlayground.leftRiemannSum(4));

  // Scheduler lab contract: weight affects debt, ties are deterministic, and
  // child placement cannot restart below the global service frontier.
  assert.equal(weightedCharge(9, 4), 2);
  assert.equal(weightedCharge(0, 8), 1);
  assert.equal(selectWvt([{ pid: 8, vruntime: 4 }, { pid: 3, vruntime: 4 }, { pid: 2, vruntime: 7 }]).pid, 3);
  assert.equal(placeChild(12, 20), 20);
  assert.notEqual(placeChild(12, 20), 0); // kills zero-initialized-child mutant

  // Driver lab contract: the per-head lifecycle in device-driver-lab, with its
  // state names and event types. Completions are identity-checked and cannot be
  // applied twice or reaped before completion.
  let request = { id: 4, state: 'FREE', completed: false };
  for (const [event, state] of [['RESERVE', 'RESERVED'], ['BUILD', 'BUILT'], ['PUBLISH', 'PUBLISHED']]) {
    request = requestTransition(request, event).request;
    assert.equal(request.state, state, `${event} reaches ${state}`);
  }
  assert.equal(requestTransition({ ...request, completionId: 5 }, 'COMPLETE').reason, 'wrong-id');
  request = requestTransition({ ...request, completionId: 4 }, 'COMPLETE').request;
  assert.equal(request.state, 'COMPLETED');
  assert.equal(requestTransition(request, 'COMPLETE').reason, 'invalid-transition');
  request = requestTransition(request, 'REAP').request;
  assert.equal(request.state, 'REAPED');
  // Clearing the descriptor returns the head to FREE, ready for a fresh request.
  request = requestTransition(request, 'CLEAR').request;
  assert.deepEqual([request.state, request.completed], ['FREE', false]);
  // Rollback only before publication; once published, the device owns the head (I9).
  for (const state of ['RESERVED', 'BUILT']) {
    assert.equal(requestTransition({ id: 4, state, completed: false }, 'ROLLBACK').request.state, 'FREE', `ROLLBACK from ${state}`);
  }
  assert.equal(requestTransition({ id: 4, state: 'PUBLISHED', completed: false }, 'ROLLBACK').reason, 'invalid-transition');
  // Completion requires a published request.
  assert.equal(requestTransition({ id: 4, state: 'BUILT', completed: false }, 'COMPLETE').reason, 'invalid-transition');
  // The table is closed: the diagram's eight edges (FAIL shares PUBLISHED -> COMPLETED,
  // the error-status path) are the only legal moves; every other pair is rejected.
  // Events outside the diagram are walked too: a timeout may not move a head to FREE
  // (the lesson: "it may not transition directly to `FREE`"), and neither may the model's former events or an unknown one.
  const lessonEdges = {
    'FREE RESERVE': 'RESERVED', 'RESERVED BUILD': 'BUILT', 'BUILT PUBLISH': 'PUBLISHED',
    'PUBLISHED COMPLETE': 'COMPLETED', 'PUBLISHED FAIL': 'COMPLETED', 'COMPLETED REAP': 'REAPED',
    'REAPED CLEAR': 'FREE', 'RESERVED ROLLBACK': 'FREE', 'BUILT ROLLBACK': 'FREE'
  };
  for (const state of ['FREE', 'RESERVED', 'BUILT', 'PUBLISHED', 'COMPLETED', 'REAPED']) {
    for (const event of ['RESERVE', 'BUILD', 'PUBLISH', 'COMPLETE', 'FAIL', 'REAP', 'ROLLBACK', 'CLEAR', 'TIMEOUT', 'POST', 'ACCEPT', 'BOGUS']) {
      const result = requestTransition({ id: 4, state, completed: false }, event);
      const target = lessonEdges[`${state} ${event}`];
      if (target) assert.equal(result.request?.state, target, `${state} --${event}--> ${target}`);
      else assert.equal(result.reason, 'invalid-transition', `${state} --${event}--> rejected`);
    }
  }
  const inflight = { id: 4, state: 'PUBLISHED', completed: false };
  // Modelling choice: an error status ends the request exactly once, like a normal completion (the diagram's
  // "validated used entry + status" edge); it is never left in flight.
  const errored = requestTransition(inflight, 'FAIL');
  assert.deepEqual([errored.ok, errored.request.state, errored.request.completed], [true, 'COMPLETED', true]);
  assert.equal(requestTransition({ ...inflight, completed: true }, 'COMPLETE').reason, 'duplicate-completion');
  assert.equal(requestTransition({ ...inflight, completed: true }, 'FAIL').reason, 'duplicate-completion');
  // I6: the used-ring ID is checked before anything is indexed by it.
  for (const id of [-1, 1.5]) {
    for (const event of ['COMPLETE', 'FAIL']) {
      assert.equal(requestTransition({ ...inflight, id }, event).reason, 'invalid-id', `${event} with id ${id}`);
    }
  }
  assert.equal(requestTransition({ ...inflight, id: -1, completed: true }, 'COMPLETE').reason, 'invalid-id', 'ID check precedes the duplicate check');
  assert.equal(requestTransition({ ...inflight, id: 0 }, 'COMPLETE').ok, true, 'id 0 is in bounds');
  assert.equal(requestTransition(null, 'RESERVE').reason, 'invalid-state');
  // States outside the lesson's lifecycle, including the names the model used before it followed the device-driver-lab state diagram.
  for (const state of ['BOGUS', 'POSTED', 'INFLIGHT', 'COMPLETE']) {
    assert.equal(requestTransition({ id: 4, state }, 'COMPLETE').reason, 'invalid-state', `state ${state}`);
  }
  // Table lookups use own keys only: names inherited from Object.prototype are not states or events.
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(requestTransition({ id: 4, state: 'FREE', completed: false }, name).reason, 'invalid-transition', `event ${name}`);
    assert.equal(requestTransition({ id: 4, state: name, completed: false }, 'RESERVE').reason, 'invalid-state', `state ${name}`);
  }
  // Reap only consumes a completed result.
  for (const state of ['RESERVED', 'BUILT', 'PUBLISHED']) {
    assert.equal(requestTransition({ id: 4, state, completed: false }, 'REAP').reason, 'invalid-transition', `REAP from ${state}`);
  }

  // Filesystem lab contract: same-inode replacement is a no-op and ENOSPC
  // preserves the complete namespace, killing clear-first mutants.
  const namespace = { '/a/old': { inode: 20, bytes: 'x' }, '/b/new': { inode: 20, bytes: 'x' } };
  const same = renameEntry(namespace, '/a/old', '/b/new');
  assert.equal(same.reason, 'same-inode-noop');
  assert.deepEqual(same.state, namespace);
  const full = { '/a/old': { inode: 20 }, '/b/new': { inode: 44 } };
  const failed = renameEntry(full, '/a/old', '/b/new', { capacity: false });
  assert.equal(failed.reason, 'enospc');
  assert.deepEqual(failed.state, full);
  console.log('OS deterministic models: passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
