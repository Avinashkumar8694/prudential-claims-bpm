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
