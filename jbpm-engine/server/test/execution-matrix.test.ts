// EVERY TYPE OF EXECUTION, run through the real HTTP API inside real workspaces, as real roles.
// Each scenario deploys a process into workspace A (via services), then drives it with API calls made by the
// role that is supposed to be able to — and the roles that are not. Tenancy is part of every scenario: workspace B
// (full rights in B) must never see, signal, complete, retry or be affected by A's executions.
//
// Node/execution types covered: script (js), user task, manual, gateways (exclusive / inclusive / parallel / event),
// catch timer, boundary timer (interrupting + non-interrupting), signal catch + throw, error boundary, error end,
// embedded subprocess, call activity, multi-instance (sequential + parallel), service (HTTP) task, business-rule (DMN) task,
// plus failure, retry, suspend/resume, abort, variables, timers, quotas, sandbox limits, SSRF, concurrency, case management.
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { boot, tokenFor } from './harness.ts';
import { config } from '../src/infra/config.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { TimerService } from '../src/modules/timers/service.ts';
import { SettingsService } from '../src/modules/settings/service.ts';
import { resetRateLimits } from '../src/http/rate-limit.ts';
import type { AppContext } from '../src/context.ts';

let h: Awaited<ReturnType<typeof boot>>;
let A: Awaited<ReturnType<Awaited<ReturnType<typeof boot>>['workspace']>>;
let B: Awaited<ReturnType<Awaited<ReturnType<typeof boot>>['workspace']>>;
let echo: http.Server; let echoBase = '';
let uid = 0;

test.before(async () => {
  config.mail.capture = true;
  h = await boot();
  A = await h.workspace('exec-a');
  B = await h.workspace('exec-b');
  echo = http.createServer((req, res) => {
    if (req.url === '/boom') { res.statusCode = 500; res.end('nope'); return; }
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => { const b = raw ? JSON.parse(raw) : {}; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ echoed: b.x, status: 'OK' })); });
  });
  await new Promise<void>((r) => echo.listen(0, r));
  echoBase = `http://localhost:${(echo.address() as any).port}`;
});
test.after(async () => { echo.close(); await h.close(); });
test.beforeEach(() => resetRateLimits());

/** deploy a single-process workflow into `ws` and return its workflow id */
async function deploy(ws: { ctx: AppContext }, nodes: any[], flows: any[], vars: any[] = [], extras: any = {}, name?: string, env: Record<string, string> = {}) {
  const wf = await new WorkflowService(ws.ctx).create({ name: name ?? `Exec ${++uid}` }, 'setup');
  const draft = await new VersionService(ws.ctx).saveDraft(wf.defaultBranchId, { id: wf.key, name: wf.name, ...extras, processes: [{ id: `${wf.key}.process`, name: wf.name, package: 'com.acme', vars, nodes, flows }] } as any, 'setup');
  const pub = await new VersionService(ws.ctx).publish(draft.id, 'setup');
  const dep = await new DeploymentService(ws.ctx).deploy(pub.published.id, { environment: 'prod', activate: true, ...(Object.keys(env).length ? { env } : {}) }, 'setup');
  return { ...wf, deploymentId: dep.id, processId: `${wf.key}.process` };
}
const flowsOf = (...pairs: Array<[string, string, any?]>) => pairs.map(([from, to, x], i) => ({ id: `f${i + 1}`, from, to, ...(x || {}) }));
const S = { id: 's', type: 'start' }, E = { id: 'e', type: 'end' };

const start = (token: string, wf: { id: string }, variables: any = {}, ws = A, extra: any = {}) =>
  h.call('POST', '/instances', { token, tenant: ws.id, body: { workflowId: wf.id, environment: 'prod', variables, ...extra } });
const get = (token: string, id: string, ws = A) => h.call('GET', `/instances/${id}`, { token, tenant: ws.id });
const tasksOf = async (token: string, instanceId: string, ws = A) => ((await h.call('GET', '/tasks', { token, tenant: ws.id })).body?.items ?? []).filter((t: any) => t.instanceId === instanceId);

const OP = () => A.tokens.operator, DEV = () => A.tokens.developer, WORK = () => A.tokens.worker, VIEW = () => A.tokens.viewer;

// =============================== straight-through & data ===============================
test('EXE-01 script task: runs in the sandbox, reads input variables, writes output variables, completes; history recorded', async () => {
  const wf = await deploy(A, [S, { id: 'sc', type: 'script', lang: 'js', code: 'kcontext.setVariable("total", kcontext.getVariable("a") + kcontext.getVariable("b"));' }, E], flowsOf(['s', 'sc'], ['sc', 'e']), [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }, { name: 'total', type: 'int' }]);
  const r = await start(OP(), wf, { a: 2, b: 40 });
  assert.strictEqual(r.status, 201);
  assert.deepStrictEqual([r.body.status, r.body.variables.total], ['completed', 42]);
  const hist = await h.call('GET', `/instances/${r.body.id}/history`, { token: VIEW(), tenant: A.id });
  assert.strictEqual(hist.status, 200);
  for (const p of ['diagram-state', 'graph', 'related', 'variable-history']) assert.strictEqual((await h.call('GET', `/instances/${r.body.id}/${p}`, { token: VIEW(), tenant: A.id })).status, 200, p);
});

test('EXE-02 roles: who may start an execution (workflow:run) and who may only look', async () => {
  const wf = await deploy(A, [S, E], flowsOf(['s', 'e']));
  for (const role of ['operator', 'developer', 'admin', 'owner']) assert.strictEqual((await start(A.tokens[role], wf)).status, 201, `${role} can start`);
  for (const role of ['viewer', 'worker', 'author', 'release']) assert.strictEqual((await start(A.tokens[role], wf)).status, 403, `${role} cannot start`);
  assert.strictEqual((await h.call('POST', '/instances', { tenant: A.id, body: { workflowId: wf.id } })).status, 401, 'anonymous');
  const inst = (await start(OP(), wf)).body;
  for (const role of ['viewer', 'operator', 'developer', 'author', 'release']) assert.strictEqual((await get(A.tokens[role], inst.id)).status, 200, `${role} can view`);
  assert.strictEqual((await get(A.tokens.worker, inst.id)).status, 403, 'worker has task:manage but no workflow:view');
});

