// Lifecycle cascade / no orphans: aborting a parent aborts its still-active child instances; a child
// that aborts/fails unblocks the waiting parent (routes to an error boundary, else fails the parent).
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { InstanceService } from '../src/modules/instances/service.ts';

function newCtx() {
  let n = 0;
  const store = new MemoryStore();
  return { store, ctx: makeContext({ store, tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` }) };
}

// A reusable child that parks at a user task, so the parent's call activity stays waiting.
const childEngine = (key: string) => ({
  id: key, name: key,
  processes: [{
    id: `${key}.process`, name: key, package: 'com.acme', vars: [],
    nodes: [
      { id: 'cs', type: 'start', name: 'Start' },
      { id: 'wait', type: 'userTask', name: 'Wait', group: 'ops' },
      { id: 'ce', type: 'end', name: 'End' },
    ],
    flows: [{ from: 'cs', to: 'wait' }, { from: 'wait', to: 'ce' }],
  }],
});

// Parent that calls the child; optional error boundary on the call node catches a child failure.
const parentEngine = (key: string, childProcId: string, withBoundary: boolean) => ({
  id: key, name: key,
  processes: [{
    id: `${key}.process`, name: key, package: 'com.acme', vars: [],
    nodes: [
      { id: 'ps', type: 'start', name: 'Start' },
      { id: 'call', type: 'call', name: 'Call child', process: childProcId },
      { id: 'pe', type: 'end', name: 'End' },
      ...(withBoundary ? [
        { id: 'bnd', type: 'boundary', name: 'on child error', on: ['call'], event: { error: '*' }, interrupting: true },
        { id: 'recover', type: 'script', lang: 'js', code: "kcontext.setVariable('recovered', true);" },
        { id: 're', type: 'end', name: 'Recovered' },
      ] : []),
    ],
    flows: [
      { from: 'ps', to: 'call' }, { from: 'call', to: 'pe' },
      ...(withBoundary ? [{ from: 'bnd', to: 'recover' }, { from: 'recover', to: 're' }] : []),
    ],
  }],
});

async function deploy(ctx: any, name: string, engineFor: (key: string) => any) {
  const wf = await new WorkflowService(ctx).create({ name }, 'alice');
  const verSvc = new VersionService(ctx);
  const draft = await verSvc.saveDraft(wf.defaultBranchId, { ...engineFor(wf.key), id: wf.key } as any, 'alice');
  const { published } = await verSvc.publish(draft.id, 'alice', 'v1');
  await new DeploymentService(ctx).deploy(published.id, { environment: 'prod', activate: true }, 'alice');
  return { wf, procId: `${wf.key}.process` };
}

test('aborting a parent aborts its still-active child instance (no orphans)', async () => {
  const { ctx } = newCtx();
  const child = await deploy(ctx, 'Child', childEngine);
  const parent = await deploy(ctx, 'Parent', (k) => parentEngine(k, child.procId, false));
  const instSvc = new InstanceService(ctx);

  const p = await instSvc.start({ workflowId: parent.wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(p.status, 'waiting', 'parent waits on the child call activity');
  const kids = (await instSvc.related(p.id)).children;
  assert.strictEqual(kids.length, 1);
  assert.strictEqual(kids[0]!.status, 'waiting', 'child is active');

  await instSvc.abort(p.id, 'alice');
  assert.strictEqual((await instSvc.get(p.id)).status, 'aborted');
  assert.strictEqual((await instSvc.get(kids[0]!.id)).status, 'aborted', 'child was cascaded to aborted — no orphan');
});

test('a child that is aborted fails the waiting parent when there is no error boundary', async () => {
  const { ctx } = newCtx();
  const child = await deploy(ctx, 'Child', childEngine);
  const parent = await deploy(ctx, 'Parent', (k) => parentEngine(k, child.procId, false));
  const instSvc = new InstanceService(ctx);

  const p = await instSvc.start({ workflowId: parent.wf.id, environment: 'prod' }, 'bob');
  const kid = (await instSvc.related(p.id)).children[0]!;

  await instSvc.abort(kid.id, 'alice');
  assert.strictEqual((await instSvc.get(kid.id)).status, 'aborted');
  const reloaded = await instSvc.get(p.id);
  assert.notStrictEqual(reloaded.status, 'waiting', 'parent no longer hangs on the dead child');
  assert.strictEqual(reloaded.status, 'failed');
});

test('a child failure is caught by the parent error boundary and recovers', async () => {
  const { ctx } = newCtx();
  const child = await deploy(ctx, 'Child', childEngine);
  const parent = await deploy(ctx, 'Parent', (k) => parentEngine(k, child.procId, true));
  const instSvc = new InstanceService(ctx);

  const p = await instSvc.start({ workflowId: parent.wf.id, environment: 'prod' }, 'bob');
  const kid = (await instSvc.related(p.id)).children[0]!;

  await instSvc.abort(kid.id, 'alice');
  const reloaded = await instSvc.get(p.id);
  assert.strictEqual(reloaded.status, 'completed', 'parent recovered via the error boundary');
  assert.strictEqual(reloaded.variables.recovered, true);
});
