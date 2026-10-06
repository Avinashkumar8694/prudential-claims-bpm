// Intermediate catch — waits for a timer/message/signal/conditional event. Timers persist a TimerJob.
import type { NodeHandler } from '../types.ts';
import { computeDue } from '../../duration.ts';

export const handler: NodeHandler = (c) => {
  const ev = (c.node as any).event || {};
  if (ev.timer) return { wait: { kind: 'timer', ref: c.node.id, dueAt: computeDue(ev.timer, c.app.clock()) } };
  if (ev.message) return { wait: { kind: 'message', ref: ev.message } };
  if (ev.signal) return { wait: { kind: 'signal', ref: ev.signal } };
  // Escalation is deliberately NOT catchable here: the escalation event definition is only valid on
  // End Events, Boundary Events, and (event sub-process) Start Events per spec — there's no standard
  // "Escalation Intermediate Catch Event" construct.
  return { wait: { kind: 'condition', ref: c.node.id } };
};
