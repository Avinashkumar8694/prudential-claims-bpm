import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionEngine } from '../src/engine/execution-engine.ts';
import { MemoryStore } from '../src/store/memory-store.ts';
import type { AppContext } from '../src/context.ts';
import type { Deployment, Instance, Workflow } from '../src/domain.ts';
import type { EngineProject } from '../src/sdk/index.ts';
import { DeploymentService } from '../src/modules/deployments/service.ts';
import { WorkflowService } from '../src/modules/workflows/service.ts';
import { VersionService } from '../src/modules/versions/service.ts';

function createMockApp(): AppContext {
  const store = new MemoryStore();
  let idGen = 1000;
  return {
    tenantId: 'tenant-test',
    store,
    clock: () => new Date().toISOString(),
    newId: () => `id_${++idGen}`,
    audit: async () => {},
  };
}

test('Hierarchical Error Handling: Local boundary error takes precedence over project global error handler', async () => {
  const app = createMockApp();
  const engine = new ExecutionEngine(app);

  const project: EngineProject = {
    id: 'test-wf',
    name: 'Test Workflow',
    processes: [
      {
        id: 'main-process',
        name: 'Main Process',
        package: 'com.test',
        vars: [],
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'failing_node', type: 'script', code: 'throw new Error("failing locally");' },
          { id: 'local_boundary', type: 'boundary', on: 'failing_node', event: { error: 'SCRIPT_ERROR' } },
          { id: 'local_recovery', type: 'script', code: 'vars.handledBy = "local";' },
          { id: 'end_ok', type: 'end' },
        ],
        flows: [
          { from: 'start', to: 'failing_node' },
          { from: 'local_boundary', to: 'local_recovery' },
          { from: 'local_recovery', to: 'end_ok' },
        ],
      },
      {
        id: 'global-error-proc',
        name: 'Global Error Process',
        package: 'com.test',
        vars: [],
        nodes: [
          { id: 'err_start', type: 'start' },
          { id: 'err_script', type: 'script', code: 'vars.handledBy = "global";' },
          { id: 'err_end', type: 'end' },
        ],
        flows: [
          { from: 'err_start', to: 'err_script' },
          { from: 'err_script', to: 'err_end' },
        ],
      },
    ],
  } as unknown as EngineProject;

  const dep: Deployment = {
    id: 'dep_1',
    tenantId: app.tenantId,
    workflowId: 'wf_1',
    versionId: 'ver_1',
    branchId: 'br_1',
    engine: project,
    env: {},
    tags: ['prod'],
    status: 'active',
    environment: 'prod',
    deployedAt: app.clock(),
    deployedBy: 'tester',
    globalErrorHandler: {
      enabled: true,
      processId: 'global-error-proc',
      strategy: 'repair-and-resume',
    },
  };

  const inst: Instance = {
    id: 'inst_1',
    tenantId: app.tenantId,
    deploymentId: dep.id,
    workflowId: dep.workflowId,
    processId: 'main-process',
    status: 'running',
    variables: {},
    tokens: [{ id: 'tok_1', nodeId: 'start', state: 'active', enteredAt: app.clock() }],
    history: [],
    startedAt: app.clock(),
    startedBy: 'tester',
  };

  await engine.runToQuiescence(inst, dep);

  // Local boundary handled it!
  assert.equal(inst.status, 'completed');
  assert.equal(inst.variables.handledBy, 'local');
  assert.ok(inst.variables.errorInfo);
  assert.equal((inst.variables.errorInfo as any).code, 'SCRIPT_ERROR');
  assert.equal((inst.variables.errorInfo as any).node, 'failing_node');
});