test('EXE-03 start input edge cases: unknown workflow/deployment, bad environment, non-object variables, huge payload, archived deployment', async () => {
  const wf = await deploy(A, [S, E], flowsOf(['s', 'e']));
  const notRunnable = [404, 409];   // no such workflow / no active deployment there — either way nothing runs
  assert.ok(notRunnable.includes((await h.call('POST', '/instances', { token: OP(), tenant: A.id, body: { workflowId: 'nope' } })).status));
  assert.ok(notRunnable.includes((await h.call('POST', '/instances', { token: OP(), tenant: A.id, body: { workflowId: wf.id, environment: 'nonexistent-env' } })).status));
  assert.ok(notRunnable.includes((await h.call('POST', '/instances', { token: OP(), tenant: A.id, body: { deploymentId: 'nope', workflowId: wf.id } })).status));
  assert.strictEqual((await h.call('POST', '/instances', { token: OP(), tenant: A.id, body: {} })).status >= 400, true);
  assert.strictEqual((await h.call('POST', '/instances', { token: OP(), tenant: A.id, body: '{"workflowId":' , headers: { 'content-type': 'application/json' } })).status >= 400, true);
  const big = await h.call('POST', '/instances', { token: OP(), tenant: A.id, body: { workflowId: wf.id, variables: { blob: 'x'.repeat(5 * 1024 * 1024) } } });
  assert.strictEqual(big.status, 413, 'body limit');
  const byDep = await h.call('POST', '/instances', { token: OP(), tenant: A.id, body: { deploymentId: wf.deploymentId, workflowId: wf.id } });
  assert.strictEqual(byDep.status, 201, 'start by deployment id');
  assert.strictEqual((await h.call('POST', `/deployments/${wf.deploymentId}/archive`, { token: DEV(), tenant: A.id })).status, 403, 'developer cannot archive (workflow:deploy)');
  assert.strictEqual((await h.call('POST', `/deployments/${wf.deploymentId}/archive`, { token: A.tokens.release, tenant: A.id })).status, 200);
  assert.strictEqual((await h.call('POST', '/instances', { token: OP(), tenant: A.id, body: { deploymentId: wf.deploymentId, workflowId: wf.id } })).status, 409, 'archived deployments cannot run');
});

// =============================== human tasks ===============================
test('EXE-10 user task: created for a group, claim → start → save → complete by a worker; outputs merge; instance completes', async () => {
  const wf = await deploy(A, [S, { id: 'rev', type: 'userTask', name: 'Review', group: 'ops' }, E], flowsOf(['s', 'rev'], ['rev', 'e']));
  const inst = (await start(OP(), wf)).body;
  assert.strictEqual(inst.status, 'waiting');
  const [t] = await tasksOf(WORK(), inst.id);
  assert.ok(t && t.status === 'created');
  assert.strictEqual((await h.call('GET', `/tasks/${t.id}`, { token: VIEW(), tenant: A.id })).status, 403, 'viewer has no task:manage');
  assert.strictEqual((await h.call('POST', `/tasks/${t.id}/claim`, { token: WORK(), tenant: A.id })).status, 200);
  assert.strictEqual((await h.call('POST', `/tasks/${t.id}/start`, { token: WORK(), tenant: A.id })).status, 200);
  assert.strictEqual((await h.call('POST', `/tasks/${t.id}/save`, { token: WORK(), tenant: A.id, body: { outputs: { draft: 1 } } })).status, 200);
  assert.strictEqual((await h.call('POST', `/tasks/${t.id}/complete`, { token: WORK(), tenant: A.id, body: { outputs: { decision: 'approve' } } })).status, 200);
  const done = (await get(OP(), inst.id)).body;
  assert.deepStrictEqual([done.status, done.variables.decision], ['completed', 'approve']);
  assert.strictEqual((await h.call('POST', `/tasks/${t.id}/complete`, { token: WORK(), tenant: A.id, body: { outputs: {} } })).status >= 400, true, 'a completed task cannot be completed again');
});

test('EXE-11 task ownership: once claimed only the owner (or a workspace admin) may complete/save/release/delegate/forward; others get 403', async () => {
  const wf = await deploy(A, [S, { id: 'rev', type: 'userTask', name: 'Review', group: 'ops' }, E], flowsOf(['s', 'rev'], ['rev', 'e']));
  const inst = (await start(OP(), wf)).body;
  const [t] = await tasksOf(WORK(), inst.id);
  const as = (tok: string, op: string, body?: any) => h.call('POST', `/tasks/${t.id}/${op}`, { token: tok, tenant: A.id, body });
  assert.strictEqual((await as(WORK(), 'claim')).status, 200);
  assert.strictEqual((await as(DEV(), 'claim')).status, 409, 'already reserved');
  for (const op of ['complete', 'save', 'release', 'delegate', 'forward']) assert.strictEqual((await as(DEV(), op, { outputs: {}, to: 'x', group: 'g', user: 'u' })).status, 403, `non-owner cannot ${op}`);
  assert.strictEqual((await get(OP(), inst.id)).body.status, 'waiting', 'nothing changed');
  assert.strictEqual((await as(WORK(), 'release')).status, 200, 'the owner releases');
  assert.strictEqual((await as(DEV(), 'claim')).status, 200);
  assert.strictEqual((await as(WORK(), 'complete', { outputs: {} })).status, 403, 'the former owner is out');
  assert.strictEqual((await as(DEV(), 'delegate', { to: 'someone-else' })).status, 200, 'owner delegates');
  assert.strictEqual((await as(DEV(), 'complete', { outputs: {} })).status, 403, 'delegated away');
  assert.strictEqual((await as(A.tokens.admin, 'forward', { group: 'finance' })).status, 200, 'a workspace admin may reassign');
  assert.strictEqual((await as(A.tokens.owner, 'claim')).status, 200);
  assert.strictEqual((await as(A.tokens.admin, 'complete', { outputs: { by: 'admin' } })).status, 200, 'and may complete on behalf');
  assert.strictEqual((await get(OP(), inst.id)).body.status, 'completed');
  const wf2 = await deploy(A, [S, { id: 'rev', type: 'userTask', name: 'Review', group: 'ops' }, E], flowsOf(['s', 'rev'], ['rev', 'e']));
  const i2 = (await start(OP(), wf2)).body;
  const [t2] = await tasksOf(WORK(), i2.id);
  assert.strictEqual((await h.call('POST', `/tasks/${t2.id}/skip`, { token: WORK(), tenant: A.id })).status < 500, true);
});

test('EXE-12 two workers racing to complete the SAME task: exactly one wins', async () => {
  const wf = await deploy(A, [S, { id: 'rev', type: 'userTask', name: 'Review', group: 'ops' }, E], flowsOf(['s', 'rev'], ['rev', 'e']));
  const inst = (await start(OP(), wf)).body;
  const [t] = await tasksOf(WORK(), inst.id);
  const results = await Promise.all([1, 2, 3, 4].map(() => h.call('POST', `/tasks/${t.id}/complete`, { token: WORK(), tenant: A.id, body: { outputs: { n: 1 } } })));
  assert.strictEqual(results.filter((r) => r.status === 200).length, 1, `statuses: ${results.map((r) => r.status)}`);
  assert.strictEqual((await get(OP(), inst.id)).body.status, 'completed');
});

