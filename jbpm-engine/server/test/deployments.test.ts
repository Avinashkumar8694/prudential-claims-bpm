// Cross-project deployment listing (DeploymentService.list) — powers the top-level Deployments page,
// which browses across every project the way GET /instances already does, rather than requiring one
// project to be picked first.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { ProcessService } from '../src/modules/processes/service.ts';

const newCtx = () => { let n = 0; return makeContext({ store: new MemoryStore(), tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` }); };

async function deployedWorkflow(ctx: ReturnType<typeof newCtx>, name: string, environment: string) {
  const wf = await new WorkflowService(ctx).create({ name }, 'a');
  // the seeded default process is start-only (no end, unconnected) — replace it with a minimal valid
  // start->end flow so publish's validation gate doesn't reject it.
  await new ProcessService(ctx).saveProcess(wf.id, `${wf.key}.process`, {
    id: `${wf.key}.process`, name, package: 'com.acme', vars: [],
    nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }],
    flows: [{ id: 'f1', from: 's', to: 'e' }],
  } as any, 'a');
  const versions = await new VersionService(ctx).listByBranch(wf.defaultBranchId);
  const head = versions.filter((v) => v.state === 'draft').at(-1)!;
  const pub = await new VersionService(ctx).publish(head.id, 'a');
  const dep = await new DeploymentService(ctx).deploy(pub.published.id, { environment, activate: true }, 'a');
  return { wf, dep };
}

test('DeploymentService.list: cross-project by default, filterable by workflowId/environment/status', async () => {
  const ctx = newCtx();
  const deployments = new DeploymentService(ctx);
  const { wf: wfA, dep: depA } = await deployedWorkflow(ctx, 'Alpha', 'dev');
  const { wf: wfB, dep: depB } = await deployedWorkflow(ctx, 'Beta', 'prod');

  const all = await deployments.list({});
  assert.strictEqual(all.length, 2, 'lists deployments across both projects with no filter');

  const onlyA = await deployments.list({ workflowId: wfA.id });
  assert.deepStrictEqual(onlyA.map((d) => d.id), [depA.id]);

  const onlyProd = await deployments.list({ environment: 'prod' });
  assert.deepStrictEqual(onlyProd.map((d) => d.id), [depB.id]);

  const onlyActive = await deployments.list({ status: 'active' });
  assert.strictEqual(onlyActive.length, 2, 'both were deployed with activate:true');

  await deployments.undeploy(depA.id, 'a');
  const stillActive = await deployments.list({ status: 'active' });
  assert.deepStrictEqual(stillActive.map((d) => d.id), [depB.id]);
});
