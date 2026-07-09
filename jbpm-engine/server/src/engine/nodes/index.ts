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

export type { HandlerCtx, HandlerResult, NodeHandler } from './types.ts';
