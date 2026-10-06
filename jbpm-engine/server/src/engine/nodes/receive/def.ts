import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'receive',
  palette: [{ key: 'receive', label: 'Receive Task', category: 'Tasks', icon: '📥', color: '#16a34a', engineType: 'receive', defaults: { type: 'receive', message: '' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Message', fields: [
    { key: 'message', label: 'Message name', widget: 'assetRef', assetKind: 'messages', required: true, help: 'Parks this token until a broadcast with this exact name arrives — from a Send/Throw node elsewhere, or the POST /instances/:id/signal API. No timeout by itself; pair with a Boundary timer if you need "give up after N hours."' },
    { key: 'implementation', label: 'Implementation', widget: 'select', options: ['##WebService', 'Other'], help: 'Documentary only — never read at runtime. Records the intended real-world transport for humans/BPMN-export.' },
  ] }],
  diagram: { icon: 'download', color: '#16a34a', shape: 'rectangle' },
  typeLabel: 'Receive task',
};
