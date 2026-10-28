import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'script',
  palette: [{ key: 'script', label: 'Script Task', category: 'Tasks', icon: '{ }', color: '#0891b2', engineType: 'script', defaults: { type: 'script', lang: 'js', code: '' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Script (JavaScript)', fields: [
    { key: 'code', label: 'Script body', widget: 'code', placeholder: 'kcontext.setVariable("x", 1);', help: 'Runs as JavaScript against kcontext (getVariable/setVariable).' },
  ] }],
  diagram: { icon: 'code', color: '#0891b2', shape: 'rectangle' },
  typeLabel: 'Script task',
};
