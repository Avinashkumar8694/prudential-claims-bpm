// All REST routes (see docs/05-api-spec.md). One assembled router to keep the wiring in one place.
// A per-request AppContext + actor are attached by contextMiddleware (see app.ts); requireAuth (also
// app.ts) verifies the caller's JWT before anything here runs. Each route additionally declares the
// permission it needs via requirePermission(action) — see http/auth-middleware.ts and
// modules/iam/service.ts's DEFAULT_ROLES for what grants what.
import { Router } from 'express';
import type { Request } from 'express';
import { asyncHandler } from '../infra/errors.ts';
import type { AppContext } from '../context.ts';
import { WorkflowService } from '../modules/workflows/service.ts';
import { BranchService } from '../modules/branches/service.ts';
import { VersionService } from '../modules/versions/service.ts';
import { DeploymentService } from '../modules/deployments/service.ts';
import { InstanceService } from '../modules/instances/service.ts';
import { TaskService } from '../modules/tasks/service.ts';
import { ProcessService } from '../modules/processes/service.ts';
import { QueryService } from '../modules/queries/service.ts';
import { AssetsService } from '../modules/assets/service.ts';
import { IamService } from '../modules/iam/service.ts';
import { NODE_DEFS, NODE_DEF_BY_TYPE, CATEGORIES } from '../engine/nodes/index.ts';
import { exportKjar } from '../modules/export/service.ts';
import { ImportService } from '../modules/import/service.ts';
import { ValidationService } from '../modules/validation/service.ts';
import { openapiSpec, swaggerHtml } from './openapi.ts';
import { hub } from '../infra/ws-hub.ts';
import { requirePermission } from './auth-middleware.ts';

const ctxOf = (req: Request): AppContext => (req as any).ctx;
const actorOf = (req: Request): string => (req as any).actor;
const emit = hub.engineEmit;
const perm = requirePermission;

