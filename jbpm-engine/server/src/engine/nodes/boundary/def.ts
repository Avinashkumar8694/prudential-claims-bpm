import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'boundary',
  palette: [
    { key: 'error-catch', label: 'Error Catch', category: 'Events', icon: '⚠', color: '#dc2626', engineType: 'boundary', defaults: { type: 'boundary', name: 'Error catch', on: [], event: { error: '*' }, interrupting: true } },
    { key: 'boundary-timer', label: 'Timer Catch', category: 'Events', icon: '⏰', color: '#7c3aed', engineType: 'boundary', defaults: { type: 'boundary', name: 'Timer', on: [], event: { timer: { duration: 'P1D' } }, interrupting: false } },
    { key: 'boundary-signal', label: 'Signal Catch', category: 'Events', icon: '📶', color: '#7c3aed', engineType: 'boundary', defaults: { type: 'boundary', name: 'Signal catch', on: [], event: { signal: '' }, interrupting: true } },
    { key: 'boundary-message', label: 'Message Catch', category: 'Events', icon: '✉', color: '#7c3aed', engineType: 'boundary', defaults: { type: 'boundary', name: 'Message catch', on: [], event: { message: '' }, interrupting: true } },
    { key: 'boundary-escalation', label: 'Escalation Catch', category: 'Events', icon: '⬆', color: '#7c3aed', engineType: 'boundary', defaults: { type: 'boundary', name: 'Escalation catch', on: [], event: { escalation: '' }, interrupting: true } },
    { key: 'boundary-condition', label: 'Condition Catch', category: 'Events', icon: '❔', color: '#7c3aed', engineType: 'boundary', defaults: { type: 'boundary', name: 'Condition catch', on: [], event: { condition: '', lang: 'js' }, interrupting: false } },
    { key: 'boundary-compensation', label: 'Compensation', category: 'Events', icon: '↩', color: '#0d9488', engineType: 'boundary', defaults: { type: 'boundary', name: 'Compensation', on: [], event: { compensation: true }, interrupting: false } },
  ],
  ports: { maxIn: 0, maxOut: 1 },
  schema: [GENERAL, { title: 'Error / boundary catch', fields: [
    { key: 'on', label: 'Catch from', widget: 'nodes', help: 'Pick node(s) to catch (boundary), or "All nodes" for a process-wide handler. Connect this node\'s outgoing flow to the recovery path. (Real jBPM allows only one host activity per boundary event; this engine allows several, plus a process-wide "*".)' },
    { key: 'event', label: 'Trigger', widget: 'event', options: ['error', 'timer', 'message', 'signal', 'escalation', 'compensation', 'condition'], required: true, help: 'What causes this boundary to fire. Error: a host-specific catch matches ANY error from that host regardless of code; a global (on:"*") catch respects a specific code if you give one, blank/*/ANY = catch-all. Timer: a durable wait scheduled the moment the host starts waiting. Message/Signal: waits alongside the host for a broadcast (message = one recipient, signal = every listener). Escalation: resolved by a live scope-scan when thrown. Compensation: recorded when the host completes normally, run LIFO by a later compensation throw. Condition: an expression re-checked every engine tick.' },
    { key: 'interrupting', label: 'Interrupting (cancel the caught activity)', widget: 'bool', help: 'Cancels the host activity before this boundary\'s own outgoing flow runs. Only affects Timer/Message/Signal/Escalation/Condition triggers — for Error and Compensation triggers this has no effect.' },
  ] }],
  diagram: { icon: 'warning', color: '#7c3aed', shape: 'circle' },
  typeLabel: 'Boundary event',
};
