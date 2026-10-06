import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'subprocess',
  // Two palette tiles, ONE engine type: real jBPM's own BPMN2 XML marks the same <subProcess>
  // element with triggeredByEvent="true" for the event-sub-process case (@fabrixly/bpmn-sdk's
  // fromEngine/toEngine already round-trips this exact `on.error` shape). A regular Sub-process tile
  // leaves `on` unset (wired into the flow normally); the Event Sub-process tile pre-fills `on.error`
  // and seeds a real inner Error Start node — never wire it; see the 'event-sub-process-wired'
  // validation rule, which hard-errors at publish time if a node ever ends up BOTH wired AND carrying
  // `on.error`.
  palette: [
    { key: 'subprocess', label: 'Sub-process', category: 'Sub-process', icon: '▭', color: '#4f46e5', engineType: 'subprocess', defaults: { type: 'subprocess', nodes: [], flows: [] } },
    { key: 'subprocess-event-error', label: 'Event Sub-process (Error)', category: 'Sub-process', icon: '⚡', color: '#dc2626', engineType: 'subprocess', defaults: { type: 'subprocess', name: 'Error handler', on: { error: '' }, nodes: [{ id: 'errStart', type: 'start', name: 'Start (Error)', on: { error: '' } }], flows: [] } },
  ],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Sub-process', fields: [
    { key: 'transaction', label: 'Transaction', widget: 'bool', help: 'Documentary BPMN2 transaction-subprocess marker only — this engine has no compensation/rollback semantics tied to it; toggling this has no runtime effect.' },
    { key: 'on.error', label: 'Event sub-process on error', widget: 'eventSubError', placeholder: '* or blank = any', help: 'Setting this turns the node into a process-wide error handler instead of a normal step: it fires the moment a matching error occurs ANYWHERE in the process, not via its own connections. Leave this node completely UNCONNECTED when it\'s set — publish will reject it otherwise. Also sets the matching code on this sub-process\'s own inner Error Start node.' },
  ] }],
  diagram: { icon: 'projects', color: '#4f46e5', shape: 'rectangle' },
  typeLabel: 'Sub-process',
};
