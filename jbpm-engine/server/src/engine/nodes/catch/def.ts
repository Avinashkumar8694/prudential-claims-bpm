import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'catch',
  palette: [
    { key: 'catch-timer', label: 'Timer', category: 'Events', icon: '⏱', color: '#7c3aed', engineType: 'catch', defaults: { type: 'catch', event: { timer: { duration: 'PT5M' } } } },
    { key: 'catch-message', label: 'Catch Message', category: 'Events', icon: '✉', color: '#7c3aed', engineType: 'catch', defaults: { type: 'catch', event: { message: 'Msg' } } },
  ],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Event', fields: [
    { key: 'event', label: 'Catch', widget: 'event', options: ['timer', 'message', 'signal', 'condition'] },
  ] }],
};