test('Hierarchical Error Handling: Unhandled node error invokes Global Error Handler with repair-and-resume', async () => {
  const app = createMockApp();
  const engine = new ExecutionEngine(app);

  const project: EngineProject = {
    id: 'test-wf',
    name: 'Test Workflow',
    processes: [
      {
        id: 'main-process',
        name: 'Main Process',
        package: 'com.test',
        vars: [],
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'failing_task', type: 'script', code: 'throw new Error("unhandled failure");' },
          { id: 'success_node', type: 'script', code: 'vars.step = "resumed_successfully";' },
          { id: 'end', type: 'end' },
        ],
        flows: [
          { from: 'start', to: 'failing_task' },
          { from: 'failing_task', to: 'success_node' },
          { from: 'success_node', to: 'end' },
        ],
      },
      {
        id: 'global-repair-proc',
        name: 'Global Repair Process',
        package: 'com.test',
        vars: [],
        nodes: [
          { id: 'err_start', type: 'start' },
          {
            id: 'err_repair_script',
            type: 'script',
            code: `
              vars.recoveredPayload = "fixed_data";
              vars.seenFailedNode = failedNodeId;
              vars.seenErrorMessage = errorMessage;
            `,
          },
          { id: 'err_end', type: 'end' },
        ],
        flows: [
          { from: 'err_start', to: 'err_repair_script' },
          { from: 'err_repair_script', to: 'err_end' },
        ],
      },
    ],
  } as unknown as EngineProject;

  const dep: Deployment = {
    id: 'dep_2',
    tenantId: app.tenantId,
    workflowId: 'wf_2',
    versionId: 'ver_2',
    branchId: 'br_2',
    engine: project,
    env: {},
    tags: ['prod'],
    status: 'active',
    environment: 'prod',
    deployedAt: app.clock(),
    deployedBy: 'tester',
    globalErrorHandler: {
      enabled: true,
      processId: 'global-repair-proc',
      strategy: 'repair-and-resume',
      outputMappings: {
        recoveredPayload: 'repairedData',
      },
    },
  };

  const inst: Instance = {
    id: 'inst_2',
    tenantId: app.tenantId,
    deploymentId: dep.id,
    workflowId: dep.workflowId,
    processId: 'main-process',
    status: 'running',
    variables: { initialData: 123 },
    tokens: [{ id: 'tok_start', nodeId: 'start', state: 'active', enteredAt: app.clock() }],
    history: [],
    startedAt: app.clock(),
    startedBy: 'tester',
  };

  await engine.runToQuiescence(inst, dep);

  // The global handler repaired the state, mapped recoveredPayload -> repairedData, and resumed past failing_task
  assert.equal(inst.status, 'completed');
  assert.equal(inst.variables.step, 'resumed_successfully');
  assert.equal(inst.variables.repairedData, 'fixed_data');
  assert.equal(inst.variables.errorRepaired, true);
  assert.equal(inst.variables.initialData, 123);
});