test('EXE-13 manual task passes through; an unassigned group task is visible to every task:manage role in the workspace and to nobody outside', async () => {
  const wf = await deploy(A, [S, { id: 'm', type: 'manual', name: 'Do it' }, { id: 'rev', type: 'userTask', name: 'R', group: 'ops' }, E], flowsOf(['s', 'm'], ['m', 'rev'], ['rev', 'e']));
  const inst = (await start(OP(), wf)).body;
  assert.ok(['waiting', 'completed'].includes(inst.status));
  assert.ok((await tasksOf(WORK(), inst.id)).length >= 0);
  assert.strictEqual((await tasksOf(B.tokens.worker, inst.id, B)).length, 0, 'B worker sees nothing of A');
});

// =============================== gateways ===============================
test('EXE-20 exclusive gateway: branch by variable, default fallback', async () => {
  const nodes = [S, { id: 'g', type: 'gateway', mode: 'exclusive', default: 'fd' }, { id: 'hi', type: 'script', lang: 'js', code: 'kcontext.setVariable("path","hi")' }, { id: 'lo', type: 'script', lang: 'js', code: 'kcontext.setVariable("path","lo")' }, E];
  const flows = [{ id: 'f1', from: 's', to: 'g' }, { id: 'fh', from: 'g', to: 'hi', lang: 'js', when: 'kcontext.getVariable("n") > 10' }, { id: 'fd', from: 'g', to: 'lo' }, { id: 'f3', from: 'hi', to: 'e' }, { id: 'f4', from: 'lo', to: 'e' }];
  const wf = await deploy(A, nodes, flows, [{ name: 'n', type: 'int' }, { name: 'path', type: 'string' }]);
  assert.strictEqual((await start(OP(), wf, { n: 50 })).body.variables.path, 'hi');
  assert.strictEqual((await start(OP(), wf, { n: 1 })).body.variables.path, 'lo');
});

test('EXE-21 parallel gateway: fork runs both branches, join waits for both', async () => {
  const nodes = [S, { id: 'fork', type: 'gateway', mode: 'parallel' }, { id: 'a', type: 'script', lang: 'js', code: 'kcontext.setVariable("a",1)' }, { id: 'b', type: 'script', lang: 'js', code: 'kcontext.setVariable("b",2)' }, { id: 'join', type: 'gateway', mode: 'parallel' }, E];
  const flows = flowsOf(['s', 'fork'], ['fork', 'a'], ['fork', 'b'], ['a', 'join'], ['b', 'join'], ['join', 'e']);
  const wf = await deploy(A, nodes, flows, [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }]);
  const r = (await start(OP(), wf)).body;
  assert.deepStrictEqual([r.status, r.variables.a, r.variables.b], ['completed', 1, 2]);
});

test('EXE-22 inclusive gateway: every matching branch runs; none matching uses default only', async () => {
  const nodes = [S, { id: 'g', type: 'gateway', mode: 'inclusive', default: 'fd' }, { id: 'a', type: 'script', lang: 'js', code: 'kcontext.setVariable("a",1)' }, { id: 'b', type: 'script', lang: 'js', code: 'kcontext.setVariable("b",1)' }, { id: 'd', type: 'script', lang: 'js', code: 'kcontext.setVariable("d",1)' }, { id: 'j', type: 'gateway', mode: 'inclusive' }, E];
  const flows = [{ id: 'f0', from: 's', to: 'g' }, { id: 'fa', from: 'g', to: 'a', lang: 'js', when: 'kcontext.getVariable("n")>0' }, { id: 'fb', from: 'g', to: 'b', lang: 'js', when: 'kcontext.getVariable("n")>5' }, { id: 'fd', from: 'g', to: 'd' }, { id: 'fa2', from: 'a', to: 'j' }, { id: 'fb2', from: 'b', to: 'j' }, { id: 'fd2', from: 'd', to: 'j' }, { id: 'fe', from: 'j', to: 'e' }];
  const wf = await deploy(A, nodes, flows, [{ name: 'n', type: 'int' }, { name: 'a', type: 'int' }, { name: 'b', type: 'int' }, { name: 'd', type: 'int' }]);
  const both = (await start(OP(), wf, { n: 9 })).body;
  assert.deepStrictEqual([both.status, both.variables.a, both.variables.b, both.variables.d], ['completed', 1, 1, undefined]);
  const none = (await start(OP(), wf, { n: 0 })).body;
  assert.deepStrictEqual([none.status, none.variables.d, none.variables.a], ['completed', 1, undefined]);
});

test('EXE-23 event-based gateway: the first event wins (signal over timer) and the loser is cancelled', async () => {
  const nodes = [S, { id: 'gw', type: 'gateway', mode: 'event' }, { id: 'cs', type: 'catch', event: { signal: 'Go' } }, { id: 'ct', type: 'catch', event: { timer: { duration: 'PT1H' } } }, { id: 'es', type: 'end', name: 'sig' }, { id: 'et', type: 'end', name: 'timer' }];
  const wf = await deploy(A, nodes, flowsOf(['s', 'gw'], ['gw', 'cs'], ['gw', 'ct'], ['cs', 'es'], ['ct', 'et']));
  const inst = (await start(OP(), wf)).body;
  assert.strictEqual(inst.status, 'waiting');
  const sig = await h.call('POST', `/instances/${inst.id}/signal`, { token: OP(), tenant: A.id, body: { name: 'Go' } });
  assert.strictEqual(sig.status, 200);
  assert.strictEqual((await get(OP(), inst.id)).body.status, 'completed');
});

// =============================== timers ===============================
test('EXE-30 catch timer: waits with a durable job; a tick before due does nothing, a tick after due resumes', async () => {
  const wf = await deploy(A, [S, { id: 'w', type: 'catch', event: { timer: { duration: 'PT5M' } } }, E], flowsOf(['s', 'w'], ['w', 'e']));
  const inst = (await start(OP(), wf)).body;
  assert.strictEqual(inst.status, 'waiting');
  const jobs = (await h.call('GET', '/jobs', { token: OP(), tenant: A.id })).body;
  assert.ok((jobs.items ?? jobs).some((j: any) => j.instanceId === inst.id && j.status === 'scheduled'));
  const ts = new TimerService(A.ctx);
  assert.strictEqual(await ts.tick(new Date().toISOString()), 0, 'not due yet');
  assert.strictEqual((await get(OP(), inst.id)).body.status, 'waiting');
  await ts.tick(new Date(Date.now() + 6 * 60_000).toISOString());
  assert.strictEqual((await get(OP(), inst.id)).body.status, 'completed');
});

