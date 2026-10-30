// Developer Integration Parity & End-to-End Suite
// Tests all added integration endpoints:
// - Signals broadcast: POST /api/signals/:signalName & POST /api/workflow-instances/signal/:signalName
// - Human task fail: POST /api/tasks/:id/fail
// - Case lifecycle (close/reopen): POST /api/workflow-instances/:id/close & /reopen
// - Case data CRUD: GET /api/workflow-instances/:id/data & DELETE /api/workflow-instances/:id/data/:key
// - Case roles: GET/PUT/DELETE /api/workflow-instances/:id/roles/...
// - Case milestones: GET/POST /api/workflow-instances/:id/milestones
// - SLA & Workload analytics: GET /api/query/analytics/sla-violations & workload
// - Case Service schema CRUD: POST/GET/PUT/DELETE /api/caseservice/case and GET /api/caseservice/list
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createApp } from '../src/app.ts';
import { MemoryStore } from '../src/store/memory-store.ts';
import { makeContext } from '../src/context.ts';
import { config } from '../src/infra/config.ts';
import { IamService } from '../src/modules/iam/service.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { resolveWorkflowServiceStore } from '../src/workflow-service/store/index.ts';
import { WorkflowDefinitionService } from '../src/workflow-service/services/workflow-definition-service.ts';

let server: http.Server;
let base: string;
let token: string;
let store: MemoryStore;
let depId: string;

const CLAIMS_PROCESS = {
  id: 'claims-intake',
  name: 'Claims Intake Process',
  processes: [{
    id: 'claims-intake.process',
    name: 'Claims Intake',
    package: 'com.prudential.claims',
    nodes: [
      { id: 's', type: 'start' },
      { id: 'reviewTask', type: 'userTask', name: 'Examiner Review' },
      { id: 'waitDoc', type: 'catch', name: 'Wait for Document', event: { signal: 'DOCUMENT_UPLOADED' } },
      { id: 'e', type: 'end' },
    ],
    flows: [
      { id: 'f1', from: 's', to: 'reviewTask' },
      { id: 'f2', from: 'reviewTask', to: 'waitDoc' },
      { id: 'f3', from: 'waitDoc', to: 'e' },
    ],
  }],
};