test('Hierarchical Error Handling: Global Error Handler with retry action', async () => {
  const app = createMockApp();
  const engine = new ExecutionEngine(app);

  const project: EngineProject = {
    id: 'test-wf',
    name: 'Test Workflow',
    processes: [
      {
        id: 'main-process',
        name: 'Main Process',
        package: 'com.test',
        vars: [],
        nodes: [
          { id: 'start', type: 'start' },
          {
            id: 'conditional_fail_task',
            type: 'script',
            code: `
              if (!vars.authorized) {
                throw new Error("Unauthorized 401");
              }
              vars.data = "authorized_access";
            `,
          },
          { id: 'end', type: 'end' },
        ],
        flows: [
          { from: 'start', to: 'conditional_fail_task' },
          { from: 'conditional_fail_task', to: 'end' },
        ],
      },
      {
        id: 'auth-fix-handler',
        name: 'Auth Fix Handler',
        package: 'com.test',
        vars: [],
        nodes: [
          { id: 'err_start', type: 'start' },
          {
            id: 'err_fix',
            type: 'script',
            code: `
              vars.authorized = true;
              vars.errorHandlerAction = "retry";
            `,
          },
          { id: 'err_end', type: 'end' },
        ],
        flows: [
          { from: 'err_start', to: 'err_fix' },
          { from: 'err_fix', to: 'err_end' },
        ],
      },
    ],
  } as unknown as EngineProject;

  const dep: Deployment = {
    id: 'dep_3',
    tenantId: app.tenantId,
    workflowId: 'wf_3',
    versionId: 'ver_3',
    branchId: 'br_3',
    engine: project,
    env: {},
    tags: ['prod'],
    status: 'active',
    environment: 'prod',
    deployedAt: app.clock(),
    deployedBy: 'tester',
    globalErrorHandler: {
      enabled: true,
      processId: 'auth-fix-handler',
      strategy: 'repair-and-resume',
      outputMappings: {
        authorized: 'authorized',
      },
    },
  };

  const inst: Instance = {
    id: 'inst_3',
    tenantId: app.tenantId,
    deploymentId: dep.id,
    workflowId: dep.workflowId,
    processId: 'main-process',
    status: 'running',
    variables: { authorized: false },
    tokens: [{ id: 'tok_3', nodeId: 'start', state: 'active', enteredAt: app.clock() }],
    history: [],
    startedAt: app.clock(),
    startedBy: 'tester',
  };

  await engine.runToQuiescence(inst, dep);

  // failing node was retried after auth repair and completed
  assert.equal(inst.status, 'completed');
  assert.equal(inst.variables.data, 'authorized_access');
  assert.equal(inst.variables.authorized, true);
});

test('Hierarchical Error Handling: Circuit Breaker prevents recursion if Global Error Handler itself throws', async () => {
  const app = createMockApp();
  const engine = new ExecutionEngine(app);

  const project: EngineProject = {
    id: 'test-wf',
    name: 'Test Workflow',
    processes: [
      {
        id: 'main-process',
        name: 'Main Process',
        package: 'com.test',
        vars: [],
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'fail_node', type: 'script', code: 'throw new Error("primary fail");' },
          { id: 'end', type: 'end' },
        ],
        flows: [
          { from: 'start', to: 'fail_node' },
          { from: 'fail_node', to: 'end' },
        ],
      },
      {
        id: 'broken-handler',
        name: 'Broken Handler',
        package: 'com.test',
        vars: [],
        nodes: [
          { id: 'err_start', type: 'start' },
          { id: 'err_fail', type: 'script', code: 'throw new Error("handler internal fail");' },
          { id: 'err_end', type: 'end' },
        ],
        flows: [
          { from: 'err_start', to: 'err_fail' },
          { from: 'err_fail', to: 'err_end' },
        ],
      },
    ],
  } as unknown as EngineProject;

  const dep: Deployment = {
    id: 'dep_4',
    tenantId: app.tenantId,
    workflowId: 'wf_4',
    versionId: 'ver_4',
    branchId: 'br_4',
    engine: project,
    env: {},
    tags: ['prod'],
    status: 'active',
    environment: 'prod',
    deployedAt: app.clock(),
    deployedBy: 'tester',
    globalErrorHandler: {
      enabled: true,
      processId: 'broken-handler',
      strategy: 'repair-and-resume',
    },
  };

  const inst: Instance = {
    id: 'inst_4',
    tenantId: app.tenantId,
    deploymentId: dep.id,
    workflowId: dep.workflowId,
    processId: 'main-process',
    status: 'running',
    variables: {},
    tokens: [{ id: 'tok_4', nodeId: 'start', state: 'active', enteredAt: app.clock() }],
    history: [],
    startedAt: app.clock(),
    startedBy: 'tester',
  };

  // Must not throw step budget loop error or stack overflow
  await engine.runToQuiescence(inst, dep);

  assert.equal(inst.status, 'failed');
  assert.ok(inst.error);
});

