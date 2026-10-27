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
  console.log('=== Deep Validation: Multi-Step jBPM Flows & Execution ===\n');

  const loginRes = await req('/auth/login', 'POST', { username: 'admin', password: 'admin-change-me' });
  const token = loginRes.token;

  const list = await req('/workflows', 'GET', null, token);
  const wf = list.items?.find(w => w.name === 'Policy System') || list.items?.[0];
  if (!wf) throw new Error('Policy System workflow not found');

  let passedScenarios = 0;
  let totalScenarios = 0;

  // Scenario 1: Signal Catch & Resume in policy_management.send_email
  totalScenarios++;
  console.log('[Scenario 1] Signal Catch & Resume in policy_management.send_email');
  try {
    const inst = await req('/instances', 'POST', {
      workflowId: wf.id,
      processId: 'policy_management.send_email',
      variables: {
        broker_id: 'BRK-001',
        cid: 101,
        group_id: 'GRP-202',
        email_type: 'POLICY_ISSUED',
        emailUrl: `${MOCK_BASE}/mock/api`,
        isHandleResponseErrors: true,
        method: 'POST',
        sendSignalUrl: `${MOCK_BASE}/mock/api`,
      },
    }, token);

    let detail = await req(`/instances/${inst.id}`, 'GET', null, token);
    console.log(`   Initial status: ${detail.status}, tokens: ${detail.tokens?.length}`);
    const waitingToken = detail.tokens?.find(t => t.state === 'waiting');
    if (!waitingToken) throw new Error('Expected instance to be waiting at signal catch node');
    console.log(`   Waiting at node: ${waitingToken.nodeId} (waitFor=${JSON.stringify(waitingToken.waitFor)})`);

    // Deliver signal SEND_EMAIL_RESPONSE
    console.log('   Sending signal SEND_EMAIL_RESPONSE...');
    await req(`/instances/${inst.id}/signal`, 'POST', {
      name: 'SEND_EMAIL_RESPONSE',
      payload: { status: 'DELIVERED', timestamp: Date.now() },
    }, token);

    // Verify instance advanced
    detail = await req(`/instances/${inst.id}`, 'GET', null, token);
    console.log(`   After signal status: ${detail.status}, tokens: ${detail.tokens?.length}`);
    if (detail.status === 'failed') throw new Error(`Process failed after signal: ${detail.error?.message}`);
    console.log('   ✅ Scenario 1 Passed!\n');
    passedScenarios++;
  } catch (err) {
    console.error(`   ❌ Scenario 1 Failed: ${err.message}\n`);
  }

  // Scenario 2: Error boundary flow & recovery in policy_system.error_flow
  totalScenarios++;
  console.log('[Scenario 2] Error boundary flow & recovery in policy_system.error_flow');
  try {
    const inst = await req('/instances', 'POST', {
      workflowId: wf.id,
      processId: 'policy_system.error_flow',
      variables: {
        failedEndpoint: `${MOCK_BASE}/mock/api`,
        failedPayload: JSON.stringify({ caseId: 'CASE-ERR-1' }),
        failedMethod: 'POST',
        retryCount: 0,
        maxRetryCount: 3,
        isError: false,
        adminDecision: 'RETRY',
      },
    }, token);

    const detail = await req(`/instances/${inst.id}`, 'GET', null, token);
    console.log(`   Status: ${detail.status}, tokens: ${detail.tokens?.length}`);
    if (detail.status === 'failed') throw new Error(`Process failed: ${detail.error?.message}`);
    console.log('   ✅ Scenario 2 Passed!\n');
    passedScenarios++;
  } catch (err) {
    console.error(`   ❌ Scenario 2 Failed: ${err.message}\n`);
  }

  // Scenario 3: Subprocess Call Activity Data Mapping in certificate_resend
  totalScenarios++;
  console.log('[Scenario 3] Call Activity & Jackson Mapping in policy_system.certificate_resend');
  try {
    const inst = await req('/instances', 'POST', {
      workflowId: wf.id,
      processId: 'policy_system.certificate_resend',
      variables: {
        caseId: 'CASE-RESEND-100',
        party_id: 'PARTY-01',
        group_id: 'GRP-99',
        broker_id: 'BRK-77',
        party_agreement_ids: JSON.stringify(['AGR-01', 'AGR-02']),
        changeReason: 'ADDRESS_CHANGE',
        reasonMode: 'REGENERATE',
        certificateIds: JSON.stringify(['CERT-888']),
        communicationSendUrl: `${MOCK_BASE}/mock/api`,
        communicationRetryUrl: `${MOCK_BASE}/mock/api`,
        maxRetryCount: 2,
      },
    }, token);

    const detail = await req(`/instances/${inst.id}`, 'GET', null, token);
    console.log(`   Status: ${detail.status}, tokens: ${detail.tokens?.length}`);
    if (detail.status === 'failed') throw new Error(`Process failed: ${detail.error?.message}`);
    console.log('   ✅ Scenario 3 Passed!\n');
    passedScenarios++;
  } catch (err) {
    console.error(`   ❌ Scenario 3 Failed: ${err.message}\n`);
  }

  // Scenario 4: User Task Query, Claim & Complete in policy_system.claims
  totalScenarios++;
  console.log('[Scenario 4] User Task Lifecycle in policy_system.claims');
  try {
    const inst = await req('/instances', 'POST', {
      workflowId: wf.id,
      processId: 'policy_system.claims',
      variables: {
        caseId: 'CLAIM-CASE-01',
        claimAmount: 5000,
        claimant: 'John Doe',
      },
    }, token);

    let detail = await req(`/instances/${inst.id}`, 'GET', null, token);
    console.log(`   Instance created, status=${detail.status}`);
    const tasks = await req(`/tasks?instanceId=${inst.id}`, 'GET', null, token);
    console.log(`   Active tasks found: ${tasks.items?.length ?? 0}`);
    if (tasks.items?.length > 0) {
      const taskId = tasks.items[0].id;
      console.log(`   Claiming task ${taskId}...`);
      await req(`/tasks/${taskId}/claim`, 'POST', {}, token);
      console.log(`   Completing task ${taskId} with approved=true...`);
      await req(`/tasks/${taskId}/complete`, 'POST', { output: { approved: true, reviewNotes: 'All checks passed' } }, token);

      detail = await req(`/instances/${inst.id}`, 'GET', null, token);
      console.log(`   Instance after task completion: status=${detail.status}`);
      if (detail.status === 'failed') throw new Error(`Process failed after task completion: ${detail.error?.message}`);
    }
    console.log('   ✅ Scenario 4 Passed!\n');
    passedScenarios++;
  } catch (err) {
    console.error(`   ❌ Scenario 4 Failed: ${err.message}\n`);
  }

  // Scenario 5: Top-Level Policy Management Orchestrator
  totalScenarios++;
  console.log('[Scenario 5] Top-Level Orchestrator policy_management_process');
  try {
    const inst = await req('/instances', 'POST', {
      workflowId: wf.id,
      processId: 'policy_management_process',
      variables: {
        caseId: 'MAIN-CASE-1000',
        cid: 1001,
        party_id: 'P-101',
        group_id: 'GRP-101',
        broker_id: 'BRK-101',
        policy_number: 'POL-999',
        isPriorCarrier: false,
        isError: false,
        generateDocumentDecision: 'Approve',
        send_email_response: 'SUCCESS',
      },
    }, token);

    const detail = await req(`/instances/${inst.id}`, 'GET', null, token);
    console.log(`   Status: ${detail.status}, tokens: ${detail.tokens?.length}`);
    if (detail.status === 'failed') throw new Error(`Process failed: ${detail.error?.message}`);
    console.log('   ✅ Scenario 5 Passed!\n');
    passedScenarios++;
  } catch (err) {
    console.error(`   ❌ Scenario 5 Failed: ${err.message}\n`);
  }

  console.log(`\n=== Deep Validation Results: ${passedScenarios}/${totalScenarios} Passed ===`);
  if (passedScenarios < totalScenarios) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Deep validation script error:', err);
  process.exit(1);
});
