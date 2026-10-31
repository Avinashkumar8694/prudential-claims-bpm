// End-to-end smoke test of the PRODUCTION image against Postgres (run by scripts/docker-smoke.sh):
// sign in, deploy a workflow with a Java script (real JVM) and a JS script (isolated-vm), start it, check the UTF-8
// round trip, exercise the Postgres-backed case-management endpoints and 40 parallel starts. Exits 1 on any failure.
const base = process.env.BASE_URL || 'http://localhost:4300/api';
const pw = process.env.ADMIN_PASSWORD;
const call = async (m, p, body, tok) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { s: r.status, j }; };
const out = (k, v) => console.log(k.padEnd(34), v);
const login = await call('POST', '/auth/login', { username: 'admin', password: pw });
out('login', login.s); const tok = login.j.token;
const wf = (await call('POST', '/workflows', { name: 'Docker Smoke' }, tok)).j; out('create workflow', wf.id ? 'ok' : JSON.stringify(wf));
const engine = { id: wf.key, name: wf.name, processes: [{ id: `${wf.key}.process`, name: wf.name, package: 'com.acme',
  vars: [{ name: 'javaOut', type: 'string' }, { name: 'jsOut', type: 'int' }],
  nodes: [{ id: 's', type: 'start' },
    { id: 'j', type: 'script', lang: 'java', code: 'kcontext.setVariable("javaOut", "héllo — ✓ " + (6 * 7));' },
    { id: 'js', type: 'script', lang: 'js', code: 'kcontext.setVariable("jsOut", 41 + 1);' }, { id: 'e', type: 'end' }],
  flows: [{ id: 'f1', from: 's', to: 'j' }, { id: 'f2', from: 'j', to: 'js' }, { id: 'f3', from: 'js', to: 'e' }] }] };
const draft = await call('POST', `/branches/${wf.defaultBranchId}/versions`, { engine }, tok); out('save draft', draft.s);
const pub = await call('POST', `/versions/${draft.j.id}/publish`, {}, tok); out('publish', pub.s);
const dep = await call('POST', `/versions/${pub.j.published.id}/deploy`, { environment: 'prod', activate: true }, tok); out('deploy', dep.s);
const t0 = Date.now();
const inst = await call('POST', '/instances', { workflowId: wf.id, environment: 'prod' }, tok);
out('start instance', inst.s + '  status=' + inst.j.status + '  (' + (Date.now() - t0) + ' ms incl. first JVM start)');
out('  javaOut (UTF-8 round trip)', JSON.stringify(inst.j.variables?.javaOut));
out('  jsOut', JSON.stringify(inst.j.variables?.jsOut));
if (inst.j.error) out('  error', JSON.stringify(inst.j.error).slice(0, 300));
const t1 = Date.now(); const inst2 = await call('POST', '/instances', { workflowId: wf.id, environment: 'prod' }, tok);
out('2nd instance (JVM warm)', inst2.s + '  status=' + inst2.j.status + '  (' + (Date.now() - t1) + ' ms)');
out('case mgmt: definitions (pg)', (await call('GET', '/workflow-definitions', null, tok)).s);
out('case mgmt: instances (pg)', (await call('GET', '/workflow-instances', null, tok)).s);
out('instances list', (await call('GET', '/instances', null, tok)).s);
const par = await Promise.all(Array.from({ length: 40 }, () => call('POST', '/instances', { workflowId: wf.id, environment: 'prod' }, tok)));
const codes = {}; par.forEach((r) => { codes[r.s + (r.s === 201 ? ':' + r.j.status : '')] = (codes[r.s + (r.s === 201 ? ':' + r.j.status : '')] || 0) + 1; });
out('40 parallel starts', JSON.stringify(codes));

const failures = [];
const expect = (name, cond) => { if (!cond) failures.push(name); };
expect('login', login.s === 200); expect('instance completed', inst.j.status === 'completed');
expect('java ran + UTF-8', inst.j.variables?.javaOut === 'héllo — ✓ 42'); expect('js ran', inst.j.variables?.jsOut === 42);
expect('case mgmt definitions', (await call('GET', '/workflow-definitions', null, tok)).s === 200);
expect('case mgmt instances', (await call('GET', '/workflow-instances', null, tok)).s === 200);
expect('40 parallel starts', Object.keys(codes).length === 1 && codes['201:completed'] === 40);
if (failures.length) { console.error('SMOKE FAILED:', failures.join(', ')); process.exit(1); }
console.log('SMOKE OK');
