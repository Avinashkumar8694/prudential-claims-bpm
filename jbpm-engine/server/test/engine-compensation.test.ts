// Compensation: activities that complete with a compensation boundary attached are recorded; a
// compensate throw runs their handlers in reverse (LIFO) order. A ref-scoped throw compensates one.
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

const append = (frag: string) => `kcontext.setVariable('log', (kcontext.getVariable('log')||'') + '${frag}');`;

const engineOf = (key: string, ref?: string) => ({
  id: key, name: key,
  processes: [{
    id: `${key}.process`, name: key, package: 'com.acme', vars: [{ name: 'log', type: 'string' }],
    nodes: [
      { id: 'start', type: 'start', name: 'Start' },
      { id: 'A', type: 'script', lang: 'js', code: append('A') },
      { id: 'bA', type: 'boundary', name: 'compA-boundary', on: ['A'], event: { compensation: true } },
      { id: 'compA', type: 'script', lang: 'js', code: append('cA') },
      { id: 'endA', type: 'end', name: 'endA' },
      { id: 'B', type: 'script', lang: 'js', code: append('B') },
      { id: 'bB', type: 'boundary', name: 'compB-boundary', on: ['B'], event: { compensation: true } },
      { id: 'compB', type: 'script', lang: 'js', code: append('cB') },
      { id: 'endB', type: 'end', name: 'endB' },
      { id: 'comp', type: 'throw', name: 'Compensate', event: { compensation: true, ...(ref ? { ref } : {}) } },
      { id: 'end', type: 'end', name: 'End' },
    ],
    flows: [
      { from: 'start', to: 'A' }, { from: 'A', to: 'B' }, { from: 'B', to: 'comp' }, { from: 'comp', to: 'end' },
      { from: 'bA', to: 'compA' }, { from: 'compA', to: 'endA' },
      { from: 'bB', to: 'compB' }, { from: 'compB', to: 'endB' },
    ],
  }],
});

async function run(ctx: any, ref?: string) {
  const wf = await new WorkflowService(ctx).create({ name: 'Comp' }, 'alice');
  const verSvc = new VersionService(ctx);
  const draft = await verSvc.saveDraft(wf.defaultBranchId, { ...engineOf(wf.key, ref), id: wf.key } as any, 'alice');
  const { published } = await verSvc.publish(draft.id, 'alice', 'v1');
  await new DeploymentService(ctx).deploy(published.id, { environment: 'prod', activate: true }, 'alice');
  return new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
}

test('compensate throw runs handlers in reverse completion order', async () => {
  const { ctx } = newCtx();
  const inst = await run(ctx);
  assert.strictEqual(inst.status, 'completed');
  // A then B run forward; compensation runs B-handler then A-handler (LIFO)
  assert.strictEqual(inst.variables.log, 'ABcBcA');
});

test('ref-scoped compensate throw only compensates the named activity', async () => {
  const { ctx } = newCtx();
  const inst = await run(ctx, 'A');
  assert.strictEqual(inst.status, 'completed');
  assert.strictEqual(inst.variables.log, 'ABcA', 'only A was compensated');
});
