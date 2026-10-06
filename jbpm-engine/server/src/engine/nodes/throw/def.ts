import { type NodeDef, GENERAL } from '../def-types.ts';
// compensation (+ its `ref` sub-field) is an ENGINE-ONLY additive kind — @fabrixly/bpmn-sdk's own
// EventDef doesn't declare it, so a natively-authored compensation throw loses that information on
// export to real jBPM BPMN2 XML.
export const def: NodeDef = {
  engineType: 'throw',
  palette: [
    { key: 'throw-signal', label: 'Throw Signal', category: 'Events', icon: '📣', color: '#7c3aed', engineType: 'throw', defaults: { type: 'throw', event: { signal: '' } } },
    { key: 'throw-message', label: 'Throw Message', category: 'Events', icon: '✉', color: '#7c3aed', engineType: 'throw', defaults: { type: 'throw', event: { message: '' } } },
    { key: 'throw-escalation', label: 'Throw Escalation', category: 'Events', icon: '⬆', color: '#7c3aed', engineType: 'throw', defaults: { type: 'throw', event: { escalation: '' } } },
    { key: 'throw-compensation', label: 'Compensate', category: 'Events', icon: '↩', color: '#0d9488', engineType: 'throw', defaults: { type: 'throw', event: { compensation: true } } },
  ],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Event', fields: [
    { key: 'event', label: 'Throw', widget: 'event', options: ['signal', 'message', 'escalation', 'compensation'], required: true, help: 'signal broadcasts to every waiting instance and every signal-start process, tenant-wide; message delivers to exactly one waiting instance (point-to-point); escalation propagates only within THIS instance\'s own boundary/event-subprocess chain (uncaught = simply continues, no failure); compensation runs recorded compensation handlers (all, or one named node) before continuing.' },
  ] }],
  diagram: { icon: 'mail', color: '#7c3aed', shape: 'circle' },
  typeLabel: 'Throw event',
};
