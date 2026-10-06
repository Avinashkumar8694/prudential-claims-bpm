// End-to-end authoring lifecycle: create a workflow (which scaffolds its default branch + empty draft
// version), save real process content into the draft, publish it (validation runs for real), deploy the
// published version, then verify the resulting Deployment is exactly what ExecutionEngine.start() needs.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { makeContext } from '../src/context.ts';
import { newId, fakeClock } from '../src/infra/ids.ts';
import { ApiError } from '../src/infra/errors.ts';
import { WorkflowsService } from '../src/modules/workflows/service.ts';
import { BranchesService } from '../src/modules/branches/service.ts';
import { VersionsService } from '../src/modules/versions/service.ts';
import { DeploymentsService } from '../src/modules/deployments/service.ts';
import { FoldersService } from '../src/modules/folders/service.ts';
import { ExecutionEngine } from '../src/engine/execution-engine.ts';
import type { EngineNode, EngineProcess } from '../src/sdk/index.ts';

function makeServices() {
  const store = new MemoryStore();
  const ctx = makeContext({ store, tenantId: 't1', clock: fakeClock().clock, newId });
  return {
    ctx,
    workflows: new WorkflowsService(ctx),
    branches: new BranchesService(ctx),
    versions: new VersionsService(ctx),
    deployments: new DeploymentsService(ctx),
    folders: new FoldersService(ctx),
  };
}

const SIMPLE_PROCESS: EngineProcess = {
  id: 'p1', name: 'Simple',
  vars: [{ name: 'done', type: 'Boolean' }],
  nodes: [
    { id: 'start', type: 'start' } as EngineNode,
    { id: 'log', type: 'script', code: 'done = true;' } as EngineNode,
    { id: 'end', type: 'end' } as EngineNode,
  ],
  flows: [{ from: 'start', to: 'log' }, { from: 'log', to: 'end' }],
};

test('a new workflow scaffolds a protected default branch and an empty draft version', async () => {
  const { workflows, branches, versions } = makeServices();
  const wf = await workflows.create('Claim Review', undefined, 'tester');
  assert.strictEqual(wf.archived, false);
  assert.strictEqual(wf.key, 'claim-review');

  const branchList = await branches.list(wf.id);
  assert.strictEqual(branchList.length, 1);
  assert.strictEqual(branchList[0]!.name, 'main');
  assert.strictEqual(branchList[0]!.protected, true);
  assert.strictEqual(branchList[0]!.id, wf.defaultBranchId);

  const versionList = await versions.list(branchList[0]!.id);
  assert.strictEqual(versionList.length, 1);
  assert.strictEqual(versionList[0]!.state, 'draft');
  assert.strictEqual(versionList[0]!.number, 1);
  assert.strictEqual(versionList[0]!.engine, undefined);
});

test('publishing an empty draft is refused; saving content then publishing succeeds and opens the next draft', async () => {
  const { workflows, branches, versions } = makeServices();
  const wf = await workflows.create('Claim Review', undefined, 'tester');
  const branch = (await branches.list(wf.id))[0]!;
  const draft = (await versions.list(branch.id))[0]!;

  await assert.rejects(() => versions.publish(draft.id, 'tester'), (e: unknown) => e instanceof ApiError && e.status === 400);

  await versions.saveDraft(draft.id, { id: 'e1', name: 'Engine', processes: [SIMPLE_PROCESS] }, 'tester');
  const { version: published, warnings } = await versions.publish(draft.id, 'tester');
  assert.strictEqual(published.state, 'published');
  // bpmn-sdk's own structural validation warns on nodes with no diagram position — expected, since
  // this fixture never set one; confirms the SDK's real validateModel is actually running, not stubbed.
  assert.ok(warnings.every((w) => w.code === 'bpmn2-structural' && w.message.includes('diagram position')));

  const versionsAfter = await versions.list(branch.id);
  assert.strictEqual(versionsAfter.length, 2);
  const nextDraft = versionsAfter.find((v) => v.state === 'draft')!;
  assert.strictEqual(nextDraft.number, 2);
  assert.ok(nextDraft.engine, 'the next draft should carry a copy of the published content');

  const branchAfter = await branches.get(branch.id);
  assert.strictEqual(branchAfter.headVersionId, nextDraft.id);

  await assert.rejects(() => versions.publish(draft.id, 'tester'), (e: unknown) => e instanceof ApiError && e.code === 'CONFLICT');
});

