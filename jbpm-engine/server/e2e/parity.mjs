// Broad live feature test against the running server (:4000). Each check exercises a jBPM-equivalent
// feature end-to-end and records PASS/FAIL. Spins a local HTTP target for service tasks.
import http from 'node:http';
const B = 'http://localhost:4000/api', H = { 'content-type': 'application/json', 'x-user': 'qa' };
const api = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); const j = t ? JSON.parse(t) : {}; if (!r.ok) throw new Error(`${m} ${p} → ${r.status} ${t}`); return j; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const RUN = 'R' + Date.now().toString(36);   // unique per run (file store persists across runs)
async function check(name, fn) { try { await fn(); results.push([true, name]); } catch (e) { results.push([false, name + ' — ' + e.message]); } }
const mkwf = (name) => api('POST', '/workflows', { name: `${RUN} ${name}` });

// local HTTP target for service tasks
const srv = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => raw += c); req.on('end', () => { const b = raw ? JSON.parse(raw) : {}; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ verifierId: 'V-' + (b.amount || 0), ok: true })); }); });
await new Promise((r) => srv.listen(0, r));
const BASE = `http://localhost:${srv.address().port}`;

async function deploy(name, engine, { env, activate = true, environment = 'prod' } = {}) {
  const wf = await mkwf(name);
  const eng = typeof engine === 'function' ? engine(wf.key) : engine;
  await api('PUT', `/workflows/${wf.id}/processes/${wf.key}.process`, { process: eng });
  if (eng.__extra) for (const p of eng.__extra) await api('POST', `/workflows/${wf.id}/processes`, { name: p.name }).then((r) => api('PUT', `/workflows/${wf.id}/processes/${r.id}`, { process: { ...p.body, id: r.id } }));
  const vs = (await api('GET', `/branches/${wf.defaultBranchId}/versions`)).items;
  const pub = await api('POST', `/versions/${vs.at(-1).id}/publish`, {});
  const dep = await api('POST', `/versions/${pub.published.id}/deploy`, { environment, env, activate });
  return { wf, dep, versionId: pub.published.id };
}
const P = (key, name, nodes, flows, vars = [], extra) => ({ id: `${key}.process`, name, package: 'com.acme', vars, nodes, flows, ...(extra ? { __extra: extra } : {}) });

// 0. health + catalog
await check('health + catalog (nodes/schemas/ports via API)', async () => {
  const h = await api('GET', '/health'); if (!h.ok) throw new Error('unhealthy');
  const c = await api('GET', '/catalog/nodes');
  if (!c.nodes.length || !Object.keys(c.schemas).length) throw new Error('catalog incomplete');
  if (c.ports.start.maxIn !== 0 || c.ports.start.maxOut !== 1) throw new Error('start ports wrong: ' + JSON.stringify(c.ports.start));
  if (c.ports.end.maxOut !== 0) throw new Error('end ports wrong: ' + JSON.stringify(c.ports.end));
});

// 1. validation gate: invalid (orphan) blocks publish
await check('validation: unconnected node blocks publish (422)', async () => {
  const wf = await mkwf('QA Invalid');
  await api('PUT', `/workflows/${wf.id}/processes/${wf.key}.process`, { process: P(wf.key, 'x', [{ id: 's', type: 'start' }, { id: 'orphan', type: 'manual', name: 'Orphan' }, { id: 'e', type: 'end' }], [{ id: 'f1', from: 's', to: 'e' }]) });
  const vs = (await api('GET', `/branches/${wf.defaultBranchId}/versions`)).items;
  let blocked = false;
  try { await api('POST', `/versions/${vs.at(-1).id}/publish`, {}); } catch (e) { blocked = /422|VALIDATION/.test(e.message); }
  if (!blocked) throw new Error('publish was not blocked');
});