test('Environment Variables: Workflow.env merges into Deployment.env and is accessible in runtime sandbox', async () => {
  const app = createMockApp();
  const wfService = new WorkflowService(app);
  const verService = new VersionService(app);
  const depService = new DeploymentService(app);
  const engine = new ExecutionEngine(app);

  const wf = await wfService.create({ name: 'Env Project', key: 'env-project' }, 'tester');
  await wfService.update(
    wf.id,
    {
      env: {
        INTEGRATION_LAYER_URL: 'https://pru-integration.internal',
        CUSTOM_API_KEY: 'pru_secret_key_999',
      },
    },
    'tester'
  );

  const draftVer = (await verService.listByBranch(wf.defaultBranchId))[0];
  const proc = draftVer.engine.processes[0];
  proc.nodes = [
    { id: 'start', type: 'start' },
    {
      id: 'env_reader_script',
      type: 'script',
      code: `
        vars.readKey = env.CUSTOM_API_KEY;
        vars.readUrl = System.getenv("INTEGRATION_LAYER_URL");
      `,
    },
    { id: 'end', type: 'end' },
  ];
  proc.flows = [
    { from: 'start', to: 'env_reader_script' },
    { from: 'env_reader_script', to: 'end' },
  ];
  const savedDraft = await verService.saveDraft(wf.defaultBranchId, draftVer.engine, 'tester');
  const pub = await verService.publish(savedDraft.id, 'tester');

  // Deploy
  const dep = await depService.deploy(pub.published.id, { environment: 'prod', activate: true }, 'tester');

  // Deployment inherited project environment variables!
  assert.equal(dep.env['INTEGRATION_LAYER_URL'], 'https://pru-integration.internal');
  assert.equal(dep.env['CUSTOM_API_KEY'], 'pru_secret_key_999');

  const inst: Instance = {
    id: 'inst_env_test',
    tenantId: app.tenantId,
    deploymentId: dep.id,
    workflowId: dep.workflowId,
    processId: proc.id,
    status: 'running',
    variables: {},
    tokens: [{ id: 'tok_env', nodeId: 'start', state: 'active', enteredAt: app.clock() }],
    history: [],
    startedAt: app.clock(),
    startedBy: 'tester',
  };

  await engine.runToQuiescence(inst, dep);

  assert.equal(inst.status, 'completed');
  assert.equal(inst.variables.readKey, 'pru_secret_key_999');
  assert.equal(inst.variables.readUrl, 'https://pru-integration.internal');
});

test('Hierarchical Error Handling: Local boundary with rethrow bubbles to Global Error Handler', async () => {
  const app = createMockApp();
  const engine = new ExecutionEngine(app);

  const project: EngineProject = {
    id: 'test-wf',
    name: 'Test Workflow',
    processes: [
      {
        id: 'main-process',
        name: 'Main Process',
        package: 'com.test',
        vars: [],
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'failing_node', type: 'script', code: 'throw new Error("local initial err");' },
          { id: 'local_boundary', type: 'boundary', on: 'failing_node', event: { error: 'SCRIPT_ERROR' } },
          { id: 'local_step', type: 'script', code: 'vars.localAudit = "logged_locally";' },
          // Error end with rethrow: true
          { id: 'rethrow_end', type: 'end', throw: { error: 'FATAL_ERROR', rethrow: true } },
        ],
        flows: [
          { from: 'start', to: 'failing_node' },
          { from: 'local_boundary', to: 'local_step' },
          { from: 'local_step', to: 'rethrow_end' },
        ],
      },
      {
        id: 'global-escalation-proc',
        name: 'Global Escalation Process',
        package: 'com.test',
        vars: [],
        nodes: [
          { id: 'err_start', type: 'start' },
          { id: 'err_script', type: 'script', code: 'vars.handledBy = "global_after_rethrow";' },
          { id: 'err_end', type: 'end' },
        ],
        flows: [
          { from: 'err_start', to: 'err_script' },
          { from: 'err_script', to: 'err_end' },
        ],
      },
    ],
  } as unknown as EngineProject;

  const dep: Deployment = {
    id: 'dep_rethrow',
    tenantId: app.tenantId,
    workflowId: 'wf_rethrow',
    versionId: 'ver_rethrow',
    branchId: 'br_rethrow',
    engine: project,
    env: {},
    tags: ['prod'],
    status: 'active',
    environment: 'prod',
    deployedAt: app.clock(),
    deployedBy: 'tester',
    globalErrorHandler: {
      enabled: true,
      processId: 'global-escalation-proc',
      strategy: 'repair-and-resume',
      outputMappings: {
        handledBy: 'handledBy',
      },
    },
  };

  const inst: Instance = {
    id: 'inst_rethrow',
    tenantId: app.tenantId,
    deploymentId: dep.id,
    workflowId: dep.workflowId,
    processId: 'main-process',
    status: 'running',
    variables: {},
    tokens: [{ id: 'tok_rethrow', nodeId: 'start', state: 'active', enteredAt: app.clock() }],
    history: [],
    startedAt: app.clock(),
    startedBy: 'tester',
  };

  await engine.runToQuiescence(inst, dep);

  assert.equal(inst.status, 'completed');
  assert.equal(inst.variables.localAudit, 'logged_locally');
  assert.equal(inst.variables.handledBy, 'global_after_rethrow');
});

