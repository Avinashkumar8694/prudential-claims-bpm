import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'gateway',
  palette: [
    { key: 'gw-exclusive', label: 'Exclusive Gateway', category: 'Gateways', icon: '✕', color: '#f59e0b', engineType: 'gateway', defaults: { type: 'gateway', mode: 'exclusive' } },
    { key: 'gw-parallel', label: 'Parallel Gateway', category: 'Gateways', icon: '＋', color: '#f59e0b', engineType: 'gateway', defaults: { type: 'gateway', mode: 'parallel' } },
    { key: 'gw-inclusive', label: 'Inclusive Gateway', category: 'Gateways', icon: '○', color: '#f59e0b', engineType: 'gateway', defaults: { type: 'gateway', mode: 'inclusive' } },
    { key: 'gw-event', label: 'Event Gateway', category: 'Gateways', icon: '◇', color: '#f59e0b', engineType: 'gateway', defaults: { type: 'gateway', mode: 'event' } },
  ],
  ports: {} /* gateway: unlimited (fan in or out) */,   // diverging → many out; converging → many in
  schema: [GENERAL, { title: 'Gateway', fields: [
    { key: 'mode', label: 'Mode', widget: 'select', options: ['exclusive', 'parallel', 'inclusive', 'event', 'complex'] },
    { key: 'direction', label: 'Direction', widget: 'select', options: ['Diverging', 'Converging'] },
    { key: 'default', label: 'Default flow id', widget: 'text', help: 'Taken when no condition matches (exclusive/inclusive)' },
  ] }],
  diagram: { icon: 'branch', color: '#f59e0b', shape: 'diamond' },
  typeLabel: 'Gateway',
};