// 2. exclusive gateway + DMN rule + user task (HIGH path) & script + http (STANDARD path)
const claims = await deploy('QA Claims', (key) => P(key, 'Claims',
  [{ id: 's', type: 'start' }, { id: 'classify', type: 'rule', name: 'Tier', dmn: { namespace: 'ns', model: 'Tier', decision: 'Tier' } },
   { id: 'gw', type: 'gateway', mode: 'exclusive', default: 'fStd' },
   { id: 'review', type: 'userTask', name: 'Review', group: 'ops' },
   { id: 'auto', type: 'script', lang: 'js', code: 'kcontext.setVariable("decision","auto");' },
   { id: 'status', type: 'http', method: 'POST', url: '/status', body: { amount: '$amount' }, resultTo: { verifierId: '$.verifierId' } },
   { id: 'e', type: 'end' }],
  [{ id: 'f1', from: 's', to: 'classify' }, { id: 'f2', from: 'classify', to: 'gw' },
   { id: 'fHigh', from: 'gw', to: 'review', when: 'tier === "HIGH"', lang: 'js' }, { id: 'fStd', from: 'gw', to: 'auto' },
   { id: 'f3', from: 'review', to: 'e' }, { id: 'f4', from: 'auto', to: 'status' }, { id: 'f5', from: 'status', to: 'e' }],
  [{ name: 'amount', type: 'double' }, { name: 'tier', type: 'string' }, { name: 'decision', type: 'string' }, { name: 'verifierId', type: 'string' }]),
  { env: { INTEGRATION_LAYER_URL: BASE } });
// need the DMN asset on the deployed engine — add before publish is tricky; add asset then re-deploy:
await api('POST', `/workflows/${claims.wf.id}/assets`, { kind: 'decisions', name: 'Tier' });
// set the decision rules via engine PUT (patch the decisions asset)
{
  const eng = await api('GET', `/workflows/${claims.wf.id}/engine`);
  eng.decisions = [{ name: 'Tier', namespace: 'ns', decisions: [{ name: 'Tier', hitPolicy: 'FIRST', inputs: [{ name: 'amount' }], outputs: [{ name: 'tier' }], rules: [{ when: { amount: { gte: 100000 } }, then: { tier: 'HIGH' } }, { when: { amount: { any: true } }, then: { tier: 'STANDARD' } }] }] }];
  await api('PUT', `/workflows/${claims.wf.id}/processes/${claims.wf.key}.process`, { process: eng.processes[0] });
  // re-save whole engine via saveDraft path: use branch versions (saveProcess only saves the process). Add a dedicated engine save:
  await api('POST', `/branches/${claims.wf.defaultBranchId}/versions`, { engine: eng });
  const vs = (await api('GET', `/branches/${claims.wf.defaultBranchId}/versions`)).items;
  const pub = await api('POST', `/versions/${vs.at(-1).id}/publish`, {});
  await api('POST', `/versions/${pub.published.id}/deploy`, { environment: 'prod', env: { INTEGRATION_LAYER_URL: BASE }, activate: true });
}
await check('DMN rule + exclusive gateway → HIGH path waits at user task', async () => {
  const i = await api('POST', '/instances', { workflowId: claims.wf.id, environment: 'prod', variables: { amount: 250000 } });
  if (i.status !== 'waiting' || i.variables.tier !== 'HIGH') throw new Error('expected HIGH/waiting, got ' + i.status + '/' + i.variables.tier);
  const task = (await api('GET', '/tasks')).items.find((t) => t.instanceId === i.id);
  if (!task) throw new Error('no user task created');
  await api('POST', `/tasks/${task.id}/complete`, { outputs: { decision: 'approved' } });
  const done = await api('GET', `/instances/${i.id}`);
  if (done.status !== 'completed') throw new Error('not completed after task');
});
await check('script + HTTP service task (STANDARD path) maps response', async () => {
  const i = await api('POST', '/instances', { workflowId: claims.wf.id, environment: 'prod', variables: { amount: 5000 } });
  if (i.status !== 'completed') throw new Error('status ' + i.status);
  if (i.variables.decision !== 'auto') throw new Error('script did not run');
  if (i.variables.verifierId !== 'V-5000') throw new Error('http resultTo not mapped: ' + i.variables.verifierId);
});

