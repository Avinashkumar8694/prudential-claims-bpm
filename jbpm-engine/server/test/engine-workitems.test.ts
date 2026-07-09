// Work-item operation tasks execute: Compute evaluates an expression; Email simulates when no service
// URL is configured; results map back to variables.
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
async function run(ctx: AppContext, wiNode: any, vars: any[], varsIn: Record<string, unknown>) {
  const wf = await new WorkflowService(ctx).create({ name: 'WI ' + JSON.stringify(wiNode).length }, 'a');
  const draft = await new VersionService(ctx).saveDraft(wf.defaultBranchId, { id: wf.key, name: wf.name, processes: [{ id: `${wf.key}.process`, name: wf.name, package: 'com.acme', vars,
    nodes: [{ id: 's', type: 'start' }, { id: 'w', ...wiNode }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'w' }, { id: 'f2', from: 'w', to: 'e' }] }] } as any, 'a');
  const pub = await new VersionService(ctx).publish(draft.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'a');
  return new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod', variables: varsIn }, 'bob');
}

test('Compute work item evaluates an expression over params → variable', async () => {
  const inst = await run(newCtx(),
    { type: 'workItem', name: 'Double', handler: 'Compute', params: { a: '$x', expression: 'a * 2' }, resultTo: { y: 'result' } },
    [{ name: 'x', type: 'int' }, { name: 'y', type: 'int' }], { x: 21 });
  assert.strictEqual(inst.status, 'completed');
  assert.strictEqual(inst.variables.y, 42);
});

test('Email work item simulates when no service URL is configured', async () => {
  const inst = await run(newCtx(),
    { type: 'workItem', name: 'Notify', handler: 'Email', params: { to: 'a@b.com', subject: 'Hi' }, resultTo: { sent: 'sent' } },
    [{ name: 'sent', type: 'bool' }], {});
  assert.strictEqual(inst.status, 'completed');
  assert.strictEqual(inst.variables.sent, true);
});