test.before(async () => {
  store = new MemoryStore();
  const ctx = makeContext({ store, tenantId: config.defaultTenant });
  await new IamService(ctx).ensureSeeded('test-pw-123');

  const { app } = createApp(store);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api`;

  // Login as admin
  const loginRes = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-pw-123' }),
  });
  const loginBody = await loginRes.json() as any;
  token = loginBody.token;

  // Deploy claims intake process
  const wf = await new WorkflowService(ctx).create({ name: 'claims-intake', key: 'claims-intake' }, 'admin');
  const draft = await new VersionService(ctx).saveDraft(wf.defaultBranchId, CLAIMS_PROCESS as any, 'admin');
  const pub = await new VersionService(ctx).publish(draft.id, 'admin');
  const dep = await new DeploymentService(ctx).deploy(pub.published.id, { environment: 'prod', activate: true }, 'admin');
  depId = dep.id;

  // Register workflow definition for cases
  const wfStore = resolveWorkflowServiceStore(store);
  await new WorkflowDefinitionService(ctx, wfStore).create({
    name: 'claims-intake-v1',
    deploymentId: dep.id,
    processId: 'claims-intake.process',
  }, 'admin');
});

test.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const authHeaders = () => ({
  'content-type': 'application/json',
  authorization: `Bearer ${token}`,
});

test('Case Service CRUD: POST/GET/PUT/DELETE /api/caseservice/case and GET /api/caseservice/list', async () => {
  // 1. Create Case
  const createRes = await fetch(`${base}/caseservice/case`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      policyNumber: 'POL-998877',
      claimType: 'DEATH',
      caseStatus: 'DRAFT',
      dateOfDeath: '2026-01-15',
      causeOfDeath: 'NATURAL',
      totalPayoutAmount: 250000,
      claimant: {
        first_name: 'Jane',
        last_name: 'Doe',
        relationship: 'SPOUSE',
      },
      policyDetails: [
        { policyNumber: 'POL-998877', planCode: 'TERM-80', pasLockStatus: 'PENDING', faceAmount: 250000 },
      ],
    }),
  });
  assert.strictEqual(createRes.status, 201);
  const createdCase = await createRes.json() as any;
  assert.ok(createdCase.caseId);
  assert.strictEqual(createdCase.policyNumber, 'POL-998877');
  assert.strictEqual(createdCase.caseStatus, 'DRAFT');

  // 2. Retrieve Case
  const getRes = await fetch(`${base}/caseservice/case/${createdCase.caseId}`, {
    headers: authHeaders(),
  });
  assert.strictEqual(getRes.status, 200);
  const caseObj = await getRes.json() as any;
  assert.strictEqual(caseObj.caseId, createdCase.caseId);
  assert.strictEqual(caseObj.claimant?.first_name, 'Jane');
  assert.strictEqual(caseObj.totalPayoutAmount, 250000);

  // 3. Update Case
  const putRes = await fetch(`${base}/caseservice/case/${createdCase.caseId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      caseStatus: 'UNDER_REVIEW',
      examinerResolution: 'APPROVED',
      examinerComment: 'Initial intake complete',
    }),
  });
  assert.strictEqual(putRes.status, 200);
  const updatedCase = await putRes.json() as any;
  assert.strictEqual(updatedCase.caseStatus, 'UNDER_REVIEW');

  // 4. List Cases
  const listRes = await fetch(`${base}/caseservice/list?policyNumber=POL-998877`, {
    headers: authHeaders(),
  });
  assert.strictEqual(listRes.status, 200);
  const list = await listRes.json() as any[];
  assert.ok(list.length >= 1);
  assert.strictEqual(list[0].caseId, createdCase.caseId);

  // 5. Delete Case
  const delRes = await fetch(`${base}/caseservice/case/${createdCase.caseId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.strictEqual(delRes.status, 204);

  // Verify deleted status is TERMINATED
  const getAfterDel = await fetch(`${base}/caseservice/case/${createdCase.caseId}`, {
    headers: authHeaders(),
  });
  const afterDelObj = await getAfterDel.json() as any;
  assert.strictEqual(afterDelObj.caseStatus, 'TERMINATED');
});

test('Workflow Instance Extended Parity: Close, Reopen, Data CRUD, Roles, and Milestones', async () => {
  // Start workflow instance case
  const startRes = await fetch(`${base}/workflow-instances`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      workflowName: 'claims-intake-v1',
      workflowData: { claimNumber: 'CLM-7711', initialAmount: 10000, riskScore: 'LOW' },
    }),
  });
  assert.strictEqual(startRes.status, 201);
  const caseInstance = await startRes.json() as any;
  assert.ok(caseInstance.id);

  // 1. Data GET
  const dataRes = await fetch(`${base}/workflow-instances/${caseInstance.id}/data`, {
    headers: authHeaders(),
  });
  assert.strictEqual(dataRes.status, 200);
  const data = await dataRes.json() as any;
  assert.strictEqual(data.claimNumber, 'CLM-7711');
  assert.strictEqual(data.riskScore, 'LOW');

  // 2. Data key DELETE
  const delKeyRes = await fetch(`${base}/workflow-instances/${caseInstance.id}/data/riskScore`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.strictEqual(delKeyRes.status, 200);
  const afterKeyDel = await delKeyRes.json() as any;
  assert.strictEqual(afterKeyDel.data.riskScore, undefined);
  assert.strictEqual(afterKeyDel.data.claimNumber, 'CLM-7711');

  // 3. Roles PUT & GET & DELETE
  const setRoleRes = await fetch(`${base}/workflow-instances/${caseInstance.id}/roles/examiner`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ members: ['alice', 'bob'] }),
  });
  assert.strictEqual(setRoleRes.status, 200);
  const rolesObj = await setRoleRes.json() as any;
  assert.deepStrictEqual(rolesObj.roles.examiner, ['alice', 'bob']);

  const getRolesRes = await fetch(`${base}/workflow-instances/${caseInstance.id}/roles`, {
    headers: authHeaders(),
  });
  assert.strictEqual(getRolesRes.status, 200);
  assert.deepStrictEqual((await getRolesRes.json() as any).roles.examiner, ['alice', 'bob']);

  const delRoleRes = await fetch(`${base}/workflow-instances/${caseInstance.id}/roles/examiner`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.strictEqual(delRoleRes.status, 200);
  assert.strictEqual((await delRoleRes.json() as any).roles.examiner, undefined);

  // 4. Milestones POST & GET
  const postMilestoneRes = await fetch(`${base}/workflow-instances/${caseInstance.id}/milestones`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name: 'PAS_VALIDATED' }),
  });
  assert.strictEqual(postMilestoneRes.status, 201);
  const postMilestoneBody = await postMilestoneRes.json() as any;
  assert.ok(postMilestoneBody.milestones.some((m: any) => m.name === 'PAS_VALIDATED' && m.status === 'achieved'));

  const getMilestonesRes = await fetch(`${base}/workflow-instances/${caseInstance.id}/milestones`, {
    headers: authHeaders(),
  });
  assert.strictEqual(getMilestonesRes.status, 200);
  const getMilestonesBody = await getMilestonesRes.json() as any;
  assert.ok(getMilestonesBody.milestones.some((m: any) => m.name === 'PAS_VALIDATED' && m.status === 'achieved'));

  // 5. Close & Reopen Case
  const closeRes = await fetch(`${base}/workflow-instances/${caseInstance.id}/close`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ resolution: 'Claim approved and settled' }),
  });
  assert.strictEqual(closeRes.status, 200);
  const closedCase = await closeRes.json() as any;
  assert.strictEqual(closedCase.status, 'closed');

  const reopenRes = await fetch(`${base}/workflow-instances/${caseInstance.id}/reopen`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ reason: 'Beneficiary appealed payout' }),
  });
  assert.strictEqual(reopenRes.status, 200);
  const reopenedCase = await reopenRes.json() as any;
  assert.strictEqual(reopenedCase.status, 'active');
});

test('Task Failure and Signal Broadcasting', async () => {
  // 1. Start an instance to create an open task
  const startRes = await fetch(`${base}/instances`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      deploymentId: depId,
      processId: 'claims-intake.process',
    }),
  });
  assert.strictEqual(startRes.status, 201);
  const inst = await startRes.json() as any;

  // Retrieve the task
  const tasksRes = await fetch(`${base}/tasks`, {
    headers: authHeaders(),
  });
  assert.strictEqual(tasksRes.status, 200);
  const tasks = (await tasksRes.json() as any).items;
  const myTask = tasks.find((t: any) => t.instanceId === inst.id);
  assert.ok(myTask, 'task was created on claims-intake.process');

  // Claim task
  await fetch(`${base}/tasks/${myTask.id}/claim`, { method: 'POST', headers: authHeaders() });

  // 2. Task FAIL: POST /api/tasks/:id/fail
  const failRes = await fetch(`${base}/tasks/${myTask.id}/fail`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      message: 'Claimant SSN does not match IRS records',
      data: { reasonCode: 'SSN_MISMATCH', rejectionStep: 'examinerReview' },
    }),
  });
  assert.strictEqual(failRes.status, 200);
  const failedTask = await failRes.json() as any;
  assert.strictEqual(failedTask.status, 'failed');

  // 3. Broadcast Signal: POST /api/signals/:signalName
  const signalRes = await fetch(`${base}/signals/DOCUMENT_UPLOADED`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      payload: { documentId: 'DOC-55', verified: true },
    }),
  });
  assert.strictEqual(signalRes.status, 200);
  const signalBody = await signalRes.json() as any;
  assert.strictEqual(typeof signalBody.signaled, 'number');

  // 4. Case-scoped Broadcast Signal: POST /api/workflow-instances/signal/:signalName
  const caseSignalRes = await fetch(`${base}/workflow-instances/signal/DOCUMENT_UPLOADED`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      payload: { documentId: 'DOC-66' },
    }),
  });
  assert.strictEqual(caseSignalRes.status, 200);
});

test('Operational & SLA Analytics: /query/analytics/sla-violations and /query/analytics/workload', async () => {
  const slaRes = await fetch(`${base}/query/analytics/sla-violations`, {
    headers: authHeaders(),
  });
  assert.strictEqual(slaRes.status, 200);
  const sla = await slaRes.json() as any;
  assert.strictEqual(typeof sla.totalOpenTasks, 'number');
  assert.strictEqual(typeof sla.overdueCount, 'number');
  assert.strictEqual(typeof sla.atRiskCount, 'number');
  assert.ok(Array.isArray(sla.overdueTasks));
  assert.ok(Array.isArray(sla.atRiskTasks));

  const workloadRes = await fetch(`${base}/query/analytics/workload`, {
    headers: authHeaders(),
  });
  assert.strictEqual(workloadRes.status, 200);
  const workload = await workloadRes.json() as any;
  assert.strictEqual(typeof workload.totalOpen, 'number');
  assert.ok(Array.isArray(workload.users));
  assert.ok(Array.isArray(workload.groups));
});
