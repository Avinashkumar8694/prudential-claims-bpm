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

const SCENARIOS = [
  { type: 'CERTIFICATE_RESEND', targetProcess: 'policy_system.certificate_resend', label: 'Certificate Resend' },
  { type: 'FILE_FEED', targetProcess: 'policy_system.file_feed', label: 'File Feed' },
  { type: 'POLICY_JET_ISSUE', targetProcess: 'policy_system.policy_issue', label: 'Policy Jet Issue' },
  { type: 'TAKEOVER', targetProcess: 'group-takeover-process', label: 'Group Takeover' },
  { type: 'CLAIMS', targetProcess: 'policy_system.claims', label: 'Claims' },
  { type: 'GENERATE_ID_CARD', targetProcess: 'generate-id-card-send-email', label: 'Generate ID Card' },
  { type: 'ENROLLMENT_PARTICIPATION_RATE_REVIEW', targetProcess: 'policy_system.enrollment_participation_rate_review', label: 'Participation Rate Review' },
  { type: 'ESCALATION', targetProcess: 'policy_system.Escalation', label: 'Escalation' },
  { type: 'POLICY_TERMINATION', targetProcess: 'policy-termination', label: 'Policy Termination' },
  { type: 'GENERATE_POLICY_DOCUMENT', targetProcess: 'generate-send-policy-document', label: 'Generate Policy Document' },
  { type: 'ENROLLMENT_ERROR_RATE_REVIEW', targetProcess: 'policy_system.enrollment_error_rate_review', label: 'Error Rate Review' },
  { type: 'ENROLLMENT_EXCEPTION', targetProcess: 'policy_system.enrollment_exception', label: 'Enrollment Exception' },
  { type: 'GENERATE_CERTIFICATE', targetProcess: 'generate-certificate-send-email', label: 'Generate Certificate' },
  { type: 'ENROLLMENT', targetProcess: 'policy_system.enrollment', label: 'Enrollment' },
];

async function run() {
  console.log('=== Testing policy_management_process Across All Scenarios ===\n');

  const loginRes = await req('/auth/login', 'POST', { username: 'admin', password: 'admin-change-me' });
  const token = loginRes.token;

  const list = await req('/workflows', 'GET', null, token);
  const wf = list.items?.find(w => w.name === 'Policy System') || list.items?.[0];
  if (!wf) throw new Error('Policy System workflow not found');

  console.log(`Workflow: ${wf.id} ("${wf.name}")\n`);

  let passed = 0;
  let failed = 0;

  for (let idx = 0; idx < SCENARIOS.length; idx++) {
    const sc = SCENARIOS[idx];
    console.log(`[${idx + 1}/${SCENARIOS.length}] Triggering Scenario: ${sc.type} (${sc.label})`);

    const vars = {
      process_value_type: sc.type,
      caseId: `CASE-PMP-${idx + 1}`,
      cid: 2000 + idx,
      party_id: 'PARTY-01',
      group_id: 'GRP-99',
      broker_id: 'BRK-77',
      policy_number: `POL-AUTO-${idx + 1}`,
      policy_issuance_type: 'STANDARD',
      party_agreement_ids: JSON.stringify(['AGR-001']),
      reasonMode: 'NO_CHANGE',
      journeyType: 'RESEND',
      changeReason: 'NONE',
      commPurposeId: 'POLICY_ISSUED',
      current_user: 'admin',
      enrollment_reference_number: 'ENR-REF-01',
      enrollment_review_group: 'REVIEWERS',
      enrollment_review_user: 'admin',
      billing_frequency: 'MONTHLY',
      valid_enrollment_change: true,
      baseUrl: MOCK_BASE,
      communicationSendUrl: `${MOCK_BASE}/mock/api`,
      communicationRetryUrl: `${MOCK_BASE}/mock/api`,
      saveUrl: `${MOCK_BASE}/mock/api`,
      sendSignalUrl: `${MOCK_BASE}/mock/api`,
      emailUrl: `${MOCK_BASE}/mock/api`,
      takoverUpdateUrl: `${MOCK_BASE}/mock/api`,
      updateTerminationUrl: `${MOCK_BASE}/mock/api`,
      failedEndpoint: `${MOCK_BASE}/mock/api`,
      isError: false,
      adminDecision: 'SKIP',
      generateDocumentDecision: 'Approve',
      maxRetryCount: 2,
    };

    try {
      const inst = await req('/instances', 'POST', {
        workflowId: wf.id,
        processId: 'policy_management_process',
        variables: vars,
      }, token);

      // Fetch detail after invocation
      const detail = await req(`/instances/${inst.id}`, 'GET', null, token);
      console.log(`   Parent Instance: ${inst.id} | Status: ${detail.status} | Tokens: ${detail.tokens?.length ?? 0}`);

      if (detail.status === 'failed') {
        console.log(`   ❌ Scenario FAILED at node: ${detail.error?.nodeId || 'unknown'}`);
        console.log(`      Error: ${detail.error?.message || 'unknown'}`);
        failed++;
        continue;
      }

      // Check child instances created by Call Activity
      const related = await req(`/instances/${inst.id}/related`, 'GET', null, token).catch(() => ({ children: [] }));
      const children = related.children || [];
      console.log(`   Subprocesses spawned: ${children.length}`);
      children.forEach(c => {
        console.log(`     -> Subprocess: ${c.processId} (Status: ${c.status})`);
      });

      console.log(`   ✅ Scenario "${sc.type}" executed successfully!\n`);
      passed++;
    } catch (err) {
      console.log(`   ❌ Exception in scenario ${sc.type}: ${err.message}\n`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed}/${SCENARIOS.length} Scenarios Passed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error in scenario tester:', err);
  process.exit(1);
});
