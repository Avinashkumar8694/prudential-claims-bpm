import { registerNode } from '../factory.ts';
import { def } from './def.ts';
import { handler } from './handler.ts';
export { def, handler };
registerNode({ engineType: 'start', def, handler });