// 3. multi-instance
const worker = await deploy('QA Worker', (key) => P(key, 'W', [{ id: 's', type: 'start' }, { id: 'sc', type: 'script', code: 'kcontext.setVariable("r",(kcontext.getVariable("item")||0)*10);' }, { id: 'e', type: 'end' }], [{ id: 'f1', from: 's', to: 'sc' }, { id: 'f2', from: 'sc', to: 'e' }], [{ name: 'item', type: 'int' }, { name: 'r', type: 'int' }]));
const batch = await deploy('QA Batch', (key) => P(key, 'B', [{ id: 's', type: 'start' }, { id: 'mi', type: 'forEach', process: `${worker.wf.key}.process`, over: 'items', as: 'item', itemResult: 'r', collectInto: 'results' }, { id: 'e', type: 'end' }], [{ id: 'f1', from: 's', to: 'mi' }, { id: 'f2', from: 'mi', to: 'e' }], [{ name: 'items', type: 'list' }, { name: 'results', type: 'list' }]));
await check('multi-instance runs child per item + collects results', async () => {
  const i = await api('POST', '/instances', { workflowId: batch.wf.id, environment: 'prod', variables: { items: [1, 2, 3] } });
  if (JSON.stringify(i.variables.results) !== '[10,20,30]') throw new Error('results ' + JSON.stringify(i.variables.results));
});

// 4. call activity + related instances
const child = await deploy('QA Child', (key) => P(key, 'C', [{ id: 's', type: 'start' }, { id: 'ap', type: 'userTask', name: 'Approve', group: 'ops' }, { id: 'e', type: 'end' }], [{ id: 'f1', from: 's', to: 'ap' }, { id: 'f2', from: 'ap', to: 'e' }]));
const parent = await deploy('QA Parent', (key) => P(key, 'PA', [{ id: 's', type: 'start' }, { id: 'call', type: 'call', process: `${child.wf.key}.process`, outputs: { result: 'decision' } }, { id: 'e', type: 'end' }], [{ id: 'f1', from: 's', to: 'call' }, { id: 'f2', from: 'call', to: 'e' }], [{ name: 'result', type: 'string' }]));
await check('call activity spawns linked child; related() shows it; parent resumes', async () => {
  const p = await api('POST', '/instances', { workflowId: parent.wf.id, environment: 'prod' });
  if (p.status !== 'waiting') throw new Error('parent should wait, got ' + p.status);
  const rel = await api('GET', `/instances/${p.id}/related`);
  if (rel.children.length !== 1) throw new Error('no linked child');
  const ct = (await api('GET', '/tasks')).items.find((t) => t.instanceId === rel.children[0].id);
  await api('POST', `/tasks/${ct.id}/complete`, { outputs: { decision: 'ok' } });
  const done = await api('GET', `/instances/${p.id}`);
  if (done.status !== 'completed' || done.variables.result !== 'ok') throw new Error('parent not resumed with output');
});

// 5. signal (throw broadcast via /signal endpoint)
const waiter = await deploy('QA Waiter', (key) => P(key, 'WA', [{ id: 's', type: 'start' }, { id: 'w', type: 'catch', event: { signal: 'Go' } }, { id: 'e', type: 'end' }], [{ id: 'f1', from: 's', to: 'w' }, { id: 'f2', from: 'w', to: 'e' }]));
await check('signal resumes a waiting instance', async () => {
  const i = await api('POST', '/instances', { workflowId: waiter.wf.id, environment: 'prod' });
  if (i.status !== 'waiting') throw new Error('should wait');
  await api('POST', `/instances/${i.id}/signal`, { name: 'Go' });
  const done = await api('GET', `/instances/${i.id}`);
  if (done.status !== 'completed') throw new Error('signal did not resume');
});

// 6. error catch (global) recovers a thrown script error
const errwf = await deploy('QA Error', (key) => P(key, 'ER', [{ id: 's', type: 'start' }, { id: 'bad', type: 'script', code: 'throw new Error("boom");' }, { id: 'g', type: 'boundary', on: ['*'], event: { error: '*' } }, { id: 'rec', type: 'manual', name: 'Recover' }, { id: 'e', type: 'end' }], [{ id: 'f1', from: 's', to: 'bad' }, { id: 'f2', from: 'bad', to: 'e' }, { id: 'f3', from: 'g', to: 'rec' }, { id: 'f4', from: 'rec', to: 'e' }]));
await check('error catch recovers a thrown error (SCRIPT_ERROR)', async () => {
  const i = await api('POST', '/instances', { workflowId: errwf.wf.id, environment: 'prod' });
  if (i.status !== 'completed') throw new Error('not recovered: ' + i.status);
  if (i.variables.errorInfo?.code !== 'SCRIPT_ERROR') throw new Error('no errorInfo');
});

