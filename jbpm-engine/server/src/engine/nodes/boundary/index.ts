// Boundary is the one documented handler-less node type — its "acting" logic (cancelling the host,
// pushing the recovery flow's tokens) is orchestrated by execution-engine.ts itself, driven by the
// pure matching functions this folder exports (see handler.ts's own doc comment for why).
import { registerNode } from '../factory.ts';
import { def } from './def.ts';
export { def };
export * from './handler.ts';
registerNode({ engineType: 'boundary', def });