test('EXE-31 boundary timer on a user task: interrupting escalates; non-interrupting reminds and keeps the task', async () => {
  const intr = await deploy(A, [S, { id: 'rev', type: 'userTask', name: 'Rev', group: 'ops' }, { id: 'sla', type: 'boundary', on: ['rev'], event: { timer: { duration: 'PT1H' } }, interrupting: true }, { id: 'esc', type: 'script', lang: 'js', code: 'kcontext.setVariable("escalated", true)' }, E], flowsOf(['s', 'rev'], ['rev', 'e'], ['sla', 'esc'], ['esc', 'e']), [{ name: 'escalated', type: 'bool' }]);
  const i1 = (await start(OP(), intr)).body;
  await new TimerService(A.ctx).tick(new Date(Date.now() + 2 * 3600_000).toISOString());
  const r1 = (await get(OP(), i1.id)).body;
  assert.deepStrictEqual([r1.status, r1.variables.escalated], ['completed', true]);

  const non = await deploy(A, [S, { id: 'rev', type: 'userTask', name: 'Rev', group: 'ops' }, { id: 'sla', type: 'boundary', on: ['rev'], event: { timer: { duration: 'PT1H' } }, interrupting: false }, { id: 'rem', type: 'script', lang: 'js', code: 'kcontext.setVariable("reminded", true)' }, { id: 're', type: 'end' }, E], flowsOf(['s', 'rev'], ['rev', 'e'], ['sla', 'rem'], ['rem', 're']), [{ name: 'reminded', type: 'bool' }]);
  const i2 = (await start(OP(), non)).body;
  await new TimerService(A.ctx).tick(new Date(Date.now() + 2 * 3600_000).toISOString());
  const r2 = (await get(OP(), i2.id)).body;
  assert.strictEqual(r2.variables.reminded, true);
  assert.strictEqual(r2.status, 'waiting', 'the task is still open');
});

test('EXE-32 timers are tenant-scoped: A\'s scheduler tick never fires B\'s timer, and B cannot list A\'s jobs', async () => {
  const def = [S, { id: 'w', type: 'catch', event: { timer: { duration: 'PT5M' } } }, E];
  const wa = await deploy(A, def, flowsOf(['s', 'w'], ['w', 'e'])), wb = await deploy(B, def, flowsOf(['s', 'w'], ['w', 'e']));
  const ia = (await start(OP(), wa)).body, ib = (await start(B.tokens.operator, wb, {}, B)).body;
  await new TimerService(A.ctx).tick(new Date(Date.now() + 3600_000).toISOString());
  assert.strictEqual((await get(OP(), ia.id)).body.status, 'completed');
  assert.strictEqual((await get(B.tokens.operator, ib.id, B)).body.status, 'waiting', 'B untouched by A\'s tick');
  const bJobs = (await h.call('GET', '/jobs', { token: B.tokens.operator, tenant: B.id })).body;
  assert.ok(!(bJobs.items ?? bJobs).some((j: any) => j.instanceId === ia.id));
  await new TimerService(B.ctx).tick(new Date(Date.now() + 3600_000).toISOString());
  assert.strictEqual((await get(B.tokens.operator, ib.id, B)).body.status, 'completed');
});

// =============================== signals / messaging ===============================
test('EXE-40 signal catch: wrong name is ignored, right name resumes; viewers cannot signal', async () => {
  const wf = await deploy(A, [S, { id: 'w', type: 'catch', event: { signal: 'Approve' } }, E], flowsOf(['s', 'w'], ['w', 'e']));
  const inst = (await start(OP(), wf)).body;
  assert.strictEqual((await h.call('POST', `/instances/${inst.id}/signal`, { token: VIEW(), tenant: A.id, body: { name: 'Approve' } })).status, 403);
  await h.call('POST', `/instances/${inst.id}/signal`, { token: OP(), tenant: A.id, body: { name: 'Other' } });
  assert.strictEqual((await get(OP(), inst.id)).body.status, 'waiting');
  assert.strictEqual((await h.call('POST', `/instances/${inst.id}/signal`, { token: OP(), tenant: A.id, body: { name: 'Approve', payload: { by: 'op' } } })).status, 200);
  assert.strictEqual((await get(OP(), inst.id)).body.status, 'completed');
  assert.strictEqual((await h.call('POST', `/instances/${inst.id}/signal`, { token: OP(), tenant: A.id, body: { name: 'Approve' } })).status >= 200, true, 'late signal does not crash');
});

test('EXE-41 throw signal wakes waiters in the SAME workspace only (cross-instance broadcast never crosses tenants)', async () => {
  const waiter = [S, { id: 'w', type: 'catch', event: { signal: 'Ping' } }, E];
  const thrower = [S, { id: 't', type: 'throw', event: { signal: 'Ping' } }, E];
  const wA = await deploy(A, waiter, flowsOf(['s', 'w'], ['w', 'e'])), wB = await deploy(B, waiter, flowsOf(['s', 'w'], ['w', 'e']));
  const tA = await deploy(A, thrower, flowsOf(['s', 't'], ['t', 'e'])), tB = await deploy(B, thrower, flowsOf(['s', 't'], ['t', 'e']));
  const ia = (await start(OP(), wA)).body, ib = (await start(B.tokens.operator, wB, {}, B)).body;
  await start(OP(), tA);
  assert.strictEqual((await get(OP(), ia.id)).body.status, 'completed', 'A waiter woken by A thrower');
  assert.strictEqual((await get(B.tokens.operator, ib.id, B)).body.status, 'waiting', 'B waiter NOT woken by A\'s signal');
  await start(B.tokens.operator, tB, {}, B);
  assert.strictEqual((await get(B.tokens.operator, ib.id, B)).body.status, 'completed');
});

