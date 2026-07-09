// Intermediate catch — waits for a timer/message/signal/conditional event. Timers persist a TimerJob.
import type { NodeHandler } from '../types.ts';
import { computeDue } from '../../duration.ts';

export const handler: NodeHandler = (c) => {
  const ev = c.node.event || {};
  if (ev.timer) return { wait: { kind: 'timer', ref: c.node.id, dueAt: computeDue(ev.timer, c.app.clock()) } };
  if (ev.message) return { wait: { kind: 'message', ref: ev.message } };
  if (ev.signal) return { wait: { kind: 'signal', ref: ev.signal } };
  return { wait: { kind: 'condition', ref: c.node.id } };
};
