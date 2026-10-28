// Intermediate catch — waits for a timer/message/signal/conditional event. Timers persist a TimerJob.
import type { NodeHandler } from '../types.ts';
import { computeDue } from '../../duration.ts';

export const handler: NodeHandler = (c) => {
  const ev = c.node.event || {};
  if (ev.timer) return { wait: { kind: 'timer', ref: c.node.id, dueAt: computeDue(ev.timer, c.app.clock()) } };
  if (ev.message) return { wait: { kind: 'message', ref: ev.message } };
  // Escalation has no dedicated WaitSpec kind (same reasoning as boundary/handler.ts's
  // messageBoundaryHosts and throw/handler.ts's own broadcast(name) on the sending side) — bucketed
  // into 'signal' so it resolves through the exact same broadcast-matching path a plain signal does.
  // This branch was missing entirely: an escalation catch fell through to the generic 'condition'
  // wait below, which nothing ever resolves via broadcast — the catch would wait forever.
  if (ev.signal || ev.escalation) return { wait: { kind: 'signal', ref: ev.signal || ev.escalation } };
  return { wait: { kind: 'condition', ref: c.node.id } };
};
