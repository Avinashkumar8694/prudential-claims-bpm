// Builds the small "meta-locals" surface every script/condition/onEntry/onExit sees alongside its
// declared process variables: `instance` (this instance's own id/status), `node` (the current node's
// id/name) — engine-only additive sugar, not read/written back, just informational context.
import type { HandlerCtx } from './types.ts';

export interface KcontextInfo {
  instanceId: string;
  instanceInfo: { id: string; state: string };
  nodeInfo: { nodeId: string; nodeName?: string };
  nodeId: string;
  nodeName?: string;
}

export function kcontextInfoOf(c: HandlerCtx): KcontextInfo {
  return {
    instanceId: c.inst.id,
    instanceInfo: { id: c.inst.id, state: c.inst.status },
    nodeInfo: { nodeId: c.node.id!, nodeName: c.node.name },
    nodeId: c.node.id!,
    nodeName: c.node.name,
  };
}

/** Declared process-variable types (name -> structureRef), used to seed a bare-identifier binding —
 *  every node folder that runs a script/condition passes this the same way. */
export function varTypesOf(c: HandlerCtx): Record<string, string> {
  const types: Record<string, string> = {};
  for (const v of c.proc.vars || []) if (v.name) types[v.name] = v.type;
  return types;
}

/** Placeholder for a future "call an engine capability from inside a script" hook (e.g. a jBPM-style
 *  `kcontext.getKieRuntime().signalEvent(...)` called from JS) — deliberately unwired for now; every
 *  handler still gets its OWN direct capabilities (c.broadcast/c.signal/c.escalate/...) which cover
 *  every node type's real behavior without a script needing to reach into the runtime itself. */
export function onActionOf(_c: HandlerCtx): undefined { return undefined; }
