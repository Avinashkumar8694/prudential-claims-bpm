import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'gateway',
  palette: [
    { key: 'gw-exclusive', label: 'Exclusive Gateway', category: 'Gateways', icon: '✕', color: '#f59e0b', engineType: 'gateway', defaults: { type: 'gateway', mode: 'exclusive' } },
    { key: 'gw-parallel', label: 'Parallel Gateway', category: 'Gateways', icon: '＋', color: '#f59e0b', engineType: 'gateway', defaults: { type: 'gateway', mode: 'parallel' } },
    { key: 'gw-inclusive', label: 'Inclusive Gateway', category: 'Gateways', icon: '○', color: '#f59e0b', engineType: 'gateway', defaults: { type: 'gateway', mode: 'inclusive' } },
    { key: 'gw-event', label: 'Event Gateway', category: 'Gateways', icon: '◇', color: '#f59e0b', engineType: 'gateway', defaults: { type: 'gateway', mode: 'event' } },
  ],
  ports: {},
  schema: [GENERAL, { title: 'Gateway', fields: [
    // 'complex' is a real, selectable mode (part of the engine's own GatewayMode contract) but has no
    // distinct runtime today — handler.ts evaluates it exactly like 'exclusive' (first matching flow,
    // else default). Not offered as its own palette tile since there's nothing distinct to demonstrate.
    { key: 'mode', label: 'Mode', widget: 'select', options: ['exclusive', 'parallel', 'inclusive', 'event', 'complex'], required: true, help: 'Branching semantics: exclusive takes the first flow whose condition matches (else default); parallel forks every outgoing flow; inclusive takes every flow whose condition matches (else default); event races every downstream catch and cancels the losers that don\'t fire first; complex currently behaves exactly like exclusive (no distinct runtime yet).' },
    { key: 'direction', label: 'Direction', widget: 'select', options: ['Diverging', 'Converging'], help: 'Documentary only — has no effect on execution. Diverging/converging behavior is always inferred from how many incoming vs. outgoing connections this gateway actually has.' },
    { key: 'default', label: 'Default flow id', widget: 'text', help: 'Must exactly match the id of one of this gateway\'s own outgoing connections (not a node id). If no other flow\'s condition matches, this flow is taken; if this id doesn\'t match any outgoing flow, the gateway silently falls back to the first flow with no condition at all.' },
  ] }],
  diagram: { icon: 'branch', color: '#f59e0b', shape: 'diamond' },
  typeLabel: 'Gateway',
};
