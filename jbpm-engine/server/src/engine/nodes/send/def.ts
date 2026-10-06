import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'send',
  palette: [{ key: 'send', label: 'Send Task', category: 'Tasks', icon: '📤', color: '#16a34a', engineType: 'send', defaults: { type: 'send', message: '' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Message', fields: [
    { key: 'message', label: 'Message name', widget: 'assetRef', assetKind: 'messages', required: true, help: 'Sent point-to-point via broadcast() — resolves the single oldest Receive/Catch task instance-wide currently waiting on this exact name, then this task continues immediately without waiting for a reply. If nothing is waiting right now, the send is a silent no-op.' },
    { key: 'implementation', label: 'Implementation', widget: 'select', options: ['##WebService', 'Other'], help: 'Documentary only — never read at runtime.' },
    { key: 'correlationKey', label: 'Correlate to ($var)', widget: 'varRef', varSource: 'ownRef', help: 'Optional. A "$name" reference resolved against this process\'s own variables — narrows delivery to only the waiting instance(s) whose OWN correlationKey (set at that instance\'s start) matches this value. Leave blank for the default "deliver to the oldest waiter, regardless of correlationKey" behavior.' },
  ] }],
  diagram: { icon: 'upload', color: '#16a34a', shape: 'rectangle' },
  typeLabel: 'Send task',
};
