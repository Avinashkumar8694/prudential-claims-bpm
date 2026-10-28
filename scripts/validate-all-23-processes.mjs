// Test execution across ALL 23 processes in Policy System to detect any gaps against jBPM execution.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const API_BASE = 'http://localhost:4000/api';
const MOCK_BASE = 'http://localhost:3010';

async function req(urlPath, method = 'GET', body = null, token = null) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function run() {
  console.log('=== Validating & Executing All 23 Policy System Processes ===\n');

  const loginRes = await req('/auth/login', 'POST', { username: 'admin', password: 'admin-change-me' });
  const token = loginRes.token;

  const projectFile = path.join(rootDir, 'policy_system_node_project.json');
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));

  const list = await req('/workflows', 'GET', null, token);
  const wf = list.items?.find(w => w.name === 'Policy System') || list.items?.[0];
  if (!wf) throw new Error('Policy System workflow not found');

  console.log(`Using workflow: ${wf.id} ("${wf.name}")\n`);

  const results = [];

  for (let i = 0; i < project.processes.length; i++) {
    const proc = project.processes[i];
    console.log(`[${i + 1}/${project.processes.length}] Testing Process: ${proc.id} ("${proc.name}")`);

    // Build sample payload with common jBPM variables for policy management
    const sampleVars = {
      caseId: `CASE-${i + 1}`,
      case_id: `CASE-${i + 1}`,
      cid: `CID-${i + 1}`,
      pid: `PID-${i + 1}`,
      group_id: `GRP-${i + 1}`,
      isError: false,
      generateDocumentDecision: 'Approve',
      process_value_type: 'POLICY_JET_ISSUE',
      failedEndpoint: `${MOCK_BASE}/policy/certificate/create`,
      failedPayload: JSON.stringify({ party_id: 'P01' }),
      failedMethod: 'POST',
      retryCount: 0,
      maxRetryCount: 2,
      adminDecision: 'SKIP',
      baseUrl: MOCK_BASE,
      applicablePolicies: ['POL-001', 'POL-002'],
      policy_data: { policy_number: 'POL-100', status: 'ACTIVE' },
    };

    // If process defines variables, provide default values
    if (proc.vars) {
      for (const v of proc.vars) {
        if (!(v.name in sampleVars)) {
          if (v.type === 'int' || v.type === 'long') sampleVars[v.name] = 1;
          else if (v.type === 'bool') sampleVars[v.name] = false;
          else if (v.type === 'list') sampleVars[v.name] = [];
          else if (v.type === 'map' || v.type === 'object') sampleVars[v.name] = {};
          else if (v.name.toLowerCase().includes('url') || v.name.toLowerCase().includes('endpoint')) sampleVars[v.name] = `${MOCK_BASE}/mock/api`;
          else sampleVars[v.name] = 'TEST_VALUE';
        }
      }
    }

    try {
      const inst = await req('/instances', 'POST', {
        workflowId: wf.id,
        processId: proc.id,
        variables: sampleVars,
      }, token);

      // Fetch detail after initial tick
      const detail = await req(`/instances/${inst.id}`, 'GET', null, token);

      if (detail.status === 'failed') {
        console.log(`   ❌ FAILED at node: ${detail.error?.nodeId || 'unknown'}`);
        console.log(`      Error: ${detail.error?.message || 'unknown error'}`);
        results.push({ id: proc.id, name: proc.name, status: 'FAILED', error: detail.error });
      } else {
        console.log(`   ✅ Succeeded: status=${detail.status}, tokens=${detail.tokens?.length ?? 0}`);
        results.push({ id: proc.id, name: proc.name, status: detail.status, error: null });
      }
    } catch (err) {
      console.log(`   ❌ Exception starting process: ${err.message}`);
      results.push({ id: proc.id, name: proc.name, status: 'ERROR', error: { message: err.message } });
    }
  }

  console.log('\n=== Summary of All 23 Processes Execution ===');
  let passCount = 0;
  let failCount = 0;
  results.forEach((r, idx) => {
    const symbol = r.status === 'FAILED' || r.status === 'ERROR' ? '❌' : '✅';
    console.log(`[${idx + 1}] ${symbol} ${r.id}: ${r.status} ${r.error ? '(' + r.error.message + ')' : ''}`);
    if (r.status === 'FAILED' || r.status === 'ERROR') failCount++;
    else passCount++;
  });

  console.log(`\nTotal: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);
}

run().catch(err => {
  console.error('Fatal error in script:', err);
  process.exit(1);
});
