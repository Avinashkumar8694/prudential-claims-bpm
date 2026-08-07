// OpenAPI 3.0 specification for the engine's REST API, served at GET /api/openapi.json and rendered
// by Swagger UI at GET /api/docs. Hand-authored to mirror the jBPM KIE-Server Swagger surface: authoring,
// versioning, deployment lifecycle, runtime instances, human tasks, and the query/analytics module.

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const listOf = (name: string) => ({ type: 'object', properties: { items: { type: 'array', items: ref(name) } } });
const ok = (schema: any) => ({ '200': { description: 'OK', content: { 'application/json': { schema } } } });
const created = (schema: any) => ({ '201': { description: 'Created', content: { 'application/json': { schema } } } });
const idParam = (name = 'id', desc = 'Resource id') => ({ name, in: 'path', required: true, schema: { type: 'string' }, description: desc });
const q = (name: string, desc: string) => ({ name, in: 'query', required: false, schema: { type: 'string' }, description: desc });
const jsonBody = (schema: any, required = true) => ({ required, content: { 'application/json': { schema } } });

// ---- reusable component schemas (core entities) ----
const schemas = {
  Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } } },
  Problem: { type: 'object', properties: { rule: { type: 'string' }, severity: { type: 'string', enum: ['error', 'warning'] }, message: { type: 'string' }, nodeId: { type: 'string' } } },
  ValidationResult: { type: 'object', properties: { ok: { type: 'boolean' }, errors: { type: 'array', items: ref('Problem') }, warnings: { type: 'array', items: ref('Problem') } } },
  Workflow: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, defaultBranchId: { type: 'string' }, variables: { type: 'array', items: {} }, createdAt: { type: 'string', format: 'date-time' } } },
  Branch: { type: 'object', properties: { id: { type: 'string' }, workflowId: { type: 'string' }, name: { type: 'string' }, headVersionId: { type: 'string' } } },
  Version: { type: 'object', properties: { id: { type: 'string' }, branchId: { type: 'string' }, workflowId: { type: 'string' }, number: { type: 'integer' }, label: { type: 'string' }, state: { type: 'string', enum: ['draft', 'published'] }, engine: { type: 'object' } } },
  Deployment: { type: 'object', properties: { id: { type: 'string' }, workflowId: { type: 'string' }, versionId: { type: 'string' }, environment: { type: 'string' }, status: { type: 'string', enum: ['active', 'inactive', 'archived'] }, tags: { type: 'array', items: { type: 'string' } }, versionNumber: { type: 'integer' }, versionLabel: { type: 'string' }, env: { type: 'object', additionalProperties: { type: 'string' } }, deployedAt: { type: 'string', format: 'date-time' } } },
  NodeVisit: { type: 'object', properties: { tokenId: { type: 'string' }, nodeId: { type: 'string' }, type: { type: 'string' }, enteredAt: { type: 'string' }, exitedAt: { type: 'string' }, outcome: { type: 'string' } } },
  Token: { type: 'object', properties: { id: { type: 'string' }, nodeId: { type: 'string' }, state: { type: 'string', enum: ['active', 'waiting'] }, waitFor: { type: 'object' } } },
  Instance: { type: 'object', properties: { id: { type: 'string' }, workflowId: { type: 'string' }, deploymentId: { type: 'string' }, processId: { type: 'string' }, correlationKey: { type: 'string' }, status: { type: 'string', enum: ['running', 'waiting', 'completed', 'aborted', 'failed', 'suspended'] }, variables: { type: 'object' }, tokens: { type: 'array', items: ref('Token') }, history: { type: 'array', items: ref('NodeVisit') }, parentInstanceId: { type: 'string' }, startedAt: { type: 'string' }, startedBy: { type: 'string' }, endedAt: { type: 'string' } } },
  InstanceGraph: { type: 'object', properties: { nodes: { type: 'array', items: {} }, flows: { type: 'array', items: {} }, diagram: { type: 'object', properties: { activeNodeIds: { type: 'array', items: { type: 'string' } }, visitedNodeIds: { type: 'array', items: { type: 'string' } }, status: { type: 'string' } } }, counts: { type: 'object', additionalProperties: { type: 'integer' }, description: 'per-node execution count (jBPM instance badges)' }, status: { type: 'string' } } },
  Task: { type: 'object', properties: { id: { type: 'string' }, instanceId: { type: 'string' }, nodeId: { type: 'string' }, name: { type: 'string' }, group: { type: 'string' }, assignee: { type: 'string' }, status: { type: 'string', enum: ['created', 'reserved', 'inprogress', 'completed', 'skipped', 'error'] }, inputs: { type: 'object' }, outputs: { type: 'object' }, createdAt: { type: 'string' }, dueAt: { type: 'string' }, completedAt: { type: 'string' }, completedBy: { type: 'string' } } },
  TimerJob: { type: 'object', properties: { id: { type: 'string' }, instanceId: { type: 'string' }, nodeId: { type: 'string' }, kind: { type: 'string', enum: ['duration', 'cycle', 'date', 'start'] }, dueAt: { type: 'string' }, cycle: { type: 'string' }, status: { type: 'string', enum: ['scheduled', 'fired', 'cancelled'] }, deploymentId: { type: 'string' }, processId: { type: 'string' } } },
  UserRow: { type: 'object', properties: { user: { type: 'string' }, groups: { type: 'array', items: { type: 'string' } }, startedInstances: { type: 'integer' }, openTasks: { type: 'integer' }, completedTasks: { type: 'integer' } } },
  ProcessDef: { type: 'object', properties: { processId: { type: 'string' }, name: { type: 'string' }, package: { type: 'string' }, deploymentId: { type: 'string' }, environment: { type: 'string' }, version: { type: 'string' }, nodes: { type: 'integer' }, instances: { type: 'object', properties: { total: { type: 'integer' }, active: { type: 'integer' } } } } },
  DurStats: { type: 'object', properties: { count: { type: 'integer' }, avgMs: { type: 'integer' }, minMs: { type: 'integer' }, maxMs: { type: 'integer' } } },
  Summary: { type: 'object', properties: { instances: { type: 'object' }, tasks: { type: 'object' }, deployments: { type: 'object' }, jobs: { type: 'object' } } },
  User: { type: 'object', properties: { id: { type: 'string' }, username: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } }, groups: { type: 'array', items: { type: 'string' } }, active: { type: 'boolean' }, createdAt: { type: 'string' } } },
  Group: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } } },
  Role: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } } } },
};

