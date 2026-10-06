import { type NodeDef, GENERAL } from '../def-types.ts';
import { WORKITEM_NAMES } from '../../workitems/registry.ts';
// Operation tasks backed by work-item handlers. Each palette tile presets the handler; the property
// panel lets you pick the handler, supply params ($var), and map results back to variables.
export const def: NodeDef = {
  engineType: 'workItem',
  palette: [
    { key: 'email', label: 'Email', category: 'Tasks', icon: '✉', color: '#16a34a', engineType: 'workItem', defaults: { type: 'workItem', name: 'Send email', handler: 'Email', params: { to: '', subject: '', body: '' } } },
    { key: 'sms', label: 'SMS', category: 'Tasks', icon: '💬', color: '#16a34a', engineType: 'workItem', defaults: { type: 'workItem', name: 'Send SMS', handler: 'SMS', params: { to: '', text: '' } } },
    { key: 'db', label: 'DB Task', category: 'Tasks', icon: '🗄', color: '#2563eb', engineType: 'workItem', defaults: { type: 'workItem', name: 'DB query', handler: 'DBQuery', params: { query: '' } } },
    { key: 'compute', label: 'Compute', category: 'Tasks', icon: '∑', color: '#0891b2', engineType: 'workItem', defaults: { type: 'workItem', name: 'Compute', handler: 'Compute', params: { expression: '' }, resultTo: { result: 'result' } } },
    { key: 'log', label: 'Log', category: 'Tasks', icon: '📝', color: '#64748b', engineType: 'workItem', defaults: { type: 'workItem', name: 'Log', handler: 'Log', params: { message: '' } } },
  ],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Work item', fields: [
    { key: 'handler', label: 'Handler', widget: 'select', options: WORKITEM_NAMES, required: true, help: 'Email → env.EMAIL_SERVICE_URL, SMS → env.SMS_SERVICE_URL, DBQuery → env.DB_SERVICE_URL: POSTs params as JSON if the var is set in this deployment\'s env, otherwise simulates. Compute evaluates params.expression as a JS expression (no kcontext access). Log just records params.message. A failed call raises SERVICE_ERROR, catchable by a Boundary/error-catch.' },
    { key: 'params', label: 'Parameters (value or $var)', widget: 'keyval', valueSource: 'ownRef', help: 'Right side: "$name" to pass one of this process\'s own variables, or a literal value.' },
    { key: 'resultTo', label: 'Map result → variable', widget: 'keyval', keySource: 'own', help: 'Left = this process\'s variable to write. Right = the field name on the handler\'s own result shape — a typo here silently sets the variable to undefined, no error.' },
  ] }],
  diagram: { icon: 'admin', color: '#0891b2', shape: 'rectangle' },
  typeLabel: 'Work item',
};
