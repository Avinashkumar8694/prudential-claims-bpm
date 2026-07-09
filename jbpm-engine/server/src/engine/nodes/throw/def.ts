import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'throw',
  palette: [
    { key: 'throw-signal', label: 'Throw Signal', category: 'Events', icon: '📣', color: '#7c3aed', engineType: 'throw', defaults: { type: 'throw', event: { signal: 'Go' } } },
  ],
  ports: { in: true, out: true },
  schema: [GENERAL, { title: 'Event', fields: [
    { key: 'event', label: 'Throw', widget: 'event', options: ['signal', 'message', 'escalation'] },
  ] }],
};