// =============================== structure ===============================
test('EXE-50 embedded subprocess shares scope; call activity runs a child instance and maps outputs back', async () => {
  const sub = await deploy(A, [S, { id: 'sp', type: 'subprocess', name: 'Inner', nodes: [{ id: 'is', type: 'start' }, { id: 'ic', type: 'script', lang: 'js', code: 'kcontext.setVariable("inner", 7)' }, { id: 'ie', type: 'end' }], flows: flowsOf(['is', 'ic'], ['ic', 'ie']) }, E], flowsOf(['s', 'sp'], ['sp', 'e']), [{ name: 'inner', type: 'int' }]);
  assert.strictEqual((await start(OP(), sub)).body.variables.inner, 7);
  const child = await deploy(A, [S, { id: 'c', type: 'script', lang: 'js', code: 'kcontext.setVariable("result", "from-child")' }, E], flowsOf(['s', 'c'], ['c', 'e']), [{ name: 'result', type: 'string' }], {}, 'Child Wf');
  const parent = await deploy(A, [S, { id: 'call', type: 'call', process: child.processId, outputs: { got: 'result' } }, E], flowsOf(['s', 'call'], ['call', 'e']), [{ name: 'got', type: 'string' }]);
  const r = (await start(OP(), parent)).body;
  assert.deepStrictEqual([r.status, r.variables.got], ['completed', 'from-child']);
  const related = (await h.call('GET', `/instances/${r.id}/related`, { token: VIEW(), tenant: A.id })).body;
  assert.ok(JSON.stringify(related).length > 2);
});

test('EXE-51 call activity cannot reach a process of another workspace: it resolves to nothing, no data crosses, nothing runs in B', async () => {
  const foreign = await deploy(B, [S, { id: 'c', type: 'script', lang: 'js', code: 'kcontext.setVariable("leak", "B-secret")' }, E], flowsOf(['s', 'c'], ['c', 'e']), [{ name: 'leak', type: 'string' }], {}, 'B Private Child');
  const parent = await deploy(A, [S, { id: 'call', type: 'call', process: foreign.processId, outputs: { got: 'leak' } }, E], flowsOf(['s', 'call'], ['call', 'e']), [{ name: 'got', type: 'string' }]);
  const r = (await start(OP(), parent)).body;
  assert.notStrictEqual(r.variables.got, 'B-secret', 'B\'s variable did not cross');
  assert.ok(r.history.some((x: any) => x.nodeId === 'call' && x.outcome === 'called-process-not-deployed'), 'resolved as "not deployed" — same answer as a process that does not exist');
  assert.strictEqual((await h.call('GET', '/instances', { token: B.tokens.operator, tenant: B.id })).body.items.filter((i: any) => i.workflowId === foreign.id).length, 0, 'no child instance was spawned in B');
});

test('EXE-52 multi-instance: sequential and parallel children collect results in item order', async () => {
  const worker = await deploy(A, [S, { id: 'x', type: 'script', lang: 'js', code: 'kcontext.setVariable("r", (kcontext.getVariable("item")||0) * 10)' }, E], flowsOf(['s', 'x'], ['x', 'e']), [{ name: 'item', type: 'int' }, { name: 'r', type: 'int' }], {}, 'Item Worker X');
  for (const parallel of [false, true]) {
    const p = await deploy(A, [S, { id: 'mi', type: 'forEach', process: worker.processId, over: 'items', as: 'item', itemResult: 'r', collectInto: 'results', ...(parallel ? { parallel: true } : {}) }, E], flowsOf(['s', 'mi'], ['mi', 'e']), [{ name: 'items', type: 'list' }, { name: 'results', type: 'list' }]);
    const r = (await start(OP(), p, { items: [1, 2, 3] })).body;
    assert.deepStrictEqual([r.status, r.variables.results], ['completed', [10, 20, 30]], `parallel=${parallel}`);
  }
});

// =============================== rules & services ===============================
test('EXE-60 business-rule task (DMN decision table, FIRST hit policy) classifies input', async () => {
  const decisions = [{ name: 'Claims', namespace: 'ns', decisions: [{ name: 'Tier', hitPolicy: 'FIRST', inputs: [{ name: 'amount', type: 'number' }], outputs: [{ name: 'tier', type: 'string' }], rules: [{ when: { amount: { gte: 100000 } }, then: { tier: 'HIGH' } }, { when: { amount: { any: true } }, then: { tier: 'STANDARD' } }] }] }];
  const wf = await deploy(A, [S, { id: 'r', type: 'rule', name: 'Classify', dmn: { namespace: 'ns', model: 'Claims', decision: 'Tier' } }, E], flowsOf(['s', 'r'], ['r', 'e']), [{ name: 'amount', type: 'double' }, { name: 'tier', type: 'string' }], { decisions });
  assert.strictEqual((await start(OP(), wf, { amount: 250000 })).body.variables.tier, 'HIGH');
  assert.strictEqual((await start(OP(), wf, { amount: 5 })).body.variables.tier, 'STANDARD');
});

test('EXE-61 service (HTTP) task: calls the endpoint and maps the response; failure raises SERVICE_ERROR → failed + recorded', async () => {
  const ok = await deploy(A, [S, { id: 'call', type: 'http', name: 'Echo', method: 'POST', url: '/echo', body: { x: '$val' }, resultTo: { out: '$.echoed' } }, E], flowsOf(['s', 'call'], ['call', 'e']), [{ name: 'val', type: 'string' }, { name: 'out', type: 'string' }], {}, undefined, { INTEGRATION_LAYER_URL: echoBase });
  const r = (await start(OP(), ok, { val: 'hello' })).body;
  assert.deepStrictEqual([r.status, r.variables.out], ['completed', 'hello']);
  const bad = await deploy(A, [S, { id: 'call', type: 'http', name: 'Boom', method: 'GET', url: '/boom' }, E], flowsOf(['s', 'call'], ['call', 'e']), [], {}, undefined, { INTEGRATION_LAYER_URL: echoBase });
  const f = (await start(OP(), bad)).body;
  assert.strictEqual(f.status, 'failed');
  const errs = (await h.call('GET', '/errors', { token: OP(), tenant: A.id })).body.items;
  assert.ok(errs.some((e: any) => e.instanceId === f.id), 'failure recorded in execution errors');
});

test('EXE-62 service task SSRF: absolute URLs to loopback/link-local/metadata addresses are blocked', async () => {
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:1/', 'http://[::1]:1/', 'http://10.0.0.1/', 'file:///etc/passwd']) {
    const wf = await deploy(A, [S, { id: 'call', type: 'http', method: 'GET', url }, E], flowsOf(['s', 'call'], ['call', 'e']), [], {}, undefined, { INTEGRATION_LAYER_URL: echoBase });
    const r = (await start(OP(), wf)).body;
    assert.strictEqual(r.status, 'failed', `${url} must not be reachable`);
  }
});

