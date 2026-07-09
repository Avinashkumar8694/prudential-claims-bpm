import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'boundary',
  palette: [
    { key: 'error-catch', label: 'Error Catch', category: 'Events', icon: '⚠', color: '#dc2626', engineType: 'boundary', defaults: { type: 'boundary', name: 'Error catch', on: [], event: { error: '*' }, interrupting: true } },
    { key: 'boundary-timer', label: 'Timer Catch', category: 'Events', icon: '⏰', color: '#7c3aed', engineType: 'boundary', defaults: { type: 'boundary', name: 'Timer', on: [], event: { timer: { duration: 'P1D' } }, interrupting: false } },
    { key: 'boundary-compensation', label: 'Compensation', category: 'Events', icon: '↩', color: '#0d9488', engineType: 'boundary', defaults: { type: 'boundary', name: 'Compensation', on: [], event: { compensation: true }, interrupting: false } },
  ],
  ports: { maxIn: 0, maxOut: 1 },   // boundary: no incoming; one recovery outgoing
  schema: [GENERAL, { title: 'Error / boundary catch', fields: [
    { key: 'on', label: 'Catch from', widget: 'nodes', help: 'Pick node(s) to catch (boundary), or “All nodes” for a process-wide handler. Connect this node’s outgoing flow to the recovery path.' },
    { key: 'event', label: 'Trigger', widget: 'event', options: ['error', 'timer', 'message', 'signal', 'escalation', 'condition'] },
    { key: 'interrupting', label: 'Interrupting (cancel the caught activity)', widget: 'bool' },
  ] }],
};