// ---- paths (grouped by tag) ----
const paths: Record<string, any> = {
  '/catalog/nodes': { get: { tags: ['Catalog'], summary: 'Node palette, property schemas and connection ports', responses: ok({ type: 'object' }) } },
  '/catalog/nodes/{engineType}': { get: { tags: ['Catalog'], summary: 'One node type definition', parameters: [idParam('engineType', 'Engine node type')], responses: { ...ok({ type: 'object' }), '404': { description: 'Not found', content: { 'application/json': { schema: ref('Error') } } } } } },
  '/validate': { post: { tags: ['Authoring'], summary: 'Validate an in-progress process (no save)', requestBody: jsonBody({ type: 'object' }), responses: ok(ref('ValidationResult')) } },
  '/import/jbpm': { post: { tags: ['Import/Export'], summary: 'Import a jBPM kjar (file map) as a new project', requestBody: jsonBody({ type: 'object', properties: { files: { type: 'object', additionalProperties: { type: 'string' } }, name: { type: 'string' } } }), responses: created({ type: 'object', properties: { workflowId: { type: 'string' }, processes: { type: 'integer' } } }) } },

  '/workflows': {
    get: { tags: ['Projects'], summary: 'List projects', responses: ok(listOf('Workflow')) },
    post: { tags: ['Projects'], summary: 'Create a project', requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } }), responses: created(ref('Workflow')) },
  },
  '/workflows/{id}': {
    get: { tags: ['Projects'], summary: 'Get a project', parameters: [idParam()], responses: ok(ref('Workflow')) },
    patch: { tags: ['Projects'], summary: 'Update a project', parameters: [idParam()], requestBody: jsonBody({ type: 'object' }), responses: ok(ref('Workflow')) },
    delete: { tags: ['Projects'], summary: 'Archive a project', parameters: [idParam()], responses: { '204': { description: 'Archived' } } },
  },
  '/workflows/{id}/permissions': { put: { tags: ['Projects'], summary: 'Set project permissions', parameters: [idParam()], requestBody: jsonBody({ type: 'array', items: {} }), responses: ok(ref('Workflow')) } },
  '/workflows/{id}/variables': { put: { tags: ['Projects'], summary: 'Set project variables', parameters: [idParam()], requestBody: jsonBody({ type: 'array', items: {} }), responses: ok(ref('Workflow')) } },
  '/workflows/{id}/processes': {
    get: { tags: ['Processes'], summary: 'List processes in a project', parameters: [idParam()], responses: ok(listOf('ProcessDef')) },
    post: { tags: ['Processes'], summary: 'Add a process', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' } } }), responses: created({ type: 'object' }) },
  },
  '/workflows/{id}/processes/{pid}': {
    get: { tags: ['Processes'], summary: 'Get a process definition', parameters: [idParam(), idParam('pid', 'Process id')], responses: ok({ type: 'object' }) },
    put: { tags: ['Processes'], summary: 'Save a process definition', parameters: [idParam(), idParam('pid', 'Process id')], requestBody: jsonBody({ type: 'object' }), responses: ok({ type: 'object' }) },
    patch: { tags: ['Processes'], summary: 'Rename a process', parameters: [idParam(), idParam('pid', 'Process id')], requestBody: jsonBody({ type: 'object' }), responses: ok({ type: 'object' }) },
    delete: { tags: ['Processes'], summary: 'Remove a process', parameters: [idParam(), idParam('pid', 'Process id')], responses: { '204': { description: 'Removed' } } },
  },
  '/workflows/{id}/engine': { get: { tags: ['Projects'], summary: 'Assembled engine model (all processes + assets) for a project', parameters: [idParam()], responses: ok({ type: 'object' }) } },
  '/workflows/{id}/assets': {
    get: { tags: ['Assets'], summary: 'List project assets by kind', parameters: [idParam()], responses: ok({ type: 'object' }) },
    post: { tags: ['Assets'], summary: 'Add an asset', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { kind: { type: 'string' }, name: { type: 'string' } } }), responses: created({ type: 'object' }) },
  },
  '/workflows/{id}/branches': {
    get: { tags: ['Versioning'], summary: 'List branches', parameters: [idParam()], responses: ok(listOf('Branch')) },
    post: { tags: ['Versioning'], summary: 'Create a branch', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, fromVersionId: { type: 'string' } } }), responses: created(ref('Branch')) },
  },
  '/branches/{id}': { get: { tags: ['Versioning'], summary: 'Get a branch', parameters: [idParam()], responses: ok(ref('Branch')) } },
  '/branches/{id}/versions': {
    get: { tags: ['Versioning'], summary: 'List versions on a branch', parameters: [idParam()], responses: ok(listOf('Version')) },
    post: { tags: ['Versioning'], summary: 'Save a draft version', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { engine: { type: 'object' }, message: { type: 'string' } } }), responses: created(ref('Version')) },
  },
  '/versions/{id}': { get: { tags: ['Versioning'], summary: 'Get a version', parameters: [idParam()], responses: ok(ref('Version')) } },
  '/versions/{id}/publish': { post: { tags: ['Versioning'], summary: 'Publish a draft (immutable) version', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { label: { type: 'string' } } }, false), responses: ok({ type: 'object' }) } },
  '/versions/{id}/validate': { post: { tags: ['Versioning'], summary: 'Validate a version', parameters: [idParam()], responses: ok(ref('ValidationResult')) } },
  '/versions/{a}/diff/{b}': { get: { tags: ['Versioning'], summary: 'Diff two versions', parameters: [idParam('a', 'Version A'), idParam('b', 'Version B')], responses: ok({ type: 'object' }) } },
  '/versions/{id}/deploy': { post: { tags: ['Deployments'], summary: 'Deploy a published version', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { environment: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, env: { type: 'object' }, activate: { type: 'boolean' } } }), responses: created(ref('Deployment')) } },
  '/versions/{id}/export': { get: { tags: ['Import/Export'], summary: 'Export a version as a jBPM kjar (file map)', parameters: [idParam()], responses: ok({ type: 'object', properties: { files: { type: 'object', additionalProperties: { type: 'string' } } } }) } },

  '/workflows/{id}/deployments': { get: { tags: ['Deployments'], summary: 'List deployments for a project', parameters: [idParam()], responses: ok(listOf('Deployment')) } },
  '/deployments/{id}': { get: { tags: ['Deployments'], summary: 'Get a deployment', parameters: [idParam()], responses: ok(ref('Deployment')) } },
  '/deployments/{id}/tags': { post: { tags: ['Deployments'], summary: 'Add/remove deployment tags', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } } }), responses: ok(ref('Deployment')) } },
  '/deployments/{id}/activate': { post: { tags: ['Deployments'], summary: 'Activate (swaps the active one in the environment)', parameters: [idParam()], responses: ok(ref('Deployment')) } },
  '/deployments/{id}/rollback': { post: { tags: ['Deployments'], summary: 'Roll back to this deployment', parameters: [idParam()], responses: ok(ref('Deployment')) } },
  '/deployments/{id}/undeploy': { post: { tags: ['Deployments'], summary: 'Undeploy (deactivate)', parameters: [idParam()], responses: ok(ref('Deployment')) } },
  '/deployments/{id}/archive': { post: { tags: ['Deployments'], summary: 'Archive a deployment', parameters: [idParam()], responses: ok(ref('Deployment')) } },
  '/deployments/{id}/export': { get: { tags: ['Import/Export'], summary: 'Export a deployment as a jBPM kjar', parameters: [idParam()], responses: ok({ type: 'object' }) } },
  '/deployments/{id}/definitions': { get: { tags: ['Processes'], summary: 'Process definitions in a deployment', parameters: [idParam()], responses: ok(listOf('ProcessDef')) } },

  '/instances': {
    get: { tags: ['Instances'], summary: 'List process instances', parameters: [q('workflowId', 'Filter by project'), q('status', 'Filter by status'), q('deploymentId', 'Filter by deployment'), q('correlationKey', 'Filter by correlation key')], responses: ok(listOf('Instance')) },
    post: { tags: ['Instances'], summary: 'Start a process instance', requestBody: jsonBody({ type: 'object', properties: { workflowId: { type: 'string' }, processId: { type: 'string' }, environment: { type: 'string' }, deploymentId: { type: 'string' }, variables: { type: 'object' }, correlationKey: { type: 'string' } } }), responses: created(ref('Instance')) },
  },
  '/instances/{id}': { get: { tags: ['Instances'], summary: 'Get an instance', parameters: [idParam()], responses: ok(ref('Instance')) } },
  '/instances/{id}/history': { get: { tags: ['Instances'], summary: 'Node-visit history', parameters: [idParam()], responses: ok({ type: 'array', items: ref('NodeVisit') }) } },
  '/instances/{id}/graph': { get: { tags: ['Instances'], summary: 'Diagram + per-node execution counts (instance badges)', parameters: [idParam()], responses: ok(ref('InstanceGraph')) } },
  '/instances/{id}/diagram-state': { get: { tags: ['Instances'], summary: 'Active/visited node ids', parameters: [idParam()], responses: ok({ type: 'object' }) } },
  '/instances/{id}/related': { get: { tags: ['Instances'], summary: 'Parent + child (sub-process) instances', parameters: [idParam()], responses: ok({ type: 'object' }) } },
  '/instances/{id}/signal': { post: { tags: ['Instances'], summary: 'Send a signal/message to the instance', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, payload: {} } }), responses: ok(ref('Instance')) } },
  '/instances/{id}/retry': { post: { tags: ['Instances'], summary: 'Re-trigger a node (retry / replay)', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { nodeId: { type: 'string' } } }), responses: ok(ref('Instance')) } },
  '/instances/{id}/suspend': { post: { tags: ['Instances'], summary: 'Suspend (cascades to the whole subtree)', parameters: [idParam()], responses: ok(ref('Instance')) } },
  '/instances/{id}/resume': { post: { tags: ['Instances'], summary: 'Resume the subtree', parameters: [idParam()], responses: ok(ref('Instance')) } },
  '/instances/{id}/abort': { post: { tags: ['Instances'], summary: 'Abort (cascades to active children)', parameters: [idParam()], responses: ok(ref('Instance')) } },

  '/tasks': { get: { tags: ['Human Tasks'], summary: 'List tasks', parameters: [q('assignee', 'Owned by user'), q('group', 'Group queue'), q('status', 'Task status'), q('overdue', 'true = only tasks past their dueAt and not yet completed/skipped')], responses: ok(listOf('Task')) } },
  '/tasks/{id}': { get: { tags: ['Human Tasks'], summary: 'Get a task', parameters: [idParam()], responses: ok(ref('Task')) } },
  '/tasks/{id}/claim': { post: { tags: ['Human Tasks'], summary: 'Claim a task', parameters: [idParam()], responses: ok(ref('Task')) } },
  '/tasks/{id}/release': { post: { tags: ['Human Tasks'], summary: 'Release a task', parameters: [idParam()], responses: ok(ref('Task')) } },
  '/tasks/{id}/complete': { post: { tags: ['Human Tasks'], summary: 'Complete a task (resumes the instance)', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { outputs: { type: 'object' } } }), responses: ok(ref('Task')) } },
  '/tasks/{id}/skip': { post: { tags: ['Human Tasks'], summary: 'Skip a task without completing it (only if the node is declared skippable)', parameters: [idParam()], responses: ok(ref('Task')) } },

  '/query/process-definitions': { get: { tags: ['Query & Analytics'], summary: 'All active process definitions with live stats', responses: ok(listOf('ProcessDef')) } },
  '/query/process-definitions/{processId}/instances': { get: { tags: ['Query & Analytics'], summary: 'Instances of a process definition', parameters: [idParam('processId', 'Process id'), q('status', 'Filter by status')], responses: ok(listOf('Instance')) } },
  '/query/process-definitions/{processId}/signals': { get: { tags: ['Query & Analytics'], summary: 'Signals a process listens-for / throws', parameters: [idParam('processId', 'Process id')], responses: ok({ type: 'object', properties: { processId: { type: 'string' }, listensFor: { type: 'array', items: { type: 'string' } }, throws: { type: 'array', items: { type: 'string' } } } }) } },
  '/query/users': { get: { tags: ['Query & Analytics'], summary: 'Derived user directory with work counts', responses: ok(listOf('UserRow')) } },
  '/query/users/{user}/tasks': { get: { tags: ['Query & Analytics'], summary: 'Tasks owned by a user (inbox)', parameters: [idParam('user', 'User'), q('status', 'Task status')], responses: ok(listOf('Task')) } },
  '/query/users/{user}/tasks/completed': { get: { tags: ['Query & Analytics'], summary: 'Tasks completed by a user', parameters: [idParam('user', 'User')], responses: ok(listOf('Task')) } },
  '/query/groups/{group}/tasks': { get: { tags: ['Query & Analytics'], summary: 'Tasks for a group (queue)', parameters: [idParam('group', 'Group'), q('status', 'Task status')], responses: ok(listOf('Task')) } },
  '/query/instances/{id}/tasks': { get: { tags: ['Query & Analytics'], summary: 'Tasks of a process instance', parameters: [idParam()], responses: ok(listOf('Task')) } },
  '/query/analytics/tasks': { get: { tags: ['Query & Analytics'], summary: 'Task turn-around-time (by task, by assignee)', responses: ok({ type: 'object' }) } },
  '/query/analytics/processes': { get: { tags: ['Query & Analytics'], summary: 'Process turn-around-time + status mix', responses: ok({ type: 'object' }) } },
  '/query/analytics/summary': { get: { tags: ['Query & Analytics'], summary: 'Dashboard summary counts', responses: ok(ref('Summary')) } },
  '/query/jobs': { get: { tags: ['Query & Analytics'], summary: 'Timer jobs', parameters: [q('status', 'scheduled|fired|cancelled')], responses: ok(listOf('TimerJob')) } },

  '/auth/login': { post: { tags: ['IAM'], security: [], summary: 'Log in — issues a JWT (Bearer token) for every other endpoint', requestBody: jsonBody({ type: 'object', properties: { username: { type: 'string' }, password: { type: 'string' } } }), responses: { ...ok({ type: 'object', properties: { token: { type: 'string' }, user: ref('User') } }), '401': { description: 'Invalid credentials', content: { 'application/json': { schema: ref('Error') } } } } } },
  '/users': {
    get: { tags: ['IAM'], summary: 'List users (admin)', responses: ok(listOf('User')) },
    post: { tags: ['IAM'], summary: 'Create a user (admin)', requestBody: jsonBody({ type: 'object', properties: { username: { type: 'string' }, password: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } }, groups: { type: 'array', items: { type: 'string' } } } }), responses: created(ref('User')) },
  },
  '/users/{id}': {
    get: { tags: ['IAM'], summary: 'Get a user (admin)', parameters: [idParam()], responses: ok(ref('User')) },
    patch: { tags: ['IAM'], summary: 'Update a user’s roles/groups/active flag (admin)', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { roles: { type: 'array', items: { type: 'string' } }, groups: { type: 'array', items: { type: 'string' } }, active: { type: 'boolean' } } }), responses: ok(ref('User')) },
  },
  '/users/{id}/password': { post: { tags: ['IAM'], summary: 'Set a user’s password (admin)', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { password: { type: 'string' } } }), responses: { '204': { description: 'Changed' } } } },
  '/groups': {
    get: { tags: ['IAM'], summary: 'List groups (admin)', responses: ok(listOf('Group')) },
    post: { tags: ['IAM'], summary: 'Create a group (admin)', requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } }), responses: created(ref('Group')) },
  },
  '/groups/{id}': { delete: { tags: ['IAM'], summary: 'Delete a group (admin)', parameters: [idParam()], responses: { '204': { description: 'Deleted' } } } },
  '/roles': {
    get: { tags: ['IAM'], summary: 'List roles (admin)', responses: ok(listOf('Role')) },
    post: { tags: ['IAM'], summary: 'Create a role (admin)', requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } } } }), responses: created(ref('Role')) },
  },
  '/roles/{id}': {
    patch: { tags: ['IAM'], summary: 'Replace a role’s permissions (admin; the built-in "admin" role is immutable)', parameters: [idParam()], requestBody: jsonBody({ type: 'object', properties: { permissions: { type: 'array', items: { type: 'string' } } } }), responses: ok(ref('Role')) },
    delete: { tags: ['IAM'], summary: 'Delete a role (admin; the built-in "admin" role cannot be deleted)', parameters: [idParam()], responses: { '204': { description: 'Deleted' } } },
  },
};

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'jBPM-style BPM Engine API',
    version: '0.1.0',
    description: 'Node-native BPM engine REST API — authoring, versioning, deployment lifecycle, runtime process instances, human tasks, KIE-Server-style query & analytics, and IAM (users/groups/roles). `POST /auth/login` issues a JWT; send it as `Authorization: Bearer <token>` on every other request. Each route requires a permission granted by one of the caller’s roles — see `DEFAULT_ROLES` in modules/iam/service.ts.',
  },
  servers: [{ url: '/api', description: 'This server' }],
  tags: [
    { name: 'Catalog' }, { name: 'Authoring' }, { name: 'Projects' }, { name: 'Processes' }, { name: 'Assets' },
    { name: 'Versioning' }, { name: 'Deployments' }, { name: 'Instances' }, { name: 'Human Tasks' },
    { name: 'Query & Analytics' }, { name: 'Import/Export' }, { name: 'IAM' },
  ],
  components: {
    schemas,
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
  security: [{ bearerAuth: [] }],
  paths,
};

/** Minimal self-contained Swagger UI page (loads the swagger-ui assets from a CDN). */
export const swaggerHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BPM Engine API — Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style> body { margin: 0; } .topbar { display: none; } </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({ url: 'openapi.json', dom_id: '#swagger-ui', deepLinking: true, docExpansion: 'none', filter: true });
  </script>
</body>
</html>`;
