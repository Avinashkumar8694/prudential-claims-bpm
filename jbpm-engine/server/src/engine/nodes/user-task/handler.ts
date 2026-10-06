// User task — creates a Task work item and waits until it is completed (which resumes the token).
import type { NodeHandler } from '../types.ts';
import { Collections, type Task } from '../../../domain.ts';
import { computeDue } from '../../duration.ts';

function mapTaskInputs(n: any, vars: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [tv, spec] of Object.entries(n.inputs || {})) out[tv] = typeof spec === 'string' && spec.startsWith('$') ? vars[spec.slice(1)] : spec;
  return out;
}

function resolveRef(spec: unknown, vars: Record<string, unknown>): string | undefined {
  if (typeof spec !== 'string' || !spec) return undefined;
  const v = spec.startsWith('$') ? vars[spec.slice(1)] : spec;
  return v == null ? undefined : String(v);
}

export const handler: NodeHandler = (c) => {
  const n = c.node as any;
  const now = c.app.clock();
  const group = resolveRef(n.group, c.inst.variables);
  const assigneeRaw = resolveRef(n.assignee, c.inst.variables);
  const businessAdmin = resolveRef(n.businessAdmin, c.inst.variables);
  const excludedOwners = Array.isArray(n.excludedOwners)
    ? n.excludedOwners.map((o: unknown) => resolveRef(o, c.inst.variables)).filter((o: string | undefined): o is string => !!o)
    : undefined;
  // A task with exactly ONE potential owner (a single actorId, no group at all) auto-reserves
  // straight to that person — no explicit claim step. Any group present, or more than one named
  // actor (a comma-separated list), means MULTIPLE potential owners, so it stays Ready ('created')
  // until someone actually claims it; the named actors then live in `candidates` (checked by
  // TaskService.assertOwnable, unioned with `group` membership) until one of them does.
  const assigneeList = assigneeRaw ? assigneeRaw.split(',').map((a) => a.trim()).filter(Boolean) : [];
  const singleAssignee = assigneeList.length === 1 ? assigneeList[0] : undefined;
  const autoReserve = !!singleAssignee && !group;
  const candidates = !autoReserve && assigneeList.length ? assigneeList : undefined;
  const task: Task = {
    id: c.app.newId(), tenantId: c.app.tenantId, instanceId: c.inst.id,
    tokenId: c.inst.tokens.find((t) => t.nodeId === n.id)!.id, nodeId: n.id,
    name: n.name || n.form || 'Task', formName: n.form, description: n.description, group,
    ...(autoReserve ? { assignee: singleAssignee } : {}),
    ...(candidates ? { candidates } : {}),
    businessAdmin, excludedOwners, priority: n.priority,
    status: autoReserve ? 'reserved' : 'created', inputs: mapTaskInputs(n, c.inst.variables), createdAt: now,
    ...(n.dueDate ? { dueAt: computeDue(n.dueDate, now) } : {}),
  };
  c.app.store.repo<Task>(Collections.tasks).put(task);
  c.emit({ kind: 'task.created', instanceId: c.inst.id, taskId: task.id });
  return { wait: { kind: 'task', ref: task.id } };
};