test('Hierarchical Error Handling: Global Error Handler filter skips non-matching errors', async () => {
  const app = createMockApp();
  const engine = new ExecutionEngine(app);

  const project: EngineProject = {
    id: 'test-wf',
    name: 'Test Workflow',
    processes: [
      {
        id: 'main-process',
        name: 'Main Process',
        package: 'com.test',
        vars: [],
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'failing_node', type: 'script', code: 'throw new Error("unfiltered script error");' },
          { id: 'end', type: 'end' },
        ],
        flows: [
          { from: 'start', to: 'failing_node' },
          { from: 'failing_node', to: 'end' },
        ],
      },
      {
        id: 'service-only-handler',
        name: 'Service Only Handler',
        package: 'com.test',
        vars: [],
        nodes: [
          { id: 'err_start', type: 'start' },
          { id: 'err_script', type: 'script', code: 'vars.handlerRan = true;' },
          { id: 'err_end', type: 'end' },
        ],
        flows: [
          { from: 'err_start', to: 'err_script' },
          { from: 'err_script', to: 'err_end' },
        ],
      },
    ],
  } as unknown as EngineProject;

  const dep: Deployment = {
    id: 'dep_filter',
    tenantId: app.tenantId,
    workflowId: 'wf_filter',
    versionId: 'ver_filter',
    branchId: 'br_filter',
    engine: project,
    env: {},
    tags: ['prod'],
    status: 'active',
    environment: 'prod',
    deployedAt: app.clock(),
    deployedBy: 'tester',
    globalErrorHandler: {
      enabled: true,
      processId: 'service-only-handler',
      filter: ['SERVICE_ERROR'], // only SERVICE_ERROR is filtered in, so SCRIPT_ERROR fails
      strategy: 'repair-and-resume',
    },
  };

  const inst: Instance = {
    id: 'inst_filter',
    tenantId: app.tenantId,
    deploymentId: dep.id,
    workflowId: dep.workflowId,
    processId: 'main-process',
    status: 'running',
    variables: {},
    tokens: [{ id: 'tok_filter', nodeId: 'start', state: 'active', enteredAt: app.clock() }],
    history: [],
    startedAt: app.clock(),
    startedBy: 'tester',
  };

  await engine.runToQuiescence(inst, dep);

  // Filter bypassed SCRIPT_ERROR, so the instance failed as unhandled
  assert.equal(inst.status, 'failed');
  assert.equal(inst.variables.handlerRan, undefined);
});

