import { type NodeDef, GENERAL } from '../def-types.ts';
// throw's signal/message/escalation sub-values default to '' — a non-blank decoy value would defeat
// node-config's required-field check. `compensation` (on `throw`) and `terminateAll` are ENGINE-ONLY
// additive fields — @fabrixly/bpmn-sdk's own EventDef/EngineEnd types (the real BPMN2 round-trip
// contract) don't declare them, so a natively-authored process using either loses that information on
// export to real jBPM BPMN2 XML. They're read via a loose (not strictly-typed) cast in handler.ts.
export const def: NodeDef = {
  engineType: 'end',
  palette: [
    { key: 'end', label: 'End', category: 'Events', icon: '⏹', color: '#dc2626', engineType: 'end', defaults: { type: 'end', name: 'End' } },
    { key: 'end-terminate', label: 'End (Terminate)', category: 'Events', icon: '⛔', color: '#dc2626', engineType: 'end', defaults: { type: 'end', result: 'terminate' } },
    { key: 'end-signal', label: 'End (Signal)', category: 'Events', icon: '📣', color: '#dc2626', engineType: 'end', defaults: { type: 'end', throw: { signal: '' } } },
    { key: 'end-message', label: 'End (Message)', category: 'Events', icon: '✉', color: '#dc2626', engineType: 'end', defaults: { type: 'end', throw: { message: '' } } },
    { key: 'end-escalation', label: 'End (Escalation)', category: 'Events', icon: '⬆', color: '#dc2626', engineType: 'end', defaults: { type: 'end', throw: { escalation: '' } } },
    { key: 'end-compensation', label: 'End (Compensation)', category: 'Events', icon: '↩', color: '#dc2626', engineType: 'end', defaults: { type: 'end', throw: { compensation: true } } },
  ],
  ports: { maxOut: 0 },
  schema: [GENERAL, { title: 'End behavior', fields: [
    { key: 'result', label: 'Result', widget: 'select', options: ['(normal)', 'terminate'], help: 'terminate cancels every other active token and ends this (sub)process — not automatically the whole instance; see "Terminate scope" below' },
    { key: 'terminateAll', label: 'Terminate scope: escalate to root', widget: 'bool', help: 'Only applies when Result = terminate — has no effect otherwise. Off (default) = this (sub)process only — the parent resumes normally past it. On = force-end every ancestor too, all the way up to the top-level instance.' },
    { key: 'throw', label: 'Throw event', widget: 'event', options: ['none', 'signal', 'error', 'escalation', 'message', 'compensation'], help: 'Fires an event as this path completes: error is caught by a matching Boundary/event sub-process (uncaught = instance fails); signal broadcasts to every waiting instance and every signal-start process, tenant-wide; message delivers to exactly one waiting instance (point-to-point); escalation propagates only within THIS instance\'s own boundary/event-subprocess chain (uncaught = simply continues, no failure); compensation runs recorded compensation handlers (all, or one named node) before completing.' },
  ] }],
  diagram: { icon: 'error', color: '#dc2626', shape: 'circle' },
  typeLabel: 'End event',
};
