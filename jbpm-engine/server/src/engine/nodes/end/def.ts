import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'end',
  palette: [
    { key: 'end', label: 'End', category: 'Events', icon: '⏹', color: '#dc2626', engineType: 'end', defaults: { type: 'end', name: 'End' } },
    { key: 'end-terminate', label: 'End (Terminate)', category: 'Events', icon: '⛔', color: '#dc2626', engineType: 'end', defaults: { type: 'end', result: 'terminate' } },
  ],
  ports: { in: true, out: false },   // end: incoming only
  schema: [GENERAL, { title: 'End behavior', fields: [
    { key: 'result', label: 'Result', widget: 'select', options: ['(normal)', 'terminate'], help: 'terminate cancels all other tokens and ends the whole instance' },
    { key: 'throw', label: 'Throw event', widget: 'event', options: ['none', 'signal', 'error', 'escalation', 'message'] },
  ] }],
};
