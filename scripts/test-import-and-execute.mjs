// End-to-end import, deploy, and execution test of Policy System in Node.js Engine
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
  console.log('=== Policy System Node.js Engine E2E Test ===\n');

  // 1. Login
  console.log('1. Authenticating as admin...');
  const loginRes = await req('/auth/login', 'POST', { username: 'admin', password: 'admin-change-me' });
  const token = loginRes.token;
  console.log('   Authenticated successfully! User:', loginRes.user?.username);

  // 2. Load converted project
  console.log('\n2. Loading converted Policy System project JSON...');
  const projectFile = path.join(rootDir, 'policy_system_node_project.json');
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  console.log(`   Loaded project with ${project.processes.length} processes.`);

  // 3. Create or reuse workflow
  console.log('\n3. Creating Policy System workflow in engine...');
  let wf;
  try {
    wf = await req('/workflows', 'POST', { name: 'Policy System' }, token);
    console.log(`   Created new workflow: ${wf.id} ("${wf.name}")`);
  } catch (e) {
    const list = await req('/workflows', 'GET', null, token);
    wf = list.items?.find(w => w.name === 'Policy System') || list.items?.[0];
    console.log(`   Using existing workflow: ${wf.id} ("${wf.name}")`);
  }

  // 4. Save draft with all 23 converted processes
  console.log('\n4. Saving draft version with 23 Node.js engine processes...');
  const draft = await req(`/branches/${wf.defaultBranchId}/versions`, 'POST', {
    engine: project,
    message: 'Policy System 23 processes converted to Node.js Engine',
  }, token);
  console.log(`   Saved draft: ${draft.id} (number ${draft.number}, processes: ${draft.engine?.processes?.length})`);

  // 5. Publish draft
  console.log('\n5. Publishing draft version...');
  const publishRes = await req(`/versions/${draft.id}/publish`, 'POST', { label: 'v1.0' }, token);
  const versionId = publishRes.published?.id || draft.id;
  console.log(`   Published version: ${versionId}`);

  // 6. Deploy published version to 'prod' environment with configured environment variables
  console.log('\n6. Deploying version to "prod" environment...');
  const deploymentEnv = {
    BASE_URL: MOCK_BASE,
    INTEGRATION_LAYER_URL: MOCK_BASE,
    APL_POLICY_MS_URL: `${MOCK_BASE}/policy-api`,
    APL_QUOTATION_MS_URL: `${MOCK_BASE}/quote-api`,
    APL_BROKER_MS_BASE_URL: `${MOCK_BASE}/broker-ms-api`,
    QUOTATION_BASE_URL: `${MOCK_BASE}/quote-api`,
  };
  const deployment = await req(`/versions/${versionId}/deploy`, 'POST', {
    environment: 'prod',
    activate: true,
    env: deploymentEnv,
  }, token);
  console.log(`   Deployment active: ${deployment.id} (env: ${deployment.environment})`);

  // 7. Test Process 1: api-error-handler execution
  console.log('\n7. Testing Process 1: policy_system.api-error-handler...');
  const inst1 = await req('/instances', 'POST', {
    workflowId: wf.id,
    processId: 'policy_system.api-error-handler',
    variables: {
      caseId: 'CASE-TEST-001',
      failedEndpoint: `${MOCK_BASE}/policy/certificate/create`,
      failedPayload: JSON.stringify({ party_id: 'PARTY-001' }),
      failedMethod: 'POST',
      retryCount: 0,
      maxRetryCount: 2,
      adminDecision: 'SKIP',
    },
  }, token);
  console.log(`   Started instance ${inst1.id} (status: ${inst1.status})`);

  const inst1Status = await req(`/instances/${inst1.id}`, 'GET', null, token);
  console.log(`   Instance ${inst1.id} final state:`, {
    status: inst1Status.status,
    retryCount: inst1Status.variables?.retryCount,
    adminDecision: inst1Status.variables?.adminDecision,
    baseUrl: inst1Status.variables?.baseUrl,
  });

  // 8. Test Process 2: policy_management_process dispatcher
  console.log('\n8. Testing Process 2: policy_management_process...');
  const inst2 = await req('/instances', 'POST', {
    workflowId: wf.id,
    processId: 'policy_management_process',
    variables: {
      process_value_type: 'POLICY_JET_ISSUE',
      case_id: 'CASE-JET-002',
      cid: 'CID-202',
      pid: 'PID-303',
      group_id: 'GRP-99',
    },
  }, token);
  console.log(`   Started instance ${inst2.id} (status: ${inst2.status})`);

  const inst2Status = await req(`/instances/${inst2.id}`, 'GET', null, token);
  console.log(`   Instance ${inst2.id} state:`, {
    status: inst2Status.status,
    tokens: inst2Status.tokens?.length,
  });

  // 9. Test Process 3: policy-termination
  console.log('\n9. Testing Process 3: policy-termination...');
  const inst3 = await req('/instances', 'POST', {
    workflowId: wf.id,
    processId: 'policy-termination',
    variables: {
      caseId: 'CASE-TERM-003',
      cid: 'CID-404',
      isError: false,
      generateDocumentDecision: 'Approve',
    },
  }, token);
  console.log(`   Started instance ${inst3.id} (status: ${inst3.status})`);

  const inst3Status = await req(`/instances/${inst3.id}`, 'GET', null, token);
  console.log(`   Instance ${inst3Status.id} state: status=${inst3Status.status}, variables=`, Object.keys(inst3Status.variables || {}));

  // 10. Check Human Tasks generated
  console.log('\n10. Checking task inbox for human tasks...');
  const tasksRes = await req('/tasks', 'GET', null, token);
  const tasks = tasksRes.items || [];
  console.log(`    Total tasks in inbox: ${tasks.length}`);
  const claimable = tasks.find(t => t.status === 'ready' || t.status === 'reserved');
  if (claimable) {
    console.log(`    Claimable Task: [${claimable.id}] "${claimable.name || claimable.taskName}" (status: ${claimable.status}, priority: ${claimable.priority})`);
    
    if (claimable.status === 'ready') {
      console.log(`    Claiming task ${claimable.id}...`);
      await req(`/tasks/${claimable.id}/claim`, 'POST', {}, token);
    }
    
    console.log(`    Completing task ${claimable.id}...`);
    await req(`/tasks/${claimable.id}/complete`, 'POST', { outputs: { reviewer_decision: 'APPROVE' } }, token);
    console.log(`    Task ${claimable.id} completed!`);
  } else {
    console.log('    No currently ready tasks to claim.');
  }

  // 11. Check Audit Log
  console.log('\n11. Checking system audit log...');
  const auditRes = await req('/audit?limit=5', 'GET', null, token);
  const events = auditRes.items || [];
  console.log(`    Audit log events: ${events.length}`);
  events.slice(0, 3).forEach(ev => {
    console.log(`    - [${ev.kind}] by ${ev.actor} (wf: ${ev.workflowId || 'N/A'}, inst: ${ev.instanceId || 'N/A'})`);
  });

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
}

run().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
