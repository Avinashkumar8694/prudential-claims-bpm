import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'start',
  palette: [
    { key: 'start', label: 'Start', category: 'Events', icon: '▶', color: '#16a34a', engineType: 'start', defaults: { type: 'start', name: 'Start' } },
    { key: 'start-signal', label: 'Start (Signal)', category: 'Events', icon: '📡', color: '#16a34a', engineType: 'start', defaults: { type: 'start', on: { signal: 'Start' } } },
  ],
  ports: { in: false, out: true },   // start: outgoing only
  schema: [GENERAL, { title: 'Trigger', fields: [
    { key: 'on', label: 'Start trigger', widget: 'event', options: ['none', 'signal', 'message', 'timer', 'condition'], help: 'How instances of this process are started' },
  ] }],
};
