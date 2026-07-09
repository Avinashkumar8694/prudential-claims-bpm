// All REST routes (see docs/05-api-spec.md). One assembled router to keep the wiring in one place.
// A per-request AppContext + actor are attached by contextMiddleware (see app.ts).
import { Router } from 'express';
import type { Request } from 'express';
import { asyncHandler } from '../infra/errors.js';
import type { AppContext } from '../context.js';
import { WorkflowService } from '../modules/workflows/service.js';
import { BranchService } from '../modules/branches/service.js';
import { VersionService } from '../modules/versions/service.js';
import { DeploymentService } from '../modules/deployments/service.js';
import { InstanceService } from '../modules/instances/service.js';
import { TaskService } from '../modules/tasks/service.js';
import { NODE_REGISTRY, CATEGORIES } from '../modules/catalog/registry.js';
import { fromEngineProject } from '../sdk/index.js';
import { hub } from '../infra/ws-hub.js';

const ctxOf = (req: Request): AppContext => (req as any).ctx;
const actorOf = (req: Request): string => (req as any).actor;
const emit = hub.engineEmit;

export function buildRoutes(): Router {
  const r = Router();

  // --- catalog (palette / property schemas) ---
  r.get('/catalog/nodes', (_req, res) => res.json({ categories: CATEGORIES, nodes: NODE_REGISTRY }));

  // --- workflows ---
  r.get('/workflows', asyncHandler(async (req, res) => res.json({ items: await new WorkflowService(ctxOf(req)).list() })));
  r.post('/workflows', asyncHandler(async (req, res) => res.status(201).json(await new WorkflowService(ctxOf(req)).create(req.body, actorOf(req)))));
  r.get('/workflows/:id', asyncHandler(async (req, res) => res.json(await new WorkflowService(ctxOf(req)).get(req.params.id))));
  r.patch('/workflows/:id', asyncHandler(async (req, res) => res.json(await new WorkflowService(ctxOf(req)).update(req.params.id, req.body, actorOf(req)))));
  r.delete('/workflows/:id', asyncHandler(async (req, res) => { await new WorkflowService(ctxOf(req)).archive(req.params.id, actorOf(req)); res.status(204).end(); }));
  r.put('/workflows/:id/permissions', asyncHandler(async (req, res) => res.json(await new WorkflowService(ctxOf(req)).setPermissions(req.params.id, req.body, actorOf(req)))));
  r.put('/workflows/:id/variables', asyncHandler(async (req, res) => res.json(await new WorkflowService(ctxOf(req)).setVariables(req.params.id, req.body, actorOf(req)))));

  // --- branches ---
  r.get('/workflows/:id/branches', asyncHandler(async (req, res) => res.json({ items: await new BranchService(ctxOf(req)).listByWorkflow(req.params.id) })));
  r.post('/workflows/:id/branches', asyncHandler(async (req, res) => res.status(201).json(await new BranchService(ctxOf(req)).create(req.params.id, req.body, actorOf(req)))));
  r.get('/branches/:id', asyncHandler(async (req, res) => res.json(await new BranchService(ctxOf(req)).get(req.params.id))));
  r.get('/branches/:id/versions', asyncHandler(async (req, res) => res.json({ items: await new VersionService(ctxOf(req)).listByBranch(req.params.id) })));
  r.post('/branches/:id/versions', asyncHandler(async (req, res) => res.status(201).json(await new VersionService(ctxOf(req)).saveDraft(req.params.id, req.body.engine, actorOf(req), req.body.message))));

  // --- versions ---
  r.get('/versions/:id', asyncHandler(async (req, res) => res.json(await new VersionService(ctxOf(req)).get(req.params.id))));
  r.post('/versions/:id/publish', asyncHandler(async (req, res) => res.json(await new VersionService(ctxOf(req)).publish(req.params.id, actorOf(req), req.body?.label))));
  r.post('/versions/:id/validate', asyncHandler(async (req, res) => res.json(await new VersionService(ctxOf(req)).validate(req.params.id))));
  r.get('/versions/:a/diff/:b', asyncHandler(async (req, res) => res.json(await new VersionService(ctxOf(req)).diff(req.params.a, req.params.b))));
  r.post('/versions/:id/deploy', asyncHandler(async (req, res) => res.status(201).json(await new DeploymentService(ctxOf(req)).deploy(req.params.id, req.body, actorOf(req)))));
  r.get('/versions/:id/export', asyncHandler(async (req, res) => {
    const v = await new VersionService(ctxOf(req)).get(req.params.id);
    res.json(fromEngineProject(v.engine).descriptor);
  }));

  // --- deployments ---
  r.get('/workflows/:id/deployments', asyncHandler(async (req, res) => res.json({ items: await new DeploymentService(ctxOf(req)).listByWorkflow(req.params.id) })));
  r.get('/deployments/:id', asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).get(req.params.id))));
  r.post('/deployments/:id/tags', asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).setTags(req.params.id, req.body, actorOf(req)))));
  r.post('/deployments/:id/activate', asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).activate(req.params.id, actorOf(req)))));
  r.post('/deployments/:id/rollback', asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).rollback(req.body.environment, req.body.toDeploymentId, actorOf(req)))));
  r.post('/deployments/:id/undeploy', asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).undeploy(req.params.id, actorOf(req)))));
  r.post('/deployments/:id/archive', asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).archive(req.params.id, actorOf(req)))));
  r.get('/deployments/:id/export', asyncHandler(async (req, res) => {
    const d = await new DeploymentService(ctxOf(req)).get(req.params.id);
    res.json(fromEngineProject(d.engine).descriptor);
  }));

  // --- instances (runtime) ---
  r.post('/instances', asyncHandler(async (req, res) => res.status(201).json(await new InstanceService(ctxOf(req), emit).start(req.body, actorOf(req)))));
  r.get('/instances', asyncHandler(async (req, res) => res.json({ items: await new InstanceService(ctxOf(req)).list(req.query as any) })));
  r.get('/instances/:id', asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).get(req.params.id))));
  r.get('/instances/:id/history', asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).history(req.params.id))));
  r.get('/instances/:id/diagram-state', asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).diagramState(req.params.id))));
  r.post('/instances/:id/abort', asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).abort(req.params.id, actorOf(req)))));

  // --- tasks ---
  r.get('/tasks', asyncHandler(async (req, res) => res.json({ items: await new TaskService(ctxOf(req)).list(req.query as any) })));
  r.get('/tasks/:id', asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req)).get(req.params.id))));
  r.post('/tasks/:id/claim', asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req)).claim(req.params.id, actorOf(req)))));
  r.post('/tasks/:id/release', asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req)).release(req.params.id, actorOf(req)))));
  r.post('/tasks/:id/complete', asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req), emit).complete(req.params.id, req.body?.outputs || {}, actorOf(req)))));

  return r;
}
