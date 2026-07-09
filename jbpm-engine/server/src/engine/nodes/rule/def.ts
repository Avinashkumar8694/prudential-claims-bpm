import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'rule',
  palette: [{ key: 'rule', label: 'Business Rule', category: 'Tasks', icon: '📐', color: '#ea580c', engineType: 'rule', defaults: { type: 'rule', ruleflowGroup: 'group' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'DRL rules', fields: [
    { key: 'ruleflowGroup', label: 'Ruleflow group', widget: 'text', placeholder: 'classify' },
  ] }, { title: 'DMN (alternative)', fields: [
    { key: 'dmn.namespace', label: 'DMN namespace', widget: 'text' },
    { key: 'dmn.model', label: 'DMN model name', widget: 'text' },
    { key: 'dmn.decision', label: 'Decision name', widget: 'text' },
  ] }],
};
