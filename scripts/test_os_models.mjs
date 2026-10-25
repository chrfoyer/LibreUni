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
  for (const name of ['SchedulerPlayground', 'PageReplacementPlayground', 'PageTablePlayground', 'CrashConsistencyPlayground', 'DiskSchedulingPlayground', 'LockScalabilityPlayground', 'DeviceIOPlayground', 'InterleavingPlayground', 'ConditionVariablePlayground', 'IsolationBoundaryPlayground', 'SystemCallPathPlayground']) {
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

  // Disk scheduling contract: the lesson's published traces, list-order SSTF
  // ties, and SCAN visiting cylinder 199 only as a needed turnaround.
  const { route, distance } = modules.DiskSchedulingPlayground;
  const mixed = [98, 183, 37, 122, 14, 124, 65, 67];
  assert.equal(distance(route(mixed, 53, 'FCFS')), 640);
  assert.deepEqual(route(mixed, 53, 'SSTF'), [53, 65, 67, 37, 14, 98, 122, 124, 183]);
  assert.equal(distance(route(mixed, 53, 'SSTF')), 236);
  assert.deepEqual(route(mixed, 53, 'SCAN'), [53, 65, 67, 98, 122, 124, 183, 199, 37, 14]);
  assert.equal(distance(route(mixed, 53, 'SCAN')), 331);
  const exercise = [90, 10, 92, 12, 160, 14, 162, 16];
  assert.equal(distance(route(exercise, 50, 'FCFS')), 870);
  assert.deepEqual(route(exercise, 50, 'SSTF'), [50, 16, 14, 12, 10, 90, 92, 160, 162]);
  assert.equal(distance(route(exercise, 50, 'SSTF')), 192);
  assert.deepEqual(route([60, 40], 50, 'SSTF'), [50, 60, 40]);
  assert.deepEqual(route([40, 60], 50, 'SSTF'), [50, 40, 60]);
  assert.deepEqual(route([70, 120], 50, 'SCAN'), [50, 70, 120]);
  assert.deepEqual(route([199, 20], 50, 'SCAN'), [50, 199, 20]);
  for (const policy of ['FCFS', 'SSTF', 'SCAN']) {
    for (const head of [0, 53, 199]) {
      const served = route(mixed, head, policy).slice(1);
      if (policy === 'SCAN' && served.includes(199)) served.splice(served.indexOf(199), 1); // sweep endpoint, not a request
      assert.deepEqual(served.sort((a, b) => a - b), [...mixed].sort((a, b) => a - b), `${policy} from ${head}: every request served exactly once`);
    }
  }

  // Lock scalability contract: the lesson's published values, the sharded
  // cap at eight active shards, and the RCU baseline sitting below 1x.
  const { speedup } = modules.LockScalabilityPlayground;
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.005, `${message}: got ${actual}, expected ${expected}`);
  near(speedup('global', 16, 0.1, 0.9), 6.4, 'global lock, 16 cores, 10% serial');
  near(speedup('global', 16, 0.08, 0.9), 7.27, 'Amdahl worked example, s=0.08');
  near(speedup('global', 8, 1 / 7, 0.9), 4, 'inverted Amdahl example, s=1/7');
  assert.ok(speedup('global', 64, 0.1, 0.9) < 10, 'global lock stays under the 1/f limit');
  assert.equal(speedup('global', 1, 0.1, 0.9), 1);
  near(speedup('sharded', 4, 0.1, 0.9), 1 / (0.1 / 4 + 0.9 / 4), 'sharded uses N shards below eight cores');
  near(speedup('sharded', 16, 0.1, 0.9), 1 / (0.1 / 8 + 0.9 / 16), 'sharded caps at eight shards');
  assert.equal(speedup('sharded', 64, 0.1, 0.9), 1 / (0.1 / 8 + 0.9 / 64));
  near(speedup('rcu', 1, 0.1, 0.9), 1 / (1 + 0.08 * 0.1 * 0.9), 'RCU R(1) = 1/(1+0.08fr)');
  assert.ok(speedup('rcu', 1, 0.1, 0.9) < 1, 'RCU starts below the common baseline');
  assert.ok(speedup('rcu', 16, 0.1, 0.1) < speedup('rcu', 16, 0.1, 0.9), 'lower read share erodes RCU');
  assert.equal(speedup('rcu', 16, 0.1, 0), speedup('global', 16, 0.1, 0), 'no reads: RCU degenerates to the global lock');

  // Device I/O contract: the lesson's 4 KiB table, the 64-byte prediction,
  // the 650-byte PIO/DMA crossover, and occupancy capped at one CPU.
  const io = modules.DeviceIOPlayground.model;
  const rounds = (actual, expected, digits, message) => assert.equal(actual.toFixed(digits), expected, message);
  const table = { polling: ['1.0439', '1.0439', '10.44'], interrupt: ['0.00330', '1.0443', '0.033'], dma: ['0.00100', '1.0420', '0.010'] };
  for (const [mode, [busy, elapsed, percent]] of Object.entries(table)) {
    const result = io(mode, 4096, 1, 100);
    rounds(result.busyMs, busy, busy.split('.')[1].length, `${mode}: busy per operation`);
    rounds(result.elapsedMs, elapsed, 4, `${mode}: elapsed per operation`);
    rounds(result.utilization * 100, percent, percent.split('.')[1].length, `${mode}: CPU occupancy`);
  }
  near(io('interrupt', 4096, 1, 100).deviceMs, 1.04096, 'device time L + 1000B/1e8');
  rounds(io('interrupt', 64, 0.1, 2000).utilization * 100, '0.122', 3, '64 B interrupt copy at 2000/s');
  rounds(io('dma', 64, 0.1, 2000).utilization * 100, '0.200', 3, '64 B DMA at 2000/s');
  assert.equal(io('interrupt', 650, 1, 100).busyMs, io('dma', 650, 1, 100).busyMs, 'PIO and DMA CPU work meet at 650 bytes');
  assert.ok(io('interrupt', 649, 1, 100).busyMs < io('dma', 649, 1, 100).busyMs, 'PIO wins below the crossover');
  assert.ok(io('interrupt', 651, 1, 100).busyMs > io('dma', 651, 1, 100).busyMs, 'DMA wins above the crossover');
  assert.equal(io('interrupt', 4096, 10, 100).busyMs, io('interrupt', 4096, 0.1, 100).busyMs, 'latency does not change interrupt CPU work');
  const overloaded = io('polling', 4096, 1, 2000);
  assert.ok(overloaded.offeredCpuLoad > 1, 'polling 1 ms at 2000/s offers more than one CPU');
  assert.equal(overloaded.utilization, 1, 'occupancy is capped at 100%');

  // Interleaving contract: the lesson's step-by-step lost-update table, the
  // counter == 2 postcondition for serialized and atomic schedules, and
  // fetch-add returning the value it replaced.
  const { run, schedules } = modules.InterleavingPlayground;
  const lostTable = [[0, null, null], [0, 0, null], [0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 1]];
  lostTable.forEach(([counter, rA, rB], step) => {
    const state = run(schedules.lost.operations, step);
    assert.deepEqual([state.counter, state.registers.A, state.registers.B], [counter, rA, rB], `lost update after ${step} events`);
  });
  assert.deepEqual(run(schedules.lost.operations, 5).completed, { A: true, B: false }, 'only A has stored after five events');
  const [aLoad, bLoad, aAdd, bAdd, aStore, bStore] = schedules.lost.operations;
  assert.equal(run([aLoad, bLoad, aAdd, bAdd, bStore, aStore], 6).counter, 1, 'stale stores lose an update in either order');
  const late = run([aLoad, bLoad, bAdd, bStore, aAdd, aStore], 6);
  assert.deepEqual([late.counter, late.registers.A], [1, 1], 'the add is local: A increments its stale register, not the committed counter');
  for (const key of ['serial', 'atomic']) {
    const final = run(schedules[key].operations, schedules[key].operations.length);
    assert.equal(final.counter, 2, `${key}: two increments committed`);
    assert.deepEqual(final.completed, { A: true, B: true }, `${key}: both threads completed`);
  }
  assert.equal(run(schedules.serial.operations, 3).counter, 1, 'serialized: A commits before B loads');
  assert.deepEqual(run(schedules.atomic.operations, 2).registers, { A: 0, B: 1 }, 'fetch-add returns the replaced value');
  assert.equal(run(schedules.lost.operations, 0).trace.length, 0);

  // Condition-variable contract: the lesson's protocol claims. Wait releases
  // the mutex and registers the waiter in one step, Mesa signal does not hand
  // over the mutex, a check-then-sleep gap loses the wakeup, and in the
  // broadcast trace consumer A's dequeue falsifies B's predicate.
  const { traces } = modules.ConditionVariablePlayground;
  const owner = { producer: 'producer', 'consumer A': 'consumerA', 'consumer B': 'consumerB' };
  for (const [key, trace] of Object.entries(traces)) {
    trace.states.forEach((state, index) => {
      if (state.mutex !== 'free') assert.equal(state[owner[state.mutex]], 'running', `${key}[${index}]: the mutex holder is the running thread`);
      const before = trace.states[index - 1];
      if (before && state.buffer.length > before.buffer.length) assert.equal(state.mutex, 'producer', `${key}[${index}]: enqueue happens under the mutex`);
    });
  }
  const correct = traces.correct.states;
  const waitIndex = correct.findIndex((state) => state.consumerA === 'blocked');
  assert.deepEqual([correct[waitIndex].mutex, correct[waitIndex].wakeup], ['free', 'armed'], 'wait releases the mutex and arms the waiter atomically');
  assert.equal(correct[waitIndex - 1].mutex, 'consumer A', 'the predicate is tested under the mutex before waiting');
  const signalled = correct[waitIndex + 1];
  assert.deepEqual([signalled.mutex, signalled.consumerA, signalled.buffer], ['producer', 'ready', ['X']], 'Mesa signal: waiter becomes ready, signaller keeps the mutex');
  const reacquired = correct.find((state, index) => index > waitIndex && state.mutex === 'consumer A');
  assert.ok(reacquired.buffer.length > 0, 'the predicate holds when the waiter reacquires');
  assert.deepEqual([correct.at(-1).buffer, correct.at(-1).producer, correct.at(-1).consumerA], [[], 'done', 'done'], 'correct trace: safety and progress');
  const lost = traces.lost.states;
  const lostSignal = lost.find((state) => state.buffer.length > 0);
  assert.notEqual(lostSignal.consumerA, 'blocked', 'no waiter is registered when the signal occurs');
  assert.equal(lostSignal.wakeup, 'lost');
  assert.ok(lost.every((state) => state.consumerA !== 'blocked' && state.wakeup !== 'armed'), 'the broken trace never registers the waiter');
  assert.deepEqual([lost.at(-1).buffer, lost.at(-1).producer, lost.at(-1).consumerA], [['X'], 'done', 'sleeping'], 'consumer sleeps forever beside available work');
  const herd = traces.ifcheck.states;
  const broadcast = herd.find((state) => state.wakeup === 'broadcast');
  assert.deepEqual([broadcast.consumerA, broadcast.consumerB, broadcast.mutex], ['ready', 'ready', 'producer'], 'broadcast readies both; neither owns the mutex');
  const falsified = herd.findIndex((state, index) => index > 0 && state.buffer.length < herd[index - 1].buffer.length);
  const bRuns = herd.findIndex((state) => state.consumerB === 'running');
  assert.equal(herd[falsified].mutex, 'consumer A', "consumer A's dequeue makes the predicate false");
  assert.ok(falsified < bRuns && herd[bRuns].buffer.length === 0, 'B reacquires after the predicate became false');

  // Isolation-boundary contract: the lesson's trust chains and blast radii.
  // Cards are tenant, peer, shared implementation, hardware; a card is
  // affected when it or a lower layer it relies on is compromised.
  const { blastRadius, models: boundaries } = modules.IsolationBoundaryPlayground;
  const affected = (boundary, depth) => blastRadius(boundary, depth).map((card) => card.affected);
  assert.equal(boundaries.container.implementation, 'Shared host kernel', 'containers share the host kernel');
  assert.equal(boundaries.vm.implementation, 'Shared VMM / hypervisor', 'VMs share the VMM');
  assert.match(boundaries.vm.stages[0], /guest kernel/, 'the guest kernel sits inside the VM boundary');
  assert.deepEqual(affected('container', 1), [true, true, true, false], 'host-kernel compromise crosses every container boundary');
  assert.deepEqual(affected('vm', 0), [true, false, false, false], 'guest-kernel compromise stays inside one VM');
  assert.deepEqual(affected('vm', 1), [true, true, true, false], 'VMM compromise loses sibling-VM isolation');
  for (const boundary of ['process', 'container', 'vm']) {
    assert.deepEqual(affected(boundary, 0), [true, false, false, false], `${boundary}: tenant compromise reaches no sibling`);
    assert.deepEqual(affected(boundary, 2), [true, true, true, true], `${boundary}: hardware compromise reaches every layer`);
    for (const depth of [0, 1, 2]) {
      const origins = blastRadius(boundary, depth).map((card, index) => card.origin ? index : -1).filter((index) => index >= 0);
      assert.deepEqual(origins, [depth === 0 ? 0 : depth + 1], `${boundary} depth ${depth}: exactly one origin at the selected layer`);
    }
  }

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
  const firstValidation = stages.findIndex((stage) => /validat/i.test(stage.action));
  assert.equal(firstValidation, at(/Dispatcher and read handler/), 'descriptor, count, and buffer are first checked in the handler stage');
  assert.ok(stages.slice(0, firstValidation).every((stage) => !/validat/i.test(stage.action)), 'trap entry is not proof of legality');
  assert.equal(stages.findIndex((stage) => /block/i.test(stage.action)), at(/VFS and device path/), 'VFS/device path is the first stage that may block');
  assert.match(stages[6].action, /Copies completed bytes.*trapframe/, 'data and result are committed before return');
  assert.match(stages[6].state, /committed before user registers or privilege are restored/, 'commit precedes the restore');
  assert.match(stages.at(-1).state, /a0 contains/, 'the result returns in a0');
  assert.match(stages.at(-1).state, /resumes after the ecall/, 'ecall return advances past the trapping instruction');

  // Scheduler lab contract: weight affects debt, ties are deterministic, and
  // child placement cannot restart below the global service frontier.
  assert.equal(weightedCharge(9, 4), 2);
  assert.equal(weightedCharge(0, 8), 1);
  assert.equal(selectWvt([{ pid: 8, vruntime: 4 }, { pid: 3, vruntime: 4 }, { pid: 2, vruntime: 7 }]).pid, 3);
  assert.equal(placeChild(12, 20), 20);
  assert.notEqual(placeChild(12, 20), 0); // kills zero-initialized-child mutant

  // Driver lab contract: completions are identity-checked and cannot be
  // applied twice or reaped before completion.
  let request = { id: 4, state: 'FREE', completed: false };
  request = requestTransition(request, 'POST').request;
  request = requestTransition(request, 'ACCEPT').request;
  assert.equal(requestTransition({ ...request, completionId: 5 }, 'COMPLETE').reason, 'wrong-id');
  request = requestTransition({ ...request, completionId: 4 }, 'COMPLETE').request;
  assert.equal(requestTransition(request, 'COMPLETE').reason, 'invalid-transition');
  assert.equal(requestTransition(request, 'REAP').request.state, 'REAPED');

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
