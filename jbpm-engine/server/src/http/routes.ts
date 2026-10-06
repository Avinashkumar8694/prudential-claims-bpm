import { Router, type Request, type Response, type NextFunction } from 'express';
import type { AppContext } from '../context.ts';
import { requireAuth, requirePermission } from './auth-middleware.ts';
import { IamService } from '../modules/iam/service.ts';
import { FoldersService } from '../modules/folders/service.ts';
import { WorkflowsService } from '../modules/workflows/service.ts';
import { BranchesService } from '../modules/branches/service.ts';
import { VersionsService } from '../modules/versions/service.ts';
import { DeploymentsService } from '../modules/deployments/service.ts';
import { InstancesService } from '../modules/instances/service.ts';
import { TasksService } from '../modules/tasks/service.ts';
import { SettingsService } from '../modules/settings/service.ts';
import { NODE_DEFS, CATEGORIES } from '../engine/nodes/index.ts';

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };
const ctxOf = (req: Request): AppContext => req.ctx!;
const actorOf = (req: Request): string => req.user!.username;

export function createRouter(makeCtx: (tenantId: string) => AppContext): Router {
  const router = Router();

  // ---- auth (no auth required to log in) ----
  router.post('/auth/login', h(async (req, res) => {
    const { username, password, tenantId } = req.body || {};
    if (!username || !password) { res.status(400).json({ error: 'username and password are required' }); return; }
    const iam = new IamService(makeCtx(tenantId || 'default'));
    res.json(await iam.login(username, password));
  }));

  router.use(requireAuth(makeCtx));

  router.get('/auth/me', h(async (req, res) => { res.json(req.user); }));
  router.get('/auth/permissions', h(async (req, res) => {
    const granted = await new IamService(ctxOf(req)).resolvePermissions(req.user!);
    res.json({ permissions: [...granted] });
  }));

  // ---- node catalog (drives the builder palette + properties panel; same defs the engine's own
  // factory registry validated at boot, never a hand-duplicated frontend copy) ----
  router.get('/node-defs', h(async (_req, res) => { res.json({ categories: CATEGORIES, defs: NODE_DEFS }); }));

  // ---- folders ----
  router.get('/folders', h(async (req, res) => { res.json(await new FoldersService(ctxOf(req)).list()); }));
  router.get('/folders/:id', h(async (req, res) => { res.json(await new FoldersService(ctxOf(req)).get(req.params.id)); }));
  router.post('/folders', requirePermission('workflow:edit'), h(async (req, res) => {
    res.status(201).json(await new FoldersService(ctxOf(req)).create(req.body?.name, req.body?.parentId ?? null, actorOf(req)));
  }));
  router.put('/folders/:id', requirePermission('workflow:edit'), h(async (req, res) => {
    const svc = new FoldersService(ctxOf(req));
    let folder = await svc.get(req.params.id);
    if (req.body?.name !== undefined) folder = await svc.rename(req.params.id, req.body.name, actorOf(req));
    if (req.body?.parentId !== undefined) folder = await svc.move(req.params.id, req.body.parentId, actorOf(req));
    res.json(folder);
  }));
  router.delete('/folders/:id', requirePermission('workflow:edit'), h(async (req, res) => {
    await new FoldersService(ctxOf(req)).delete(req.params.id); res.status(204).end();
  }));

  // ---- workflows ----
  router.get('/workflows', h(async (req, res) => {
    const { folderId, includeArchived, search } = req.query;
    res.json(await new WorkflowsService(ctxOf(req)).list({
      folderId: folderId === undefined ? undefined : (folderId === 'null' ? null : String(folderId)),
      includeArchived: includeArchived === 'true', search: search ? String(search) : undefined,
    }));
  }));
  router.get('/workflows/:id', h(async (req, res) => { res.json(await new WorkflowsService(ctxOf(req)).get(req.params.id)); }));
  router.post('/workflows', requirePermission('workflow:edit'), h(async (req, res) => {
    res.status(201).json(await new WorkflowsService(ctxOf(req)).create(req.body?.name, req.body?.folderId, actorOf(req)));
  }));
  router.put('/workflows/:id', requirePermission('workflow:edit'), h(async (req, res) => {
    const svc = new WorkflowsService(ctxOf(req));
    let wf = await svc.get(req.params.id);
    if (req.body?.name !== undefined) wf = await svc.rename(req.params.id, req.body.name, actorOf(req));
    if (req.body?.folderId !== undefined) wf = await svc.move(req.params.id, req.body.folderId, actorOf(req));
    if (req.body?.archived !== undefined) wf = await svc.setArchived(req.params.id, req.body.archived, actorOf(req));
    res.json(wf);
  }));
  router.delete('/workflows/:id', requirePermission('workflow:edit'), h(async (req, res) => {
    await new WorkflowsService(ctxOf(req)).delete(req.params.id); res.status(204).end();
  }));

  // ---- branches ----
  router.get('/workflows/:workflowId/branches', h(async (req, res) => { res.json(await new BranchesService(ctxOf(req)).list(req.params.workflowId)); }));
  router.get('/branches/:id', h(async (req, res) => { res.json(await new BranchesService(ctxOf(req)).get(req.params.id)); }));
  router.post('/workflows/:workflowId/branches', requirePermission('workflow:edit'), h(async (req, res) => {
    res.status(201).json(await new BranchesService(ctxOf(req)).create(req.params.workflowId, req.body?.name, req.body?.fromBranchId, actorOf(req)));
  }));
  router.put('/branches/:id', requirePermission('workflow:edit'), h(async (req, res) => {
    const svc = new BranchesService(ctxOf(req));
    let branch = await svc.get(req.params.id);
    if (req.body?.name !== undefined) branch = await svc.rename(req.params.id, req.body.name, actorOf(req));
    if (req.body?.protected !== undefined) branch = await svc.setProtected(req.params.id, req.body.protected, actorOf(req));
    res.json(branch);
  }));
  router.delete('/branches/:id', requirePermission('workflow:edit'), h(async (req, res) => {
    const svc = new BranchesService(ctxOf(req));
    const branch = await svc.get(req.params.id);
    const wf = await new WorkflowsService(ctxOf(req)).get(branch.workflowId);
    await svc.delete(req.params.id, wf.defaultBranchId);
    res.status(204).end();
  }));

  // ---- versions ----
  router.get('/branches/:branchId/versions', h(async (req, res) => { res.json(await new VersionsService(ctxOf(req)).list(req.params.branchId)); }));
  router.get('/versions/:id', h(async (req, res) => { res.json(await new VersionsService(ctxOf(req)).get(req.params.id)); }));
  router.put('/versions/:id', requirePermission('workflow:edit'), h(async (req, res) => {
    res.json(await new VersionsService(ctxOf(req)).saveDraft(req.params.id, req.body?.engine, actorOf(req)));
  }));
  router.post('/versions/:id/publish', requirePermission('workflow:edit'), h(async (req, res) => {
    res.json(await new VersionsService(ctxOf(req)).publish(req.params.id, actorOf(req)));
  }));
  router.post('/versions/:id/validate', h(async (req, res) => {
    res.json({ issues: await new VersionsService(ctxOf(req)).validateOnly(req.params.id) });
  }));

  // ---- deployments ----
  router.get('/deployments', h(async (req, res) => {
    const { workflowId, environment, status } = req.query;
    res.json(await new DeploymentsService(ctxOf(req)).list({
      workflowId: workflowId ? String(workflowId) : undefined,
      environment: environment ? String(environment) : undefined,
      status: status ? (String(status) as 'active' | 'inactive' | 'archived') : undefined,
    }));
  }));
  router.get('/deployments/:id', h(async (req, res) => { res.json(await new DeploymentsService(ctxOf(req)).get(req.params.id)); }));
  router.post('/deployments', requirePermission('workflow:deploy'), h(async (req, res) => {
    res.status(201).json(await new DeploymentsService(ctxOf(req)).deploy(req.body?.versionId, req.body?.environment, actorOf(req), req.body?.env, req.body?.tags));
  }));
  router.post('/deployments/:id/undeploy', requirePermission('workflow:deploy'), h(async (req, res) => {
    res.json(await new DeploymentsService(ctxOf(req)).undeploy(req.params.id, actorOf(req)));
  }));
  router.post('/deployments/:id/archive', requirePermission('workflow:deploy'), h(async (req, res) => {
    res.json(await new DeploymentsService(ctxOf(req)).archive(req.params.id, actorOf(req)));
  }));

  // ---- instances ----
  router.get('/instances', h(async (req, res) => {
    const { workflowId, deploymentId, status, parentInstanceId } = req.query;
    res.json(await new InstancesService(ctxOf(req)).list({
      workflowId: workflowId ? String(workflowId) : undefined,
      deploymentId: deploymentId ? String(deploymentId) : undefined,
      status: status ? (String(status) as any) : undefined,
      parentInstanceId: parentInstanceId ? String(parentInstanceId) : undefined,
    }));
  }));
  router.get('/instances/:id', h(async (req, res) => { res.json(await new InstancesService(ctxOf(req)).get(req.params.id)); }));
  router.get('/instances/:id/diagram', h(async (req, res) => { res.json(await new InstancesService(ctxOf(req)).diagram(req.params.id)); }));
  router.post('/instances', requirePermission('workflow:run'), h(async (req, res) => {
    res.status(201).json(await new InstancesService(ctxOf(req)).start(req.body || {}, actorOf(req)));
  }));
  router.post('/instances/:id/abort', requirePermission('workflow:run'), h(async (req, res) => {
    res.json(await new InstancesService(ctxOf(req)).abort(req.params.id, actorOf(req)));
  }));
  router.post('/instances/:id/retry', requirePermission('workflow:run'), h(async (req, res) => {
    res.json(await new InstancesService(ctxOf(req)).retryNode(req.params.id, req.body?.nodeId, actorOf(req)));
  }));
  router.put('/instances/:id/variables', requirePermission('workflow:run'), h(async (req, res) => {
    res.json(await new InstancesService(ctxOf(req)).editVariables(req.params.id, req.body || {}, actorOf(req)));
  }));
  router.post('/instances/:id/signal', requirePermission('workflow:run'), h(async (req, res) => {
    res.json(await new InstancesService(ctxOf(req)).signal(req.params.id, req.body?.name, req.body?.payload, actorOf(req)));
  }));

  // ---- tasks ----
  router.get('/tasks', h(async (req, res) => {
    const { instanceId, status, mine } = req.query;
    res.json(await new TasksService(ctxOf(req)).list({
      instanceId: instanceId ? String(instanceId) : undefined,
      status: status ? (String(status) as any) : undefined,
      forUser: mine === 'true' ? { username: req.user!.username, groups: req.user!.groups } : undefined,
    }));
  }));
  router.get('/tasks/:id', h(async (req, res) => { res.json(await new TasksService(ctxOf(req)).get(req.params.id)); }));
  router.post('/tasks/:id/claim', requirePermission('task:manage'), h(async (req, res) => {
    res.json(await new TasksService(ctxOf(req)).claim(req.params.id, { username: req.user!.username, groups: req.user!.groups }));
  }));
  router.post('/tasks/:id/release', requirePermission('task:manage'), h(async (req, res) => {
    res.json(await new TasksService(ctxOf(req)).release(req.params.id, actorOf(req)));
  }));
  router.post('/tasks/:id/start', requirePermission('task:manage'), h(async (req, res) => {
    res.json(await new TasksService(ctxOf(req)).start(req.params.id, { username: req.user!.username, groups: req.user!.groups }));
  }));
  router.post('/tasks/:id/complete', requirePermission('task:manage'), h(async (req, res) => {
    res.json(await new TasksService(ctxOf(req)).complete(req.params.id, req.body || {}, { username: req.user!.username, groups: req.user!.groups }));
  }));
  router.post('/tasks/:id/skip', requirePermission('task:manage'), h(async (req, res) => {
    res.json(await new TasksService(ctxOf(req)).skip(req.params.id, actorOf(req)));
  }));

  // ---- settings ----
  router.get('/settings', h(async (req, res) => { res.json(await new SettingsService(ctxOf(req)).get()); }));
  router.put('/settings', requirePermission('settings:manage'), h(async (req, res) => {
    res.json(await new SettingsService(ctxOf(req)).update(req.body || {}, actorOf(req)));
  }));

  // ---- iam ----
  router.get('/iam/users', requirePermission('iam:manage'), h(async (req, res) => { res.json(await new IamService(ctxOf(req)).listUsers()); }));
  router.post('/iam/users', requirePermission('iam:manage'), h(async (req, res) => {
    const { username, password, roles, groups } = req.body || {};
    res.status(201).json(await new IamService(ctxOf(req)).createUser(username, password, roles || [], groups || [], actorOf(req)));
  }));
  router.put('/iam/users/:id/active', requirePermission('iam:manage'), h(async (req, res) => {
    res.json(await new IamService(ctxOf(req)).setActive(req.params.id, !!req.body?.active, actorOf(req)));
  }));
  router.get('/iam/groups', h(async (req, res) => { res.json(await new IamService(ctxOf(req)).listGroups()); }));
  router.get('/iam/roles', h(async (req, res) => { res.json(await new IamService(ctxOf(req)).listRoles()); }));

  return router;
}
