import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'call',
  palette: [{ key: 'call', label: 'Call Activity', category: 'Sub-process', icon: '⇥', color: '#4f46e5', engineType: 'call', defaults: { type: 'call', process: '' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Called process', fields: [
    { key: 'process', label: 'Process id / key', widget: 'text', placeholder: 'child-workflow.process' },
    { key: 'inputs', label: 'Inputs (childVar ← $parentVar or value)', widget: 'keyval' },
    { key: 'outputs', label: 'Outputs (parentVar ← childVar)', widget: 'keyval' },
    { key: 'independent', label: 'Independent (don’t wait)', widget: 'bool' },
  ] }],
};
