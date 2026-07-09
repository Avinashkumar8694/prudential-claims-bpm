// Service (REST) task performs a real HTTP call: maps body ($var) out, maps the JSON response back via
// resultTo, and raises SERVICE_ERROR on failure (which an Error Catch can recover).
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { MemoryStore } from '../src/store/memory-store.js';
import { fakeClock } from '../src/infra/ids.js';
import { makeContext, type AppContext } from '../src/context.js';
import { WorkflowService } from '../src/modules/workflows/service.js';
import { VersionService } from '../src/modules/versions/service.js';
import { DeploymentService } from '../src/modules/deployments/service.js';
import { InstanceService } from '../src/modules/instances/service.js';

let server: http.Server; let base = '';
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/boom') { res.statusCode = 500; res.end('nope'); return; }
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ echoed: body.x, status: 'OK' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as any).port}`;
});
after(() => server.close());

const newCtx = () => { let n = 0; return makeContext({ store: new MemoryStore(), tenantId: 't1', clock: fakeClock().clock, newId: () => `id${++n}` }); };
async function deployRun(ctx: AppContext, nodes: any[], flows: any[], vars: any[], varsIn: Record<string, unknown>) {
  const wf = await new WorkflowService(ctx).create({ name: 'HTTP ' + nodes.map((n) => n.id).join('') }, 'a');
  const d = await new VersionService(ctx).saveDraft(wf.defaultBranchId, { id: wf.key, name: wf.name, processes: [{ id: `${wf.key}.process`, name: wf.name, package: 'com.acme', vars, nodes, flows }] } as any, 'a');
  const pub = await new VersionService(ctx).publish(d.id, 'a');
  await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', env: { INTEGRATION_LAYER_URL: base }, activate: true }, 'a');
  return new InstanceService(ctx).start({ workflowId: wf.id, environment: 'prod', variables: varsIn }, 'bob');
}

test('service task calls the endpoint and maps the response into a variable', async () => {
  const inst = await deployRun(newCtx(),
    [{ id: 's', type: 'start' },
     { id: 'call', type: 'http', name: 'Echo', method: 'POST', url: '/echo', body: { x: '$val' }, resultTo: { out: '$.echoed' } },
     { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'call' }, { id: 'f2', from: 'call', to: 'e' }],
    [{ name: 'val', type: 'string' }, { name: 'out', type: 'string' }], { val: 'hello' });
  assert.strictEqual(inst.status, 'completed');
  assert.strictEqual(inst.variables.out, 'hello', 'response mapped back via resultTo');
});

test('service task failure raises SERVICE_ERROR and is recovered by an Error Catch', async () => {
  const inst = await deployRun(newCtx(),
    [{ id: 's', type: 'start' },
     { id: 'call', type: 'http', name: 'Boom', method: 'GET', url: '/boom' },
     { id: 'c', type: 'boundary', name: 'On service error', on: ['call'], event: { error: 'SERVICE_ERROR' }, interrupting: true },
     { id: 'rec', type: 'manual', name: 'Fallback' }, { id: 'e', type: 'end' }],
    [{ id: 'f1', from: 's', to: 'call' }, { id: 'f2', from: 'call', to: 'e' }, { id: 'f3', from: 'c', to: 'rec' }, { id: 'f4', from: 'rec', to: 'e' }],
    [], {});
  assert.strictEqual(inst.status, 'completed', 'recovered via the error catch');
  assert.strictEqual((inst.variables['errorInfo'] as any).code, 'SERVICE_ERROR');
  assert.ok(inst.history.some((h) => h.nodeId === 'rec'));
});
