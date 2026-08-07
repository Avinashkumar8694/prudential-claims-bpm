import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'end',
  palette: [
    { key: 'end', label: 'End', category: 'Events', icon: '⏹', color: '#dc2626', engineType: 'end', defaults: { type: 'end', name: 'End' } },
    { key: 'end-terminate', label: 'End (Terminate)', category: 'Events', icon: '⛔', color: '#dc2626', engineType: 'end', defaults: { type: 'end', result: 'terminate' } },
  ],
  ports: { maxOut: 0 },   // end: no outgoing; multiple paths may converge into an end (unlimited in)
  schema: [GENERAL, { title: 'End behavior', fields: [
    { key: 'result', label: 'Result', widget: 'select', options: ['(normal)', 'terminate'], help: 'terminate cancels all other tokens and ends the whole instance' },
    { key: 'throw', label: 'Throw event', widget: 'event', options: ['none', 'signal', 'error', 'escalation', 'message'] },
    { key: 'throw.correlationKey', label: 'Correlate to ($var)', widget: 'text', placeholder: '$claimId', help: 'Deliver only to the waiting instance whose own correlationKey matches this variable’s value; blank = deliver to every instance waiting on this name' },
  ] }],
};
