import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'manual',
  palette: [{ key: 'manual', label: 'Manual Task', category: 'Tasks', icon: '✋', color: '#64748b', engineType: 'manual', defaults: { type: 'manual', name: 'Manual Task' } }],
  ports: { in: true, out: true },
  schema: [GENERAL],
};
