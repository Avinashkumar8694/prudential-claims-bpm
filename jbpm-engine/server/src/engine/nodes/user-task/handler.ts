// User task — creates a Task work item and waits until it is completed (which resumes the token).
import type { NodeHandler } from '../types.ts';
import { Collections, type Task } from '../../../domain.ts';
import { computeDue } from '../../duration.ts';

export const handler: NodeHandler = (c) => {
  const n = c.node;
  const now = c.app.clock();
  const task: Task = {
    id: c.app.newId(), tenantId: c.app.tenantId, instanceId: c.inst.id,
    tokenId: c.inst.tokens.find((t) => t.nodeId === n.id)!.id, nodeId: n.id,
    name: n.name || n.form || 'Task', formName: n.form, group: n.group || n.assignee,
    businessAdmin: n.businessAdmin, excludedOwners: n.excludedOwners, priority: n.priority,
    status: 'created', inputs: {}, createdAt: now,
    ...(n.dueDate ? { dueAt: computeDue(n.dueDate, now) } : {}),
  };
  c.app.store.repo<Task>(Collections.tasks).put(task);
  c.emit({ kind: 'task.created', instanceId: c.inst.id, taskId: task.id });
  return { wait: { kind: 'task', ref: task.id } };
};