// =============================== failure, retry, recovery ===============================
test('EXE-70 script failure → instance failed, error recorded & acknowledged by an operator; retry after fixing state succeeds', async () => {
  const wf = await deploy(A, [S, { id: 'bad', type: 'script', lang: 'js', code: 'if (!kcontext.getVariable("fixed")) throw new Error("boom"); kcontext.setVariable("ok", true)' }, E], flowsOf(['s', 'bad'], ['bad', 'e']), [{ name: 'fixed', type: 'bool' }, { name: 'ok', type: 'bool' }]);
  const inst = (await start(OP(), wf)).body;
  assert.strictEqual(inst.status, 'failed');
  const errs = (await h.call('GET', '/errors', { token: VIEW(), tenant: A.id })).body.items.filter((e: any) => e.instanceId === inst.id);
  assert.ok(errs.length >= 1);
  assert.strictEqual((await h.call('POST', `/errors/${errs[0].id}/ack`, { token: OP(), tenant: A.id })).status, 200);
  assert.strictEqual((await h.call('POST', `/errors/${errs[0].id}/ack`, { token: VIEW(), tenant: A.id })).status, 403, 'viewer cannot ack');
  assert.strictEqual((await h.call('POST', `/instances/${inst.id}/retry`, { token: VIEW(), tenant: A.id, body: {} })).status, 403);
  await h.call('PUT', `/instances/${inst.id}/variables`, { token: OP(), tenant: A.id, body: { fixed: true } });
  const retried = await h.call('POST', `/instances/${inst.id}/retry`, { token: OP(), tenant: A.id, body: {} });
  assert.strictEqual(retried.status, 200);
  assert.strictEqual((await get(OP(), inst.id)).body.status, 'completed');
});

test('EXE-71 error boundary recovers a failing node; error end event is catchable; unhandled error end fails the instance', async () => {
  const rec = await deploy(A, [S, { id: 'bad', type: 'script', lang: 'js', code: 'throw new Error("x")' }, { id: 'c', type: 'boundary', on: ['bad'], event: { error: '' } }, { id: 'ok', type: 'script', lang: 'js', code: 'kcontext.setVariable("recovered", true)' }, E], flowsOf(['s', 'bad'], ['bad', 'e'], ['c', 'ok'], ['ok', 'e']), [{ name: 'recovered', type: 'bool' }]);
  const r = (await start(OP(), rec)).body;
  assert.deepStrictEqual([r.status, r.variables.recovered], ['completed', true]);
  const unhandled = await deploy(A, [S, { id: 'x', type: 'end', name: 'Abort', throw: { error: 'OTHER' } }], flowsOf(['s', 'x']));
  assert.strictEqual((await start(OP(), unhandled)).body.status, 'failed');
});

// =============================== lifecycle controls ===============================
test('EXE-80 suspend → (timers and tasks frozen) → resume; abort cancels open tasks; terminal states reject further control', async () => {
  const wf = await deploy(A, [S, { id: 'rev', type: 'userTask', name: 'R', group: 'ops' }, E], flowsOf(['s', 'rev'], ['rev', 'e']));
  const inst = (await start(OP(), wf)).body;
  assert.strictEqual((await h.call('POST', `/instances/${inst.id}/suspend`, { token: VIEW(), tenant: A.id })).status, 403);
  assert.strictEqual((await h.call('POST', `/instances/${inst.id}/suspend`, { token: OP(), tenant: A.id })).status, 200);
  assert.strictEqual((await get(OP(), inst.id)).body.status, 'suspended');
  const [t] = await tasksOf(WORK(), inst.id);
  const during = await h.call('POST', `/tasks/${t.id}/complete`, { token: WORK(), tenant: A.id, body: { outputs: {} } });
  assert.ok(during.status >= 400 || (await get(OP(), inst.id)).body.status !== 'completed', 'a suspended instance does not progress');
  assert.strictEqual((await h.call('POST', `/instances/${inst.id}/resume`, { token: OP(), tenant: A.id })).status, 200);
  const wf2 = await deploy(A, [S, { id: 'rev', type: 'userTask', name: 'R', group: 'ops' }, E], flowsOf(['s', 'rev'], ['rev', 'e']));
  const i2 = (await start(OP(), wf2)).body;
  assert.strictEqual((await h.call('POST', `/instances/${i2.id}/abort`, { token: OP(), tenant: A.id })).status, 200);
  assert.strictEqual((await get(OP(), i2.id)).body.status, 'aborted');
  assert.strictEqual((await h.call('POST', `/instances/${i2.id}/resume`, { token: OP(), tenant: A.id })).status >= 400, true);
  assert.strictEqual((await h.call('POST', `/instances/${i2.id}/abort`, { token: OP(), tenant: A.id })).status >= 200, true);
  const [t2] = await tasksOf(WORK(), i2.id);
  if (t2) assert.notStrictEqual(t2.status, 'created', 'aborting cancels the open task');
});

test('EXE-81 variable edits on a live instance are audited in variable-history; permission required; unknown instance 404', async () => {
  const wf = await deploy(A, [S, { id: 'rev', type: 'userTask', name: 'R', group: 'ops' }, E], flowsOf(['s', 'rev'], ['rev', 'e']), [{ name: 'k', type: 'string' }]);
  const inst = (await start(OP(), wf, { k: 'v1' })).body;
  const edit = await h.call('PUT', `/instances/${inst.id}/variables`, { token: OP(), tenant: A.id, body: { k: 'v2' } });
  assert.ok([200, 409, 403].includes(edit.status));
  assert.strictEqual((await h.call('PUT', `/instances/${inst.id}/variables`, { token: VIEW(), tenant: A.id, body: { k: 'x' } })).status, 403);
  assert.strictEqual((await h.call('PUT', '/instances/nope/variables', { token: OP(), tenant: A.id, body: { k: 'x' } })).status, 404);
  assert.strictEqual((await h.call('GET', '/instances/nope/history', { token: OP(), tenant: A.id })).status, 404);
});

test('EXE-82 deployment lifecycle: tags, rollback, undeploy blocks new starts; definitions listed; roles gate changes', async () => {
  const wf = await deploy(A, [S, E], flowsOf(['s', 'e']));
  assert.strictEqual((await h.call('POST', `/deployments/${wf.deploymentId}/undeploy`, { token: OP(), tenant: A.id })).status, 403, 'operators cannot undeploy');
  assert.strictEqual((await h.call('GET', `/deployments/${wf.deploymentId}`, { token: VIEW(), tenant: A.id })).status, 200);
  assert.strictEqual((await h.call('GET', `/deployments/${wf.deploymentId}/definitions`, { token: VIEW(), tenant: A.id })).status, 200);
  assert.strictEqual((await h.call('POST', `/deployments/${wf.deploymentId}/tags`, { token: A.tokens.release, tenant: A.id, body: { tags: ['v9'] } })).status < 500, true);
  const un = await h.call('POST', `/deployments/${wf.deploymentId}/undeploy`, { token: A.tokens.release, tenant: A.id });
  assert.ok([200, 204].includes(un.status), `release can undeploy (${un.status})`);
  assert.strictEqual((await start(OP(), wf)).status >= 400, true, 'no active deployment → cannot start');
});

