import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'forEach',
  palette: [{ key: 'forEach', label: 'Multi-Instance', category: 'Sub-process', icon: '⇶', color: '#4f46e5', engineType: 'forEach', defaults: { type: 'forEach', process: '', over: 'items' } }],
  ports: { in: true, out: true },
  schema: [GENERAL, { title: 'Multi-instance', fields: [
    { key: 'process', label: 'Process id / key', widget: 'text' },
    { key: 'over', label: 'Collection variable', widget: 'text', placeholder: 'applicablePolicies' },
    { key: 'as', label: 'Item variable', widget: 'text', placeholder: 'currentPolicy' },
    { key: 'collectInto', label: 'Collect results into', widget: 'text' },
    { key: 'itemResult', label: 'Item result variable', widget: 'text' },
    { key: 'parallel', label: 'Run in parallel', widget: 'bool' },
    { key: 'pass', label: 'Pass-through variables', widget: 'stringlist' },
  ] }],
};
