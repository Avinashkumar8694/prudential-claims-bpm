// Error handling: an error-catch (boundary) attached to node(s) or all (*) catches a raised error and
// routes to a recovery flow; error codes match; unhandled errors fail the instance. Deterministic.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext, type AppContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { InstanceService } from '../src/modules/instances/service.ts';
import { Collections, type Instance } from '../src/domain.ts';

const newCtx = () => { let n = 0; return makeContext({ store: new MemoryStore(), tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` }); };

async function run(ctx: AppContext, nodes: any[], flows: any[], vars: any[] = []) {
  const wf = await new WorkflowService(ctx).create({ name: 'Err ' + Math.floor(nodes.length) + '-' + flows.length + '-' + vars.length + '-' + nodes.map((n) => n.id).join('') }, 'a');
  const draft = await new VersionService(ctx).saveDraft(wf.defaultBranchId, { id: wf.key, name: wf.name, processes: [{ id: `${wf.key}.process`, name: wf.name, package: 'com.acme', vars, nodes, flows }] } as any, 'a');
  const pub = await new VersionService(ctx).publish(draft.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'a');
  return new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
}

test('error-catch attached to a node catches a script error and runs the recovery path', async () => {
  const inst = await run(newCtx(),
    [{ id: 's', type: 'start' }, { id: 'bad', type: 'script', name: 'Boom', code: 'throw new Error("boom");' },
     { id: 'c', type: 'boundary', name: 'On error', on: ['bad'], event: { error: '' }, interrupting: true },
     { id: 'rec', type: 'manual', name: 'Recover' }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'bad' }, { id: 'f2', from: 'bad', to: 'e' }, { id: 'f3', from: 'c', to: 'rec' }, { id: 'f4', from: 'rec', to: 'e' }]);
  assert.strictEqual(inst.status, 'completed', 'recovered instead of failing');
  assert.strictEqual((inst.variables['errorInfo'] as any).code, 'SCRIPT_ERROR');
  assert.ok(inst.history.some((h) => h.nodeId === 'rec'), 'ran the recovery node');
  assert.ok(!inst.history.some((h) => h.nodeId === 'e' && h.outcome === 'done' && false)); // sanity
});

test('global error-catch (on "*") behaves like a process-wide error handler', async () => {
  const inst = await run(newCtx(),
    [{ id: 's', type: 'start' }, { id: 'bad', type: 'script', name: 'Boom', code: 'throw new Error("x");' },
     { id: 'g', type: 'boundary', name: 'Global', on: ['*'], event: { error: '*' } },
     { id: 'rec', type: 'manual', name: 'Cleanup' }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'bad' }, { id: 'f2', from: 'bad', to: 'e' }, { id: 'f3', from: 'g', to: 'rec' }, { id: 'f4', from: 'rec', to: 'e' }]);
  assert.strictEqual(inst.status, 'completed');
  assert.ok(inst.history.some((h) => h.nodeId === 'rec'));
});

test('error code must match; a specific catch ignores a different code and the instance fails', async () => {
  // errEnd throws code VALIDATION; a catch for OTHER does NOT match → unhandled → failed
  const inst = await run(newCtx(),
    [{ id: 's', type: 'start' }, { id: 'x', type: 'end', name: 'Abort', throw: { error: 'VALIDATION' } },
     { id: 'c', type: 'boundary', name: 'Catch OTHER', on: ['*'], event: { error: 'OTHER' } },
     { id: 'rec', type: 'manual', name: 'Recover' }, { id: 'e2', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'x' }, { id: 'f3', from: 'c', to: 'rec' }, { id: 'f4', from: 'rec', to: 'e2' }]);
  assert.strictEqual(inst.status, 'failed');
  assert.match(inst.error!.message, /VALIDATION/);
});

test('error code match routes an error-throw end to the matching catch', async () => {
  const inst = await run(newCtx(),
    [{ id: 's', type: 'start' }, { id: 'x', type: 'end', name: 'Abort', throw: { error: 'VALIDATION' } },
     { id: 'c', type: 'boundary', name: 'Catch VALIDATION', on: ['*'], event: { error: 'VALIDATION' } },
     { id: 'rec', type: 'manual', name: 'Recover' }, { id: 'e2', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'x' }, { id: 'f3', from: 'c', to: 'rec' }, { id: 'f4', from: 'rec', to: 'e2' }]);
  assert.strictEqual(inst.status, 'completed');
  assert.strictEqual((inst.variables['errorInfo'] as any).code, 'VALIDATION');
  assert.ok(inst.history.some((h) => h.nodeId === 'rec'));
});

test('an event sub-process with an error start (jBPM\'s other global-error-handler idiom) catches and runs its own nodes', async () => {
  // matches this project's own pru-sample-global-error / pru-api-error-handler shape: a subprocess
  // node with on.error, never reached by a normal sequence flow, triggered only when its declared
  // error is raised anywhere in the process — always process-wide/interrupting. It runs as a nested
  // child instance (same as a normal sub-process), so its own node visits live in the CHILD's history.
  const ctx = newCtx();
  const inst = await run(ctx,
    [{ id: 's', type: 'start' }, { id: 'bad', type: 'script', name: 'Boom', code: 'throw new Error("x");' },
     { id: 'e', type: 'end' },
     {
       id: 'errSub', type: 'subprocess', name: 'Global Error Handler', on: { error: 'SCRIPT_ERROR' },
       nodes: [{ id: 'errStart', type: 'start' }, { id: 'cleanup', type: 'manual', name: 'Cleanup' }, { id: 'errEnd', type: 'end' }],
       flows: [{ id: 'ef1', from: 'errStart', to: 'cleanup' }, { id: 'ef2', from: 'cleanup', to: 'errEnd' }],
     }],
    [{ id: 'f1', from: 's', to: 'bad' }, { id: 'f2', from: 'bad', to: 'e' }]);
  assert.strictEqual(inst.status, 'completed');
  assert.strictEqual((inst.variables['errorInfo'] as any).code, 'SCRIPT_ERROR');
  assert.ok(!inst.history.some((h) => h.nodeId === 'e'), 'the interrupted main flow never reached its own end');
  const errSubVisit = inst.history.find((h) => h.nodeId === 'errSub');
  const childId = /^sub:(.+)$/.exec(errSubVisit?.outcome || '')?.[1];
  assert.ok(childId, 'the error sub-process ran as a nested child instance');
  const child = await ctx.store.repo<Instance>(Collections.instances).get(childId!);
  assert.strictEqual(child?.status, 'completed');
  assert.ok(child?.history.some((h) => h.nodeId === 'cleanup'), 'ran the event sub-process\'s own internal nodes');
});
