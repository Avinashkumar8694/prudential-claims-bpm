import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'http',
  palette: [{ key: 'http', label: 'Service Task (REST)', category: 'Tasks', icon: '🌐', color: '#0d9488', engineType: 'http', defaults: { type: 'http', method: 'POST', url: '/' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Request', fields: [
    { key: 'method', label: 'Method', widget: 'select', options: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] },
    { key: 'url', label: 'URL (appended to base)', widget: 'text', placeholder: '/v1/claims' },
    { key: 'headers', label: 'Headers', widget: 'keyval' },
    { key: 'body', label: 'Body (value or $var)', widget: 'keyval', valueSource: 'ownRef', help: 'Right side: "$name" to send one of this process\'s own variables, or a literal value.' },
  ] }, { title: 'Response', fields: [
    { key: 'resultTo', label: 'Map response → variable (var ← JSONPath)', widget: 'keyval', keySource: 'own', help: 'Left = this process\'s variable to write (pick an existing one to overwrite it, or type a new name), e.g. verifierId ← $.verifierId.' },
  ] }],
  diagram: { icon: 'globe', color: '#0d9488', shape: 'rectangle' },
  typeLabel: 'Service task',
};
