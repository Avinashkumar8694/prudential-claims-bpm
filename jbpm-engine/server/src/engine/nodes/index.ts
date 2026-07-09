// Node handler registry — maps an engine node type to its backend handler. Each node lives in its own
// folder (nodes/<type>/handler.ts) with all of its run-time logic. Add a node = add a folder + entry.
import type { NodeHandler } from './types.ts';
import { handler as start } from './start/handler.ts';
import { handler as end } from './end/handler.ts';
import { handler as manual } from './manual/handler.ts';
import { handler as script } from './script/handler.ts';
import { handler as http } from './http/handler.ts';
import { handler as rule } from './rule/handler.ts';
import { handler as gateway } from './gateway/handler.ts';
import { handler as userTask } from './user-task/handler.ts';
import { handler as receive } from './receive/handler.ts';
import { handler as catchEvent } from './catch/handler.ts';
import { handler as throwEvent } from './throw/handler.ts';
import { handler as send } from './send/handler.ts';
import { handler as call } from './call/handler.ts';
import { handler as forEach } from './for-each/handler.ts';
import { handler as subprocess } from './subprocess/handler.ts';

export const NODE_HANDLERS: Record<string, NodeHandler> = {
  start, end, manual, script, http, rule, gateway, userTask, receive,
  catch: catchEvent, throw: throwEvent, send, call, forEach, subprocess,
  // 'boundary' has no active handler — it is spawned by the error router and follows its outgoing flow.
};

// per-node UI config (palette + ports + property schema), co-located with each handler
import { def as startDef } from './start/def.ts';
import { def as endDef } from './end/def.ts';
import { def as manualDef } from './manual/def.ts';
import { def as scriptDef } from './script/def.ts';
import { def as httpDef } from './http/def.ts';
import { def as ruleDef } from './rule/def.ts';
import { def as gatewayDef } from './gateway/def.ts';
import { def as userTaskDef } from './user-task/def.ts';
import { def as receiveDef } from './receive/def.ts';
import { def as catchDef } from './catch/def.ts';
import { def as throwDef } from './throw/def.ts';
import { def as sendDef } from './send/def.ts';
import { def as callDef } from './call/def.ts';
import { def as forEachDef } from './for-each/def.ts';
import { def as subprocessDef } from './subprocess/def.ts';
import { def as boundaryDef } from './boundary/def.ts';
import type { NodeDef } from './def-types.ts';

export const NODE_DEFS: NodeDef[] = [
  startDef, endDef, catchDef, throwDef, boundaryDef,        // Events
  userTaskDef, scriptDef, httpDef, ruleDef, sendDef, receiveDef, manualDef,  // Tasks
  gatewayDef,                                                // Gateways
  callDef, forEachDef, subprocessDef,                        // Sub-process
];
/** engineType → def (ports/schema lookup for validation + UI). */
export const NODE_DEF_BY_TYPE: Record<string, NodeDef> = Object.fromEntries(NODE_DEFS.map((d) => [d.engineType, d]));

export { CATEGORIES } from './def-types.ts';
export type { HandlerCtx, HandlerResult, NodeHandler } from './types.ts';
export type { NodeDef, Ports, UiSection, UiField, PaletteEntry } from './def-types.ts';
