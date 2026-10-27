// Production-hardening additions: per-tenant resource quotas (maxActiveInstances/maxActiveTimers/
// maxConcurrentScripts, SystemSettings) and the SSRF guard on an HTTP service task's ABSOLUTE url
// (relative urls, appended to the operator-trusted integrationBaseUrl, are deliberately never gated —
// see infra/outbound-guard.ts and every passing test in engine-http.test.ts, which all use a relative
// url against a loopback test server and must keep working unaffected).
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryStore } from '../src/store/memory-store.ts';
import { fakeClock } from '../src/infra/ids.ts';
import { makeContext, type AppContext } from '../src/context.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { InstanceService } from '../src/modules/instances/service.ts';
import { TaskService } from '../src/modules/tasks/service.ts';
import { SettingsService } from '../src/modules/settings/service.ts';
import { Collections, type Task, type TimerJob } from '../src/domain.ts';
import { acquireScriptSlot } from '../src/infra/quotas.ts';
import { assertOutboundAllowed } from '../src/infra/outbound-guard.ts';
import { config } from '../src/infra/config.ts';
import { runScript } from '../src/engine/sandbox.ts';

const newCtx = () => { let n = 0; return makeContext({ store: new MemoryStore(), tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` }); };

async function deploy(ctx: AppContext, nodes: any[], flows: any[]) {
  const wf = await new WorkflowService(ctx).create({ name: 'Q ' + nodes.map((n) => n.id).join('') }, 'a');
  const draft = await new VersionService(ctx).saveDraft(wf.defaultBranchId, { id: wf.key, name: wf.name, processes: [{ id: `${wf.key}.process`, name: wf.name, package: 'com.acme', vars: [], nodes, flows }] } as any, 'a');
  const pub = await new VersionService(ctx).publish(draft.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'a');
  return wf;
}

test('maxActiveInstances=0 (default) is unlimited — starting many top-level instances never rejects', async () => {
  const ctx = newCtx();
  const wf = await deploy(ctx, [{ id: 's', type: 'start' }, { id: 'wait', type: 'userTask', name: 'Park', group: 'ops' }, { id: 'e', type: 'end' }], [{ id: 'f1', from: 's', to: 'wait' }, { id: 'f2', from: 'wait', to: 'e' }]);
  for (let i = 0; i < 3; i++) {
    const inst = await new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
    assert.strictEqual(inst.status, 'waiting');
  }
});

test('maxActiveInstances rejects a new top-level start once the tenant is at capacity (QUOTA_EXCEEDED)', async () => {
  const ctx = newCtx();
  await new SettingsService(ctx).update({ maxActiveInstances: 1 }, 'admin');
  const wf = await deploy(ctx, [{ id: 's', type: 'start' }, { id: 'wait', type: 'userTask', name: 'Park', group: 'ops' }, { id: 'e', type: 'end' }], [{ id: 'f1', from: 's', to: 'wait' }, { id: 'f2', from: 'wait', to: 'e' }]);
  const first = await new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(first.status, 'waiting', 'the one slot is now occupied');

  await assert.rejects(
    () => new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob'),
    (e: any) => { assert.strictEqual(e.code, 'QUOTA_EXCEEDED'); assert.strictEqual(e.status, 429); return true; },
  );

  // completing the first instance frees the slot for the next start
  const [task] = await ctx.store.repo<Task>(Collections.tasks).query((t) => t.instanceId === first.id && t.status === 'created');
  await new TaskService(ctx).complete(task!.id, {}, 'carol');
  const second = await new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(second.status, 'waiting', 'the freed slot let a new top-level start through');
});

test('maxActiveTimers rejects scheduling a new durable timer once the tenant is at capacity, and the node fails cleanly', async () => {
  const ctx = newCtx();
  await new SettingsService(ctx).update({ maxActiveTimers: 1 }, 'admin');
  const wf = await deploy(ctx,
    [{ id: 's', type: 'start' }, { id: 'wait', type: 'catch', name: 'Wait 5m', event: { timer: { duration: 'PT5M' } } }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'wait' }, { id: 'f2', from: 'wait', to: 'e' }]);

  const first = await new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(first.status, 'waiting');
  const jobs = await ctx.store.repo<TimerJob>(Collections.timers).query((t) => t.status === 'scheduled');
  assert.strictEqual(jobs.length, 1, 'the one timer slot is now occupied');

  const second = await new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(second.status, 'failed', 'no error catch present, so the quota rejection fails the instance');
  assert.match(second.error!.message, /active-timer quota exceeded/);
  const jobsAfter = await ctx.store.repo<TimerJob>(Collections.timers).query((t) => t.status === 'scheduled');
  assert.strictEqual(jobsAfter.length, 1, 'the rejected attempt never created a second TimerJob row');
});

test('maxActiveTimers rejection is a catchable, BPMN-style error like any other node failure', async () => {
  const ctx = newCtx();
  await new SettingsService(ctx).update({ maxActiveTimers: 1 }, 'admin');
  const wf = await deploy(ctx,
    [{ id: 's', type: 'start' }, { id: 'wait', type: 'catch', name: 'Wait 5m', event: { timer: { duration: 'PT5M' } } },
     { id: 'c', type: 'boundary', name: 'Global', on: ['*'], event: { error: '*' } },
     { id: 'rec', type: 'manual', name: 'Recover' }, { id: 'e', type: 'end' }, { id: 'e2', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'wait' }, { id: 'f2', from: 'wait', to: 'e' }, { id: 'f3', from: 'c', to: 'rec' }, { id: 'f4', from: 'rec', to: 'e2' }]);

  await new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  const second = await new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(second.status, 'completed', 'the global error catch recovered from the quota rejection');
  assert.strictEqual((second.variables['errorInfo'] as any).code, 'QUOTA_EXCEEDED');
  assert.ok(second.history.some((h) => h.nodeId === 'rec'));
});

test('acquireScriptSlot enforces the concurrent-script quota and releases cleanly', () => {
  const release1 = acquireScriptSlot('t1', 2);
  const release2 = acquireScriptSlot('t1', 2);
  assert.throws(() => acquireScriptSlot('t1', 2), /QUOTA_EXCEEDED|quota/i);
  release1();
  const release3 = acquireScriptSlot('t1', 2); // freed slot is reusable
  release2(); release3();
  release2(); // releasing twice is a safe no-op, never goes negative
  const release4 = acquireScriptSlot('t1', 2);
  const release5 = acquireScriptSlot('t1', 2);
  release4(); release5();
});

test('runScript honors maxConcurrentScripts when a slot is already held for that tenant', async () => {
  const held = acquireScriptSlot('t1', 1);
  await assert.rejects(
    () => runScript('vars.x = 1;', {}, 1000, { tenantId: 't1', maxConcurrentScripts: 1 }),
    /QUOTA_EXCEEDED|quota/i,
  );
  held();
  const vars: Record<string, unknown> = {};
  await runScript('vars.x = 1;', vars, 1000, { tenantId: 't1', maxConcurrentScripts: 1 });
  assert.strictEqual(vars.x, 1, 'succeeds once the slot is free, and the slot is released afterward');
  // the slot from the successful run above must have been released — a follow-up run isn't blocked
  await runScript('vars.x = 2;', vars, 1000, { tenantId: 't1', maxConcurrentScripts: 1 });
  assert.strictEqual(vars.x, 2);
});

test('assertOutboundAllowed blocks loopback/private/link-local (incl. the cloud-metadata IP) and allows a public address', async () => {
  await assert.rejects(() => assertOutboundAllowed('http://127.0.0.1:9999/x'), /blocked/);
  await assert.rejects(() => assertOutboundAllowed('http://169.254.169.254/latest/meta-data'), /blocked/);
  await assert.rejects(() => assertOutboundAllowed('http://10.0.0.5/x'), /blocked/);
  await assert.rejects(() => assertOutboundAllowed('http://192.168.1.1/x'), /blocked/);
  await assert.doesNotReject(() => assertOutboundAllowed('http://8.8.8.8/x'), 'a public literal IP is not gated');
});

test('assertOutboundAllowed allows an otherwise-blocked host once explicitly allowlisted', async () => {
  config.outboundAllowlist.push('127.0.0.1');
  try {
    await assert.doesNotReject(() => assertOutboundAllowed('http://127.0.0.1:9999/x'));
  } finally {
    config.outboundAllowlist.pop();
  }
});

test('HTTP service task: an ABSOLUTE url to a private/link-local address is SSRF-blocked without ever attempting the network call', async () => {
  const ctx = newCtx();
  const wf = await deploy(ctx,
    [{ id: 's', type: 'start' },
     { id: 'call', type: 'http', name: 'Metadata', method: 'GET', url: 'http://169.254.169.254/latest/meta-data/' },
     { id: 'c', type: 'boundary', name: 'On SSRF', on: ['call'], event: { error: 'SSRF_BLOCKED' }, interrupting: true },
     { id: 'rec', type: 'manual', name: 'Blocked' }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'call' }, { id: 'f2', from: 'call', to: 'e' }, { id: 'f3', from: 'c', to: 'rec' }, { id: 'f4', from: 'rec', to: 'e' }]);
  const inst = await new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod' }, 'bob');
  assert.strictEqual(inst.status, 'completed', 'recovered via the SSRF_BLOCKED error catch');
  assert.strictEqual((inst.variables['errorInfo'] as any).code, 'SSRF_BLOCKED');
  assert.ok(inst.history.some((h) => h.nodeId === 'rec'));
});