export function buildRoutes(): Router {
  const r = Router();

  // --- API docs: OpenAPI spec + Swagger UI (jBPM-style) — any authenticated caller ---
  r.get('/openapi.json', (_req, res) => res.json(openapiSpec));
  r.get('/docs', (_req, res) => res.type('html').send(swaggerHtml));

  // --- catalog: the UI gets the node list + per-node config (palette, ports, property schema) here ---
  r.get('/catalog/nodes', (_req, res) => res.json({
    categories: CATEGORIES,
    nodes: NODE_DEFS.flatMap((d) => d.palette),                                  // palette tiles
    schemas: Object.fromEntries(NODE_DEFS.map((d) => [d.engineType, d.schema])), // engineType → property form
    ports: Object.fromEntries(NODE_DEFS.map((d) => [d.engineType, d.ports])),    // engineType → { in, out }
  }));
  r.get('/catalog/nodes/:engineType', (req, res) => {
    const def = NODE_DEF_BY_TYPE[req.params.engineType];
    if (!def) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'node type not found' } });
    res.json(def);
  });

  // --- validation (validate an in-progress engine process, no save) — any authenticated caller ---
  r.post('/validate', asyncHandler(async (req, res) => res.json(await new ValidationService().validate((req.body?.engine?.processes?.[0]) || req.body?.process || req.body))));

  // --- import a jBPM kjar (file map) as a new project ---
  r.post('/import/jbpm', perm('workflow:edit'), asyncHandler(async (req, res) => res.status(201).json(await new ImportService(ctxOf(req)).importKjar(req.body?.files, req.body?.name, actorOf(req)))));

  // --- workflows ---
  r.get('/workflows', perm('workflow:view'), asyncHandler(async (req, res) => res.json({ items: await new WorkflowService(ctxOf(req)).list() })));
  r.post('/workflows', perm('workflow:edit'), asyncHandler(async (req, res) => res.status(201).json(await new WorkflowService(ctxOf(req)).create(req.body, actorOf(req)))));
  r.get('/workflows/:id', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new WorkflowService(ctxOf(req)).get(req.params.id))));
  r.patch('/workflows/:id', perm('workflow:edit'), asyncHandler(async (req, res) => res.json(await new WorkflowService(ctxOf(req)).update(req.params.id, req.body, actorOf(req)))));
  r.delete('/workflows/:id', perm('workflow:edit'), asyncHandler(async (req, res) => { await new WorkflowService(ctxOf(req)).archive(req.params.id, actorOf(req)); res.status(204).end(); }));
  r.put('/workflows/:id/permissions', perm('workflow:edit'), asyncHandler(async (req, res) => res.json(await new WorkflowService(ctxOf(req)).setPermissions(req.params.id, req.body, actorOf(req)))));
  r.put('/workflows/:id/variables', perm('workflow:edit'), asyncHandler(async (req, res) => res.json(await new WorkflowService(ctxOf(req)).setVariables(req.params.id, req.body, actorOf(req)))));

  // --- processes within a project ---
  r.get('/workflows/:id/processes', perm('workflow:view'), asyncHandler(async (req, res) => res.json({ items: await new ProcessService(ctxOf(req)).list(req.params.id) })));
  r.post('/workflows/:id/processes', perm('workflow:edit'), asyncHandler(async (req, res) => res.status(201).json(await new ProcessService(ctxOf(req)).add(req.params.id, req.body?.name, actorOf(req)))));
  r.get('/workflows/:id/processes/:pid', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new ProcessService(ctxOf(req)).getProcess(req.params.id, req.params.pid))));
  r.put('/workflows/:id/processes/:pid', perm('workflow:edit'), asyncHandler(async (req, res) => { await new ProcessService(ctxOf(req)).saveProcess(req.params.id, req.params.pid, req.body?.process || req.body, actorOf(req)); res.json({ ok: true }); }));
  r.patch('/workflows/:id/processes/:pid', perm('workflow:edit'), asyncHandler(async (req, res) => { await new ProcessService(ctxOf(req)).rename(req.params.id, req.params.pid, req.body?.name, actorOf(req)); res.json({ ok: true }); }));
  r.delete('/workflows/:id/processes/:pid', perm('workflow:edit'), asyncHandler(async (req, res) => { await new ProcessService(ctxOf(req)).remove(req.params.id, req.params.pid, actorOf(req)); res.status(204).end(); }));

  // --- project engine + assets ---
  r.get('/workflows/:id/engine', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new ProcessService(ctxOf(req)).getEngine(req.params.id))));
  r.get('/workflows/:id/assets', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new AssetsService(ctxOf(req)).list(req.params.id))));
  r.post('/workflows/:id/assets', perm('workflow:edit'), asyncHandler(async (req, res) => res.status(201).json(await new AssetsService(ctxOf(req)).add(req.params.id, req.body?.kind, req.body?.name, actorOf(req)))));

  // --- branches ---
  r.get('/workflows/:id/branches', perm('workflow:view'), asyncHandler(async (req, res) => res.json({ items: await new BranchService(ctxOf(req)).listByWorkflow(req.params.id) })));
  r.post('/workflows/:id/branches', perm('workflow:edit'), asyncHandler(async (req, res) => res.status(201).json(await new BranchService(ctxOf(req)).create(req.params.id, req.body, actorOf(req)))));
  r.get('/branches/:id', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new BranchService(ctxOf(req)).get(req.params.id))));
  r.get('/branches/:id/versions', perm('workflow:view'), asyncHandler(async (req, res) => res.json({ items: await new VersionService(ctxOf(req)).listByBranch(req.params.id) })));
  r.post('/branches/:id/versions', perm('workflow:edit'), asyncHandler(async (req, res) => res.status(201).json(await new VersionService(ctxOf(req)).saveDraft(req.params.id, req.body.engine, actorOf(req), req.body.message))));

  // --- versions ---
  r.get('/versions/:id', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new VersionService(ctxOf(req)).get(req.params.id))));
  r.post('/versions/:id/publish', perm('workflow:edit'), asyncHandler(async (req, res) => res.json(await new VersionService(ctxOf(req)).publish(req.params.id, actorOf(req), req.body?.label))));
  r.post('/versions/:id/validate', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new VersionService(ctxOf(req)).validate(req.params.id))));
  r.get('/versions/:a/diff/:b', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new VersionService(ctxOf(req)).diff(req.params.a, req.params.b))));
  r.post('/versions/:id/deploy', perm('workflow:deploy'), asyncHandler(async (req, res) => res.status(201).json(await new DeploymentService(ctxOf(req)).deploy(req.params.id, req.body, actorOf(req)))));
  r.get('/versions/:id/export', perm('workflow:view'), asyncHandler(async (req, res) => {
    const v = await new VersionService(ctxOf(req)).get(req.params.id);
    res.json(exportKjar(v.engine));
  }));

  // --- deployments ---
  r.get('/workflows/:id/deployments', perm('workflow:view'), asyncHandler(async (req, res) => res.json({ items: await new DeploymentService(ctxOf(req)).listByWorkflow(req.params.id) })));
  r.get('/deployments/:id', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).get(req.params.id))));
  r.post('/deployments/:id/tags', perm('workflow:deploy'), asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).setTags(req.params.id, req.body, actorOf(req)))));
  r.post('/deployments/:id/activate', perm('workflow:deploy'), asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).activate(req.params.id, actorOf(req)))));
  r.post('/deployments/:id/rollback', perm('workflow:deploy'), asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).rollback(req.body.environment, req.body.toDeploymentId, actorOf(req)))));
  r.post('/deployments/:id/undeploy', perm('workflow:deploy'), asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).undeploy(req.params.id, actorOf(req)))));
  r.post('/deployments/:id/archive', perm('workflow:deploy'), asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).archive(req.params.id, actorOf(req)))));
  r.get('/deployments/:id/export', perm('workflow:view'), asyncHandler(async (req, res) => {
    const d = await new DeploymentService(ctxOf(req)).get(req.params.id);
    res.json(exportKjar(d.engine));
  }));
  r.get('/deployments/:id/definitions', perm('workflow:view'), asyncHandler(async (req, res) => {
    const d = await new DeploymentService(ctxOf(req)).get(req.params.id);
    res.json({ items: (d.engine.processes || []).map((p) => ({ id: p.id, name: p.name || p.id, nodes: (p.nodes || []).length, startable: (p.nodes || []).some((n) => n.type === 'start') })) });
  }));

  // --- instances (runtime) ---
  r.post('/instances', perm('workflow:run'), asyncHandler(async (req, res) => res.status(201).json(await new InstanceService(ctxOf(req), emit).start(req.body, actorOf(req)))));
  r.get('/instances', perm('workflow:view'), asyncHandler(async (req, res) => res.json({ items: await new InstanceService(ctxOf(req)).list(req.query as any) })));
  r.get('/instances/:id', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).get(req.params.id))));
  r.get('/instances/:id/history', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).history(req.params.id))));
  r.get('/instances/:id/diagram-state', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).diagramState(req.params.id))));
  r.get('/instances/:id/graph', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).graph(req.params.id))));
  r.get('/instances/:id/related', perm('workflow:view'), asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).related(req.params.id))));
  r.post('/instances/:id/signal', perm('workflow:run'), asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req), emit).signal(req.params.id, req.body?.name, req.body?.payload, actorOf(req)))));
  r.post('/instances/:id/retry', perm('workflow:run'), asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req), emit).retry(req.params.id, req.body?.nodeId, actorOf(req)))));
  r.post('/instances/:id/suspend', perm('workflow:run'), asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).suspend(req.params.id, actorOf(req)))));
  r.post('/instances/:id/resume', perm('workflow:run'), asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).resumeInstance(req.params.id, actorOf(req)))));
  r.post('/instances/:id/abort', perm('workflow:run'), asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).abort(req.params.id, actorOf(req)))));

  // --- tasks (task-level group/assignee/excludedOwners/businessAdmin checks happen inside TaskService
  // itself — see modules/tasks/service.ts — on top of the role-level task:manage gate here) ---
  r.get('/tasks', perm('task:manage'), asyncHandler(async (req, res) => res.json({ items: await new TaskService(ctxOf(req)).list({ ...req.query as any, overdue: req.query.overdue === 'true' }) })));
  r.get('/tasks/:id', perm('task:manage'), asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req)).get(req.params.id))));
  r.post('/tasks/:id/claim', perm('task:manage'), asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req)).claim(req.params.id, actorOf(req)))));
  r.post('/tasks/:id/release', perm('task:manage'), asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req)).release(req.params.id, actorOf(req)))));
  r.post('/tasks/:id/complete', perm('task:manage'), asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req), emit).complete(req.params.id, req.body?.outputs || {}, actorOf(req)))));
  r.post('/tasks/:id/skip', perm('task:manage'), asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req), emit).skip(req.params.id, actorOf(req)))));

  // --- query / task-admin / analytics (jBPM KIE-Server-style; see docs/17) ---
  const q = (req: Request) => new QueryService(ctxOf(req));
  const s = (req: Request) => (req.query.status as string | undefined);
  r.get('/query/process-definitions', perm('query:read'), asyncHandler(async (req, res) => res.json({ items: await q(req).processDefinitions() })));
  r.get('/query/process-definitions/:processId/instances', perm('query:read'), asyncHandler(async (req, res) => res.json({ items: await q(req).processInstances(req.params.processId, s(req)) })));
  r.get('/query/process-definitions/:processId/signals', perm('query:read'), asyncHandler(async (req, res) => res.json(await q(req).processSignals(req.params.processId))));
  r.get('/query/users', perm('query:read'), asyncHandler(async (req, res) => res.json({ items: await q(req).users() })));
  r.get('/query/users/:user/tasks', perm('query:read'), asyncHandler(async (req, res) => res.json({ items: await q(req).tasksForUser(req.params.user, s(req)) })));
  r.get('/query/users/:user/tasks/completed', perm('query:read'), asyncHandler(async (req, res) => res.json({ items: await q(req).tasksCompletedByUser(req.params.user) })));
  r.get('/query/groups/:group/tasks', perm('query:read'), asyncHandler(async (req, res) => res.json({ items: await q(req).tasksForGroup(req.params.group, s(req)) })));
  r.get('/query/instances/:id/tasks', perm('query:read'), asyncHandler(async (req, res) => res.json({ items: await q(req).instanceTasks(req.params.id) })));
  r.get('/query/analytics/tasks', perm('query:read'), asyncHandler(async (req, res) => res.json(await q(req).taskAnalytics())));
  r.get('/query/analytics/processes', perm('query:read'), asyncHandler(async (req, res) => res.json(await q(req).processAnalytics())));
  r.get('/query/analytics/summary', perm('query:read'), asyncHandler(async (req, res) => res.json(await q(req).summary())));
  r.get('/query/jobs', perm('query:read'), asyncHandler(async (req, res) => res.json({ items: await q(req).jobs(s(req)) })));

  // --- IAM: users, groups, roles (admin-only) ---
  const iam = (req: Request) => new IamService(ctxOf(req));
  r.get('/users', perm('admin:iam'), asyncHandler(async (req, res) => res.json({ items: await iam(req).listUsers() })));
  r.post('/users', perm('admin:iam'), asyncHandler(async (req, res) => res.status(201).json(await iam(req).createUser(req.body, actorOf(req)))));
  r.get('/users/:id', perm('admin:iam'), asyncHandler(async (req, res) => res.json(await iam(req).getUser(req.params.id))));
  r.patch('/users/:id', perm('admin:iam'), asyncHandler(async (req, res) => res.json(await iam(req).updateUser(req.params.id, req.body, actorOf(req)))));
  r.post('/users/:id/password', perm('admin:iam'), asyncHandler(async (req, res) => { await iam(req).setPassword(req.params.id, req.body?.password, actorOf(req)); res.status(204).end(); }));
  r.get('/groups', perm('admin:iam'), asyncHandler(async (req, res) => res.json({ items: await iam(req).listGroups() })));
  r.post('/groups', perm('admin:iam'), asyncHandler(async (req, res) => res.status(201).json(await iam(req).createGroup(req.body, actorOf(req)))));
  r.delete('/groups/:id', perm('admin:iam'), asyncHandler(async (req, res) => { await iam(req).deleteGroup(req.params.id, actorOf(req)); res.status(204).end(); }));
  r.get('/roles', perm('admin:iam'), asyncHandler(async (req, res) => res.json({ items: await iam(req).listRoles() })));
  r.post('/roles', perm('admin:iam'), asyncHandler(async (req, res) => res.status(201).json(await iam(req).createRole(req.body, actorOf(req)))));
  r.patch('/roles/:id', perm('admin:iam'), asyncHandler(async (req, res) => res.json(await iam(req).updateRole(req.params.id, req.body?.permissions || [], actorOf(req)))));
  r.delete('/roles/:id', perm('admin:iam'), asyncHandler(async (req, res) => { await iam(req).deleteRole(req.params.id, actorOf(req)); res.status(204).end(); }));

  return r;
}
