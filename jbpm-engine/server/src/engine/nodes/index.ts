// Node registry bootstrap. Each node type is fully self-contained (def.ts + handler.ts + its own
// index.ts, which imports both and calls registerNode() — see factory.ts). Adding a new node type =
// create a folder that does the same, then add ONE import line here. The factory validates
// consistency (engineType agreement, palette shape, handler presence) the moment each module
// registers, so a mistake fails loudly at import time — never a silent runtime no-op.
import './start/index.ts';
import './end/index.ts';
import './manual/index.ts';
import './script/index.ts';
import './http/index.ts';
import './rule/index.ts';
import './gateway/index.ts';
import './user-task/index.ts';
import './receive/index.ts';
import './catch/index.ts';
import './throw/index.ts';
import './send/index.ts';
import './call/index.ts';
import './for-each/index.ts';
import './subprocess/index.ts';
import './boundary/index.ts';
import './work-item/index.ts';

import { allHandlers, allDefs, defByType, sealRegistry } from './factory.ts';
import type { NodeDef } from './def-types.ts';

sealRegistry();

export const NODE_HANDLERS = allHandlers();
export const NODE_DEFS: NodeDef[] = allDefs();
export const NODE_DEF_BY_TYPE: Record<string, NodeDef> = Object.fromEntries(NODE_DEFS.map((d) => [d.engineType, d]));
export { defByType };

// child-completion output-mapping logic execution-engine.ts's tryResumeParent needs for the ASYNC
// path (child instead waited, completing later) — a deliberately sparse capability map, not a mirror
// of NODE_HANDLERS. Only call/subprocess ever produce a wait:{kind:'child'} today.
import { mapChildOutputs as mapCallOutputs } from './call/handler.ts';
import { mapChildOutputs as mapSubprocessOutputs } from './subprocess/handler.ts';
import type { EngineNode } from '../../sdk/index.ts';
import type { Instance } from '../../domain.ts';
export const CHILD_OUTPUT_MAPPERS: Partial<Record<string, (n: EngineNode, child: Instance) => Record<string, unknown>>> = {
  call: mapCallOutputs, subprocess: mapSubprocessOutputs,
};
export { buildMultiInstanceResult } from './for-each/handler.ts';

export { CATEGORIES } from './def-types.ts';
export type { HandlerCtx, HandlerResult, NodeHandler } from './types.ts';
export type { NodeDef, Ports, UiSection, UiField, PaletteEntry } from './def-types.ts';
