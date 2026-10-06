import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'catch',
  palette: [
    { key: 'catch-timer', label: 'Timer', category: 'Events', icon: '⏱', color: '#7c3aed', engineType: 'catch', defaults: { type: 'catch', event: { timer: { duration: 'PT5M' } } } },
    { key: 'catch-message', label: 'Catch Message', category: 'Events', icon: '✉', color: '#7c3aed', engineType: 'catch', defaults: { type: 'catch', event: { message: '' } } },
    { key: 'catch-signal', label: 'Catch Signal', category: 'Events', icon: '📶', color: '#7c3aed', engineType: 'catch', defaults: { type: 'catch', event: { signal: '' } } },
    { key: 'catch-condition', label: 'Catch Condition', category: 'Events', icon: '❔', color: '#7c3aed', engineType: 'catch', defaults: { type: 'catch', event: { condition: '', lang: 'js' } } },
  ],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Event', fields: [
    { key: 'event', label: 'Catch', widget: 'event', options: ['timer', 'message', 'signal', 'condition'], required: true, help: 'What this node waits for. Timer: a durable wait (duration/cycle/date) that survives a restart. Message: point-to-point, delivered to the single oldest waiter. Signal: broadcast, delivered to every waiter and every matching signal-start. Condition: an expression re-checked against this instance\'s variables every time anything changes them — resolves the instant it becomes true, waits forever if it never does.' },
  ] }],
  diagram: { icon: 'clock', color: '#7c3aed', shape: 'circle' },
  typeLabel: 'Catch event',
};
