// AssetsService: kind-specific `fields` payload merged onto each kind's seed() shape, scoped to keys
// the kind actually supports (its seed shape is the only schema that exists — see src/assets/types.ts).
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { AssetsService } from '../src/modules/assets/service.ts';

const newCtx = () => { let n = 0; return makeContext({ store: new MemoryStore(), tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` }); };

test('AssetsService.list reports each kind\'s nameField', async () => {
  const ctx = newCtx();
  const wf = await new WorkflowService(ctx).create({ name: 'Claims' }, 'a');
  const { kinds } = await new AssetsService(ctx).list(wf.id);
  const byKey = Object.fromEntries(kinds.map((k) => [k.key, k.nameField]));
  assert.strictEqual(byKey.forms, 'name');
  assert.strictEqual(byKey.rulesets, 'group');
  assert.strictEqual(byKey.scorecards, 'name');
});

test('AssetsService.add: a bare name still works (fields is optional)', async () => {
  const ctx = newCtx();
  const wf = await new WorkflowService(ctx).create({ name: 'Claims' }, 'a');
  const assets = new AssetsService(ctx);
  await assets.add(wf.id, 'messages', 'ClaimApproved', 'a');
  const { assets: byKind } = await assets.list(wf.id);
  assert.deepStrictEqual(byKind.messages.map((m) => m.name), ['ClaimApproved']);
});

test('AssetsService.add: kind-specific fields are merged onto the seed, scoped to that kind\'s own shape', async () => {
  const ctx = newCtx();
  const wf = await new WorkflowService(ctx).create({ name: 'Claims' }, 'a');
  const assets = new AssetsService(ctx);

  await assets.add(wf.id, 'forms', 'ClaimIntake', 'a', { model: { className: 'com.acme.ClaimIntake' } });
  await assets.add(wf.id, 'scorecards', 'RiskScore', 'a', { fact: 'Claim', baseline: '5', target: 'riskScore' });
  await assets.add(wf.id, 'rulesets', 'claim-triage', 'a'); // group IS the nameField — no extra fields needed

  const { engine } = await (assets as any).head(wf.id);
  assert.deepStrictEqual(engine.forms[0].model, { className: 'com.acme.ClaimIntake' });
  assert.strictEqual(engine.scorecards[0].fact, 'Claim');
  assert.strictEqual(engine.scorecards[0].baseline, 5, 'numeric seed fields are coerced from string input');
  assert.strictEqual(engine.scorecards[0].target, 'riskScore');
  assert.strictEqual(engine.rulesets[0].group, 'claim-triage');
});

test('AssetsService.add: fields cannot inject keys outside the kind\'s seed shape or overwrite the name field', async () => {
  const ctx = newCtx();
  const wf = await new WorkflowService(ctx).create({ name: 'Claims' }, 'a');
  const assets = new AssetsService(ctx);

  await assets.add(wf.id, 'messages', 'ClaimApproved', 'a', { name: 'Hijacked', evil: 'nope', __proto__: { polluted: true } } as any);
  const { engine } = await (assets as any).head(wf.id);
  assert.strictEqual(engine.messages[0].name, 'ClaimApproved', 'nameField itself is not overwritable via fields');
  assert.strictEqual(engine.messages[0].evil, undefined, 'keys not in the seed shape are dropped');
  assert.strictEqual(({} as any).polluted, undefined, 'no prototype pollution');
});
