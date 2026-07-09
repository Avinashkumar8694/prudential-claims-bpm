import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'http',
  palette: [{ key: 'http', label: 'Service Task (REST)', category: 'Tasks', icon: '🌐', color: '#0d9488', engineType: 'http', defaults: { type: 'http', method: 'POST', url: '/' } }],
  ports: { in: true, out: true },
  schema: [GENERAL, { title: 'Request', fields: [
    { key: 'method', label: 'Method', widget: 'select', options: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] },
    { key: 'url', label: 'URL (appended to base)', widget: 'text', placeholder: '/v1/claims' },
    { key: 'headers', label: 'Headers', widget: 'keyval' },
    { key: 'body', label: 'Body (value or $var)', widget: 'keyval' },
  ] }, { title: 'Response', fields: [
    { key: 'resultTo', label: 'Map response → variable (var ← JSONPath)', widget: 'keyval', help: 'e.g. verifierId ← $.verifierId' },
  ] }],
};
