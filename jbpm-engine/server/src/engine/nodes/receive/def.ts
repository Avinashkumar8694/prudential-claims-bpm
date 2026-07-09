import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'receive',
  palette: [{ key: 'receive', label: 'Receive Task', category: 'Tasks', icon: '📥', color: '#16a34a', engineType: 'receive', defaults: { type: 'receive', message: 'Msg' } }],
  ports: { in: true, out: true },
  schema: [GENERAL, { title: 'Message', fields: [
    { key: 'message', label: 'Message name', widget: 'text' },
    { key: 'implementation', label: 'Implementation', widget: 'select', options: ['##WebService', 'Other'] },
  ] }],
};
