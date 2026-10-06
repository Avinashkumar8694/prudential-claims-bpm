import { type NodeDef, GENERAL } from '../def-types.ts';
// ruleflowGroup defaults to '' (not a placeholder) — a non-blank decoy value would trivially satisfy
// node-config's required-alternative check without a real ruleset ever being picked.
export const def: NodeDef = {
  engineType: 'rule',
  palette: [
    { key: 'rule', label: 'Business Rule (DRL)', category: 'Tasks', icon: '📐', color: '#ea580c', engineType: 'rule', defaults: { type: 'rule', ruleflowGroup: '' } },
    { key: 'rule-dmn', label: 'Business Rule (DMN)', category: 'Tasks', icon: '📐', color: '#ea580c', engineType: 'rule', defaults: { type: 'rule', dmn: { namespace: '', model: '', decision: '' } } },
  ],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'DRL rules (alternative — checked second)', fields: [
    { key: 'ruleflowGroup', label: 'Ruleflow group', widget: 'assetRef', assetKind: 'rulesets', placeholder: 'classify', help: 'DRL ruleflow-group evaluation is not available in this build (see decisioning.ts) — fails with RULE_ENGINE_UNAVAILABLE at runtime. Only used if DMN below is empty.' },
  ] }, { title: 'DMN (alternative — checked first)', fields: [
    { key: 'dmn.namespace', label: 'DMN namespace', widget: 'text', help: 'Matches a decisions asset by namespace when dmn.model does not match. If DMN is set at all, it is checked first and wins over the DRL ruleflow group above.' },
    { key: 'dmn.model', label: 'DMN model name', widget: 'assetRef', assetKind: 'decisions', help: 'Matches a decisions asset by name. Either this or dmn.namespace must resolve to a real asset, or the node fails with RULE_ERROR at runtime.' },
    { key: 'dmn.decision', label: 'Decision name', widget: 'text', help: 'Which decision inside the model to run. Leave blank to use the model\'s first decision.' },
  ] }],
  diagram: { icon: 'branch', color: '#ea580c', shape: 'rectangle' },
  typeLabel: 'Business rule',
};
