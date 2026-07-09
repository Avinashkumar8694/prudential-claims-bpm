// Business Rule task executes: DMN decision tables + basic DRL rulesets evaluated over variables.
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.js';
import { fakeClock } from '../src/infra/ids.js';
import { makeContext, type AppContext } from '../src/context.js';
import { WorkflowService } from '../src/modules/workflows/service.js';
import { VersionService } from '../src/modules/versions/service.js';
import { DeploymentService } from '../src/modules/deployments/service.js';
import { InstanceService } from '../src/modules/instances/service.js';

const newCtx = () => { let n = 0; return makeContext({ store: new MemoryStore(), tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` }); };

async function deployRun(ctx: AppContext, engineExtras: any, ruleNode: any, vars: any[], varsIn: Record<string, unknown>) {
  const wf = await new WorkflowService(ctx).create({ name: 'Rules ' + JSON.stringify(ruleNode).length }, 'a');
  const engine = {
    id: wf.key, name: wf.name, ...engineExtras,
    processes: [{ id: `${wf.key}.process`, name: wf.name, package: 'com.acme', vars,
      nodes: [{ id: 's', type: 'start' }, { id: 'r', ...ruleNode }, { id: 'e', type: 'end' }],
      flows: [{ id: 'f1', from: 's', to: 'r' }, { id: 'f2', from: 'r', to: 'e' }] }],
  };
  const d = await new VersionService(ctx).saveDraft(wf.defaultBranchId, engine as any, 'a');
  const pub = await new VersionService(ctx).publish(d.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'a');
  return new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod', variables: varsIn }, 'bob');
}

test('DMN decision table classifies via inputs → outputs (FIRST hit policy)', async () => {
  const decisions = [{ name: 'Claims', namespace: 'ns', decisions: [{
    name: 'Tier', hitPolicy: 'FIRST',
    inputs: [{ name: 'amount', type: 'number' }], outputs: [{ name: 'tier', type: 'string' }],
    rules: [{ when: { amount: { gte: 100000 } }, then: { tier: 'HIGH' } }, { when: { amount: { any: true } }, then: { tier: 'STANDARD' } }],
  }] }];
  const node = { type: 'rule', name: 'Classify', dmn: { namespace: 'ns', model: 'Claims', decision: 'Tier' } };
  const vars = [{ name: 'amount', type: 'double' }, { name: 'tier', type: 'string' }];

  const hi = await deployRun(newCtx(), { decisions }, node, vars, { amount: 250000 });
  assert.strictEqual(hi.status, 'completed');
  assert.strictEqual(hi.variables.tier, 'HIGH');

  const std = await deployRun(newCtx(), { decisions }, node, vars, { amount: 5000 });
  assert.strictEqual(std.variables.tier, 'STANDARD');
});

test('DRL ruleset fires condition → action over variables', async () => {
  const rulesets = [{ group: 'flag', rules: [{ name: 'big', when: [{ fact: 'x', where: { amount: { gt: 1000 } } }], then: [{ set: 'x', fields: { big: true } }] }] }];
  const node = { type: 'rule', name: 'Flag', ruleflowGroup: 'flag' };
  const inst = await deployRun(newCtx(), { rulesets }, node, [{ name: 'amount', type: 'double' }, { name: 'big', type: 'bool' }], { amount: 5000 });
  assert.strictEqual(inst.status, 'completed');
  assert.strictEqual(inst.variables.big, true, 'rule action set the flag');

  const noFire = await deployRun(newCtx(), { rulesets }, node, [{ name: 'amount', type: 'double' }, { name: 'big', type: 'bool' }], { amount: 10 });
  assert.notStrictEqual(noFire.variables.big, true, 'rule did not fire below threshold');
});
