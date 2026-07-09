import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'send',
  palette: [{ key: 'send', label: 'Send Task', category: 'Tasks', icon: '📤', color: '#16a34a', engineType: 'send', defaults: { type: 'send', message: 'Msg' } }],
  ports: { in: true, out: true },
  schema: [GENERAL, { title: 'Message', fields: [
    { key: 'message', label: 'Message name', widget: 'text' },
    { key: 'implementation', label: 'Implementation', widget: 'select', options: ['##WebService', 'Other'] },
  ] }],
};
