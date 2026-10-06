// The node factory — the single entry point every node type joins the engine through. A node folder
// is self-contained (def.ts + handler.ts + a tiny index.ts that imports both and calls registerNode()
// here); nothing else needs to know its internals. This replaces an earlier design where a central
// nodes/index.ts hand-maintained two separate object literals (NODE_HANDLERS, NODE_DEFS) — adding a
// node meant four manual edits across two data structures with ZERO validation, so a def registered
// with no matching handler (or vice versa, or a palette tile whose engineType/defaults.type disagreed
// with its own def) silently produced a dead no-op at runtime instead of a build-time or startup error.
//
// registerNode() is the factory: it validates consistency THE MOMENT a node registers (not just via a
// separate test file) and throws loudly the instant something's wired up wrong, so a mistake surfaces
// as a startup crash pointing at the exact broken node, never a silent runtime skip.
import type { NodeDef } from './def-types.ts';
import type { NodeHandler } from './types.ts';

export interface NodeModule {
  engineType: string;
  def: NodeDef;
  /** Omit only for the one documented handler-less exception: boundary, whose "acting" logic is
   *  orchestrated by execution-engine.ts itself (see boundary/handler.ts's own doc comment for why —
   *  it needs engine capabilities, like the timer repo, a plain matching function can't get). */
  handler?: NodeHandler;
}

const HANDLERLESS_BY_DESIGN = new Set(['boundary']);

const handlers: Record<string, NodeHandler> = {};
const defs: Record<string, NodeDef> = {};
let sealed = false;

export function registerNode(mod: NodeModule): void {
  if (sealed) throw new Error(`registerNode("${mod.engineType}") called after the registry was sealed — all node modules must self-register during their own index.ts's top-level import, before anything reads the registry`);
  const { engineType, def, handler } = mod;
  if (defs[engineType]) throw new Error(`Node type "${engineType}" is already registered — duplicate registerNode() call (check for two node folders using the same engineType)`);
  if (def.engineType !== engineType) throw new Error(`Node "${engineType}": def.engineType ("${def.engineType}") does not match the engineType passed to registerNode()`);
  if (!def.palette.length) throw new Error(`Node "${engineType}": def has no palette entries — it could never be dragged onto a canvas`);
  for (const p of def.palette) {
    if (p.engineType !== engineType) throw new Error(`Node "${engineType}": palette tile "${p.key}" declares engineType "${p.engineType}"`);
    if ((p.defaults as { type?: string }).type !== engineType) throw new Error(`Node "${engineType}": palette tile "${p.key}"'s defaults.type is "${(p.defaults as { type?: string }).type}" — this is the value process-canvas.component.ts actually stamps onto a freshly-dropped node, so a mismatch here would silently create a node of the WRONG runtime type`);
  }
  if (!handler && !HANDLERLESS_BY_DESIGN.has(engineType)) throw new Error(`Node "${engineType}" registered with no handler and isn't a documented handler-less exception (see HANDLERLESS_BY_DESIGN)`);
  if (handler && HANDLERLESS_BY_DESIGN.has(engineType)) throw new Error(`Node "${engineType}" is listed as handler-less by design but was registered WITH a handler — update HANDLERLESS_BY_DESIGN if this is now intentional`);
  defs[engineType] = def;
  if (handler) handlers[engineType] = handler;
}

/** Called once, after every node module's side-effect import has run (see nodes/index.ts), to lock
 *  the registry against further registration — a defense against a node module being imported lazily
 *  / out of order and registering itself after something has already read allDefs()/allHandlers(). */
export function sealRegistry(): void { sealed = true; }

export function allHandlers(): Readonly<Record<string, NodeHandler>> { return handlers; }
export function allDefs(): NodeDef[] { return Object.values(defs); }
export function defByType(type: string): NodeDef | undefined { return defs[type]; }
export function isHandlerlessByDesign(type: string): boolean { return HANDLERLESS_BY_DESIGN.has(type); }