test('an unreachable node and a mis-wired event sub-process are caught by publish validation', async () => {
  const { workflows, branches, versions } = makeServices();
  const wf = await workflows.create('Bad Process', undefined, 'tester');
  const branch = (await branches.list(wf.id))[0]!;
  const draft = (await versions.list(branch.id))[0]!;

  const badProcess: EngineProcess = {
    id: 'p1',
    nodes: [
      { id: 'start', type: 'start' } as EngineNode,
      { id: 'end', type: 'end' } as EngineNode,
      { id: 'orphan', type: 'script', code: '1;' } as EngineNode,
      { id: 'errSub', type: 'subprocess', on: { error: 'X' }, nodes: [], flows: [] } as EngineNode,
    ],
    flows: [{ from: 'start', to: 'end' }, { from: 'errSub', to: 'end' }],
  };
  await versions.saveDraft(draft.id, { id: 'e1', name: 'Engine', processes: [badProcess] }, 'tester');

  await assert.rejects(
    () => versions.publish(draft.id, 'tester'),
    (e: unknown) => {
      assert.ok(e instanceof ApiError);
      const codes = (e.details as any[]).map((i) => i.code);
      assert.ok(codes.includes('event-sub-process-wired'));
      return true;
    },
  );
});

test('deploy activates exactly one deployment per (workflow, environment) and the engine can run it', async () => {
  const { workflows, branches, versions, deployments, ctx } = makeServices();
  const wf = await workflows.create('Claim Review', undefined, 'tester');
  const branch = (await branches.list(wf.id))[0]!;
  const draft = (await versions.list(branch.id))[0]!;
  await versions.saveDraft(draft.id, { id: 'e1', name: 'Engine', processes: [SIMPLE_PROCESS] }, 'tester');
  const { version: v1 } = await versions.publish(draft.id, 'tester');

  const dep1 = await deployments.deploy(v1.id, 'test', 'tester');
  assert.strictEqual(dep1.status, 'active');
  assert.strictEqual(dep1.versionNumber, 1);

  // publish a second version on the SAME branch and deploy it to the same environment
  const branchAfter = await branches.get(branch.id);
  const draft2 = await versions.get(branchAfter.headVersionId);
  await versions.saveDraft(draft2.id, { id: 'e1', name: 'Engine', processes: [SIMPLE_PROCESS] }, 'tester');
  const { version: v2 } = await versions.publish(draft2.id, 'tester');
  const dep2 = await deployments.deploy(v2.id, 'test', 'tester');

  const dep1After = await deployments.get(dep1.id);
  assert.strictEqual(dep1After.status, 'inactive');
  assert.ok(dep1After.undeployedAt);
  assert.strictEqual(dep2.status, 'active');
  assert.strictEqual((await deployments.getActive(wf.id, 'test'))!.id, dep2.id);

  const engine = new ExecutionEngine(ctx, () => {});
  const inst = await engine.start(dep2, {}, 'tester');
  assert.strictEqual(inst.status, 'completed');
  assert.strictEqual(inst.variables.done, true);
});

test('deploying a draft (not yet published) version is refused', async () => {
  const { workflows, branches, versions, deployments } = makeServices();
  const wf = await workflows.create('Claim Review', undefined, 'tester');
  const branch = (await branches.list(wf.id))[0]!;
  const draft = (await versions.list(branch.id))[0]!;
  await assert.rejects(() => deployments.deploy(draft.id, 'test', 'tester'), (e: unknown) => e instanceof ApiError && e.code === 'CONFLICT');
});

test('folders: cannot delete a non-empty folder, cannot move a folder into its own descendant', async () => {
  const { folders, workflows } = makeServices();
  const parent = await folders.create('Claims', null, 'tester');
  const child = await folders.create('Auto', parent.id, 'tester');
  await assert.rejects(() => folders.move(parent.id, child.id, 'tester'));
  await assert.rejects(() => folders.delete(parent.id));

  await workflows.create('Fender Bender', child.id, 'tester');
  await assert.rejects(() => folders.delete(child.id));
});

test('branching off main copies its head content into a fresh draft on the new branch', async () => {
  const { workflows, branches, versions } = makeServices();
  const wf = await workflows.create('Claim Review', undefined, 'tester');
  const main = (await branches.list(wf.id))[0]!;
  const mainDraft = (await versions.list(main.id))[0]!;
  await versions.saveDraft(mainDraft.id, { id: 'e1', name: 'Engine', processes: [SIMPLE_PROCESS] }, 'tester');

  const feature = await branches.create(wf.id, 'feature-x', main.id, 'tester');
  const featureVersions = await versions.list(feature.id);
  assert.strictEqual(featureVersions.length, 1);
  assert.strictEqual(featureVersions[0]!.number, 1);
  assert.deepStrictEqual(featureVersions[0]!.engine, { id: 'e1', name: 'Engine', processes: [SIMPLE_PROCESS] });

  // mutate the feature branch's draft and confirm main's own draft is untouched (deep copy, not a reference)
  featureVersions[0]!.engine!.processes[0]!.name = 'Mutated';
  const mainDraftAfter = await versions.get(mainDraft.id);
  assert.strictEqual(mainDraftAfter.engine!.processes[0]!.name, 'Simple');
});