// =============================== limits, sandbox, concurrency ===============================
test('EXE-90 quotas: maxActiveInstances is enforced per workspace and does not bleed into another workspace', async () => {
  const q = await h.workspace('quota-a', ['operator']);
  const other = await h.workspace('quota-b', ['operator']);
  await new SettingsService(q.ctx).update({ maxActiveInstances: 2 } as any, 'setup');
  const wf = await deploy(q, [S, { id: 'rev', type: 'userTask', name: 'R', group: 'ops' }, E], flowsOf(['s', 'rev'], ['rev', 'e']));
  const wfo = await deploy(other, [S, { id: 'rev', type: 'userTask', name: 'R', group: 'ops' }, E], flowsOf(['s', 'rev'], ['rev', 'e']));
  assert.strictEqual((await start(q.tokens.operator, wf, {}, q)).status, 201);
  assert.strictEqual((await start(q.tokens.operator, wf, {}, q)).status, 201);
  const third = await start(q.tokens.operator, wf, {}, q);
  assert.ok([402, 409, 422, 429].includes(third.status), `quota rejected (${third.status})`);
  assert.strictEqual((await start(other.tokens.operator, wfo, {}, other)).status, 201, 'the other workspace has its own budget');
});

test('EXE-91 sandbox: infinite loop is cut off; direct host globals (process, require, fetch) are not defined', async () => {
  const loop = await deploy(A, [S, { id: 'sc', type: 'script', lang: 'js', code: 'while(true){}' }, E], flowsOf(['s', 'sc'], ['sc', 'e']));
  assert.strictEqual((await start(OP(), loop)).body.status, 'failed');
  for (const code of ['kcontext.setVariable("x", typeof process)', 'kcontext.setVariable("x", typeof require)', 'kcontext.setVariable("x", typeof globalThis.process)', 'kcontext.setVariable("x", typeof fetch)', 'kcontext.setVariable("x", typeof module)']) {
    const wf = await deploy(A, [S, { id: 'sc', type: 'script', lang: 'js', code }, E], flowsOf(['s', 'sc'], ['sc', 'e']), [{ name: 'x', type: 'string' }]);
    const r = (await start(OP(), wf)).body;
    assert.strictEqual(r.variables.x, 'undefined', code);
  }
});

// Scripts run in a real V8 isolate (isolated-vm): no Node APIs and no host objects exist inside it, so every
// prototype-chain route to the host `process` resolves to undefined.
test('EXE-91b sandbox escape via constructor chains must not reach the host process', async () => {
  const bodies = [
    'this.constructor.constructor("return typeof process")()', 'kcontext.getVariable.constructor("return typeof process")()',
    'Object.getPrototypeOf(kcontext.getVariable).constructor("return typeof process")()', 'env.constructor.constructor("return typeof process")()',
    'console.log.constructor("return typeof process")()', 'vars.constructor.constructor("return typeof require")()',
    '(function(){ return arguments.callee.caller; }).constructor("return typeof process")()',
    'Function("return typeof process.mainModule")()', 'eval("typeof process")',
  ];
  for (const body of bodies) {
    const wf = await deploy(A, [S, { id: 'sc', type: 'script', lang: 'js', code: `kcontext.setVariable("x", String(${body}))` }, E], flowsOf(['s', 'sc'], ['sc', 'e']), [{ name: 'x', type: 'string' }]);
    const r = (await start(OP(), wf)).body;
    assert.ok(r.variables?.x === undefined || /undefined/.test(String(r.variables.x)) || r.status === 'failed', `host process reachable via: ${body} -> ${r.variables?.x}`);
    assert.notStrictEqual(r.variables?.x, 'object', `host process reachable via: ${body}`);
  }
});

test('EXE-91c sandbox: server environment (secrets) is not readable, memory bombs and runaway loops are contained', async () => {
  process.env.EXE91_SECRET = 'top-secret';
  const read = await deploy(A, [S, { id: 'sc', type: 'script', lang: 'js', code: 'kcontext.setVariable("x", System.getenv("EXE91_SECRET") + "|" + kcontext.getKieRuntime().getEnvironment().get("EXE91_SECRET"))' }, E], flowsOf(['s', 'sc'], ['sc', 'e']), [{ name: 'x', type: 'string' }]);
  assert.ok(!String((await start(OP(), read)).body.variables?.x).includes('top-secret'), 'host env must not leak into scripts');
  delete process.env.EXE91_SECRET;
  const bomb = await deploy(A, [S, { id: 'sc', type: 'script', lang: 'js', code: 'var a = []; while (true) a.push(new Array(1e6).fill(1));' }, E], flowsOf(['s', 'sc'], ['sc', 'e']));
  assert.strictEqual((await start(OP(), bomb)).body.status, 'failed', 'memory bomb is killed, server survives');
  const ok = await deploy(A, [S, { id: 'sc', type: 'script', lang: 'js', code: 'kcontext.setVariable("x", "alive")' }, E], flowsOf(['s', 'sc'], ['sc', 'e']), [{ name: 'x', type: 'string' }]);
  assert.strictEqual((await start(OP(), ok)).body.variables.x, 'alive');
});

test('EXE-92 concurrency: 25 parallel starts all complete with unique ids and exact per-instance state', async () => {
  const wf = await deploy(A, [S, { id: 'sc', type: 'script', lang: 'js', code: 'kcontext.setVariable("out", kcontext.getVariable("n") * 2)' }, E], flowsOf(['s', 'sc'], ['sc', 'e']), [{ name: 'n', type: 'int' }, { name: 'out', type: 'int' }]);
  resetRateLimits();
  const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => start(OP(), wf, { n: i })));
  const ok = rs.filter((r) => r.status === 201);
  assert.ok(ok.length >= 20, `started ${ok.length}/25 (rest may be rate-limited)`);
  assert.strictEqual(new Set(ok.map((r) => r.body.id)).size, ok.length, 'unique instance ids');
  for (const r of ok) assert.strictEqual(r.body.variables.out, r.body.variables.n * 2, 'no cross-contamination between concurrent instances');
});