// 7. timer catch fired by the durable scheduler (short duration; scheduler polls ~5s)
const timerwf = await deploy('QA Timer', (key) => P(key, 'TI', [{ id: 's', type: 'start' }, { id: 'w', type: 'catch', event: { timer: { duration: 'PT1S' } } }, { id: 'e', type: 'end' }], [{ id: 'f1', from: 's', to: 'w' }, { id: 'f2', from: 'w', to: 'e' }]));
await check('timer catch waits then the scheduler resumes it', async () => {
  const i = await api('POST', '/instances', { workflowId: timerwf.wf.id, environment: 'prod' });
  if (i.status !== 'waiting') throw new Error('should wait at timer');
  let done = i;
  for (let k = 0; k < 8 && done.status !== 'completed'; k++) { await sleep(2000); done = await api('GET', `/instances/${i.id}`); }
  if (done.status !== 'completed') throw new Error('timer never fired');
});

// 8. deployment mgmt: active-pointer swap + rollback
await check('deployment tags + active-pointer swap + rollback', async () => {
  const wf = await mkwf('QA Deploy');
  await api('PUT', `/workflows/${wf.id}/processes/${wf.key}.process`, { process: P(wf.key, 'D', [{ id: 's', type: 'start' }, { id: 't', type: 'manual' }, { id: 'e', type: 'end' }], [{ id: 'f1', from: 's', to: 't' }, { id: 'f2', from: 't', to: 'e' }]) });
  const v1 = (await api('GET', `/branches/${wf.defaultBranchId}/versions`)).items.at(-1);
  const p1 = await api('POST', `/versions/${v1.id}/publish`, {});
  const d1 = await api('POST', `/versions/${p1.published.id}/deploy`, { environment: 'staging', tags: ['v1'], activate: true });
  const v2 = (await api('GET', `/branches/${wf.defaultBranchId}/versions`)).items.at(-1);
  const p2 = await api('POST', `/versions/${v2.id}/publish`, {});
  const d2 = await api('POST', `/versions/${p2.published.id}/deploy`, { environment: 'staging', tags: ['v2'], activate: true });
  if ((await api('GET', `/deployments/${d1.id}`)).status !== 'inactive') throw new Error('d1 should be inactive after d2 activate');
  await api('POST', `/deployments/${d1.id}/rollback`, { environment: 'staging', toDeploymentId: d1.id });
  if ((await api('GET', `/deployments/${d1.id}`)).status !== 'active') throw new Error('rollback failed');
});

// 9. export a version to a jBPM kjar descriptor
await check('export version → jBPM kjar descriptor (pom + bpmn)', async () => {
  const desc = await api('GET', `/versions/${claims.versionId}/export`);
  const files = Object.keys(desc.files || {});
  if (!files.some((f) => f.endsWith('.bpmn')) || !files.some((f) => f === 'pom.xml')) throw new Error('missing kjar files: ' + files.join(','));
});

// 10. node re-trigger
await check('node re-trigger replays a node', async () => {
  const i = await api('POST', '/instances', { workflowId: waiter.wf.id, environment: 'prod' });
  await api('POST', `/instances/${i.id}/signal`, { name: 'Go' });
  const before = (await api('GET', `/instances/${i.id}`)).history.length;
  await api('POST', `/instances/${i.id}/retry`, { nodeId: 'w' });
  const after = (await api('GET', `/instances/${i.id}`)).history.length;
  if (after <= before) throw new Error('retry did not replay');
});

srv.close();
const pass = results.filter((r) => r[0]).length;
console.log('\n===== LIVE FEATURE E2E =====');
for (const [ok, name] of results) console.log(`${ok ? '✅' : '❌'} ${name}`);
console.log(`\n${pass}/${results.length} scenarios passed`);
process.exit(pass === results.length ? 0 : 1);
