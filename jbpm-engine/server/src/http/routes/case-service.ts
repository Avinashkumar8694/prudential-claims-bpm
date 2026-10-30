// Case Service REST APIs — Consolidated Claim Case Architecture
// Implements the specification from docs/case_service_schema.md
import { Router } from 'express';
import type { Request } from 'express';
import { asyncHandler, notFound, validation } from '../../infra/errors.ts';
import { ctxOf, actorOf } from '../route-context.ts';
import { requirePermission } from '../auth-middleware.ts';
import { resolveWorkflowServiceStore } from '../../workflow-service/store/index.ts';
import type { WorkflowInstance } from '../../workflow-service/domain.ts';

const perm = requirePermission;
const wfStore = (req: Request) => resolveWorkflowServiceStore(ctxOf(req).store);

function toCaseObject(w: WorkflowInstance): Record<string, unknown> {
  const d = (w.data || {}) as Record<string, any>;
  return {
    ...d,
    caseId: w.id,
    policyNumber: d.policyNumber || '',
    claimType: d.claimType || 'DEATH',
    dateOfDeath: d.dateOfDeath ?? null,
    causeOfDeath: d.causeOfDeath ?? null,
    placeOfDeath: d.placeOfDeath ?? null,
    caseStatus: w.status,
    examinerResolution: d.examinerResolution ?? null,
    examinerComment: d.examinerComment ?? null,
    interestMethodConfirmed: Boolean(d.interestMethodConfirmed),
    totalPayoutAmount: Number(d.totalPayoutAmount) || 0,
    jbpmProcessInstanceId: w.piid || d.jbpmProcessInstanceId || null,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    claimant: d.claimant || null,
    policyDetails: d.policyDetails || [],
    beneficiaries: d.beneficiaries || [],
    taxWithholdings: d.taxWithholdings || [],
    documents: d.documents || [],
    flags: d.flags || { caseLevel: [], policyLevel: [], beneficiaryLevel: [] },
  };
}

export function buildCaseServiceRoutes(): Router {
  const r = Router();

  // POST /caseservice/case — Create a new consolidated claim case
  r.post('/caseservice/case', perm('workflowInstance:manage'), asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const actor = actorOf(req);
    const body = req.body || {};
    const store = wfStore(req);
    const now = ctx.clock();
    const id = ctx.newId();
    const status = body.caseStatus || 'DRAFT';

    const row: WorkflowInstance = {
      id,
      tenantId: ctx.tenantId,
      workflowDefinitionId: body.workflowDefinitionId || 'claim-case-definition',
      workflowName: body.workflowName || 'claim-case',
      deploymentId: body.deploymentId || 'default-deployment',
      data: body,
      status,
      piid: body.jbpmProcessInstanceId ? String(body.jbpmProcessInstanceId) : null,
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
    };

    await store.instances().put(row);
    await store.audits().put({
      id: ctx.newId(),
      tenantId: ctx.tenantId,
      workflowInstanceId: id,
      actor,
      kind: 'case.created',
      data: { policyNumber: body.policyNumber, claimType: body.claimType },
      at: now,
    });

    res.status(201).json({
      caseId: id,
      policyNumber: body.policyNumber,
      claimType: body.claimType || 'DEATH',
      caseStatus: status,
      createdAt: now,
      updatedAt: now,
    });
  }));

  // GET /caseservice/case/:caseId — Retrieve complete consolidated claim case object
  r.get('/caseservice/case/:caseId', perm('workflowInstance:manage'), asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const store = wfStore(req);
    const w = await store.instances().get(req.params.caseId);
    if (!w || w.tenantId !== ctx.tenantId) throw notFound('Case Object');
    res.json(toCaseObject(w));
  }));

  // PUT /caseservice/case/:caseId — Partial update (patching) or replacement of case attributes
  r.put('/caseservice/case/:caseId', perm('workflowInstance:manage'), asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const actor = actorOf(req);
    const store = wfStore(req);
    const w = await store.instances().get(req.params.caseId);
    if (!w || w.tenantId !== ctx.tenantId) throw notFound('Case Object');

    const body = req.body || {};
    const nextStatus = body.caseStatus || w.status;
    const nextData = { ...(w.data || {}), ...body };
    const now = ctx.clock();

    const next: WorkflowInstance = {
      ...w,
      status: nextStatus,
      data: nextData,
      piid: body.jbpmProcessInstanceId ? String(body.jbpmProcessInstanceId) : w.piid,
      updatedAt: now,
      updatedBy: actor,
    };

    await store.instances().put(next);
    await store.audits().put({
      id: ctx.newId(),
      tenantId: ctx.tenantId,
      workflowInstanceId: w.id,
      actor,
      kind: 'case.updated',
      data: { status: nextStatus, updatedFields: Object.keys(body) },
      at: now,
    });

    res.json({
      caseId: w.id,
      caseStatus: nextStatus,
      updatedAt: now,
    });
  }));

  // DELETE /caseservice/case/:caseId — Archive or soft-delete the claim case
  r.delete('/caseservice/case/:caseId', perm('workflowInstance:manage'), asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const actor = actorOf(req);
    const store = wfStore(req);
    const w = await store.instances().get(req.params.caseId);
    if (!w || w.tenantId !== ctx.tenantId) throw notFound('Case Object');

    const now = ctx.clock();
    const nextData = { ...(w.data || {}), caseStatus: 'TERMINATED' };
    const next: WorkflowInstance = {
      ...w,
      status: 'TERMINATED',
      data: nextData,
      updatedAt: now,
      updatedBy: actor,
    };
    await store.instances().put(next);
    await store.audits().put({
      id: ctx.newId(),
      tenantId: ctx.tenantId,
      workflowInstanceId: w.id,
      actor,
      kind: 'case.deleted',
      data: { previousStatus: w.status },
      at: now,
    });

    res.status(204).end();
  }));

  // GET /caseservice/list — List claim cases filtered by caseStatus, claimType, policyNumber
  r.get('/caseservice/list', perm('workflowInstance:manage'), asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const store = wfStore(req);
    const statusFilter = req.query.caseStatus as string | undefined;
    const typeFilter = req.query.claimType as string | undefined;
    const policyFilter = req.query.policyNumber as string | undefined;

    const all = await store.instances().query((w) => {
      if (w.tenantId !== ctx.tenantId) return false;
      const d = (w.data || {}) as Record<string, any>;
      if (statusFilter && w.status !== statusFilter) return false;
      if (typeFilter && (d.claimType || 'DEATH') !== typeFilter) return false;
      if (policyFilter && d.policyNumber !== policyFilter) return false;
      return true;
    });

    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(all.map(toCaseObject));
  }));

  return r;
}