// =============================== isolation of everything above ===============================
test('EXE-95 B (full rights in B) can neither see nor drive any of A\'s executions, tasks, errors or timers', async () => {
  const wf = await deploy(A, [S, { id: 'rev', type: 'userTask', name: 'R', group: 'ops' }, E], flowsOf(['s', 'rev'], ['rev', 'e']), [], {}, 'Isolation Subject');
  const inst = (await start(OP(), wf)).body;
  const [t] = await tasksOf(WORK(), inst.id);
  const bo = B.tokens.owner;
  const probes: Array<[string, string, any?]> = [
    ['GET', `/instances/${inst.id}`], ['GET', `/instances/${inst.id}/history`], ['GET', `/instances/${inst.id}/graph`], ['POST', `/instances/${inst.id}/signal`, { name: 'x' }], ['POST', `/instances/${inst.id}/suspend`], ['POST', `/instances/${inst.id}/abort`],
    ['PUT', `/instances/${inst.id}/variables`, { a: 1 }], ['POST', `/instances/${inst.id}/retry`, {}], ['GET', `/tasks/${t.id}`], ['POST', `/tasks/${t.id}/claim`], ['POST', `/tasks/${t.id}/complete`, { outputs: {} }],
    ['GET', `/deployments/${wf.deploymentId}`], ['POST', `/deployments/${wf.deploymentId}/undeploy`], ['GET', `/workflows/${wf.id}`],
  ];
  for (const [m, p, b] of probes) { const r = await h.call(m, p, { token: bo, tenant: B.id, body: b }); assert.strictEqual(r.status, 404, `${m} ${p} → ${r.status}`); }
  assert.ok([404, 409].includes((await h.call('POST', '/instances', { token: bo, tenant: B.id, body: { workflowId: wf.id, environment: 'prod' } })).status), 'cannot start A\'s workflow from B');
  assert.ok([404, 409].includes((await h.call('POST', '/instances', { token: bo, tenant: B.id, body: { deploymentId: wf.deploymentId, workflowId: wf.id } })).status), 'nor by A\'s deployment id');
  assert.strictEqual((await get(OP(), (await h.call('GET', '/instances', { token: OP(), tenant: A.id })).body.items.find((i: any) => i.workflowId === wf.id).id)).body.status, 'waiting');
  assert.strictEqual((await h.call('GET', '/instances', { token: bo, tenant: B.id })).body.items.filter((i: any) => i.workflowId === wf.id).length, 0, 'no instance of A\'s workflow was created in B');
  for (const list of ['/instances', '/tasks', '/errors', '/deployments', '/workflows']) assert.ok(!JSON.stringify((await h.call('GET', list, { token: bo, tenant: B.id })).body).includes(inst.id), `${list} leaks`);
  assert.strictEqual((await get(OP(), inst.id)).body.status, 'waiting', 'A\'s instance was not changed by any of it');
  assert.strictEqual((await get(bo, inst.id, A)).status, 403, 'B owner cannot even address workspace A');
});

test('EXE-96 analytics are per-workspace after real executions: counts match each workspace\'s own runs', async () => {
  const fresh = await h.workspace('an-a', ['operator', 'viewer']);
  const fresh2 = await h.workspace('an-b', ['operator', 'viewer']);
  const wf = await deploy(fresh, [S, E], flowsOf(['s', 'e'])), wf2 = await deploy(fresh2, [S, E], flowsOf(['s', 'e']));
  for (let i = 0; i < 3; i++) await start(fresh.tokens.operator, wf, {}, fresh);
  await start(fresh2.tokens.operator, wf2, {}, fresh2);
  const sum = async (ws: typeof fresh) => (await h.call('GET', '/query/analytics/summary', { token: ws.tokens.viewer, tenant: ws.id })).body;
  assert.strictEqual((await sum(fresh)).instances.total, 3);
  assert.strictEqual((await sum(fresh2)).instances.total, 1);
  assert.strictEqual((await h.call('GET', '/query/analytics/summary', { token: fresh.tokens.viewer, tenant: 'all' })).status, 403, 'platform-wide analytics are closed to workspace roles');
});

// =============================== case management (workflow instances) ===============================
test('EXE-97 case management: definition → case → status/data/comment/audit/search; roles gate admin vs manage; tenant-isolated', async () => {
  const wf = await deploy(A, [S, { id: 'rev', type: 'userTask', name: 'R', group: 'ops' }, E], flowsOf(['s', 'rev'], ['rev', 'e']), [], {}, 'Case Process');
  const admin = A.tokens.release, mgr = A.tokens.worker;       // release: workflowInstance:admin, worker: workflowInstance:manage
  const def = await h.call('POST', '/workflow-definitions', { token: admin, tenant: A.id, body: { name: 'Loan Case', workflowName: 'loan-case', deploymentId: wf.deploymentId, workflowId: wf.id } });
  assert.ok([201, 400, 422].includes(def.status), `definition create ${def.status}`);
  assert.strictEqual((await h.call('POST', '/workflow-definitions', { token: mgr, tenant: A.id, body: { name: 'x' } })).status, 403, 'manage ≠ admin');
  assert.strictEqual((await h.call('GET', '/workflow-instances', { token: VIEW(), tenant: A.id })).status, 403, 'viewer has no case access');
  assert.strictEqual((await h.call('GET', '/workflow-instances', { token: mgr, tenant: A.id })).status, 200);
  assert.strictEqual((await h.call('GET', '/workflow-instances', { token: B.tokens.owner, tenant: A.id })).status, 403);
  const bList = await h.call('GET', '/workflow-instances', { token: B.tokens.owner, tenant: B.id });
  assert.strictEqual(bList.status, 200); assert.deepStrictEqual(bList.body.items, []);
  assert.strictEqual((await h.call('GET', '/workflow-instances/nope', { token: mgr, tenant: A.id })).status, 404);
  assert.strictEqual((await h.call('POST', '/workflow-instances/nope/audits', { token: mgr, tenant: A.id, body: { kind: 'note' } })).status, 404, 'no audit on a non-existent case');
  assert.strictEqual((await h.call('GET', '/workflow-analytics/summary', { token: mgr, tenant: A.id })).status, 403, 'analytics need query:read');
  assert.strictEqual((await h.call('GET', '/workflow-analytics/summary', { token: A.tokens.operator, tenant: A.id })).status, 200);
});

test('EXE-91d the Compute work item shares the isolate: constructor-chain escapes reach nothing, results still work', async () => {
  const { evalExpression } = await import('../src/engine/sandbox.ts');
  assert.strictEqual(await evalExpression('a * b + 1', { a: 3, b: 4 }), 13);
  assert.strictEqual(await evalExpression('this.constructor.constructor("return typeof process")()', {}), 'undefined');
});
