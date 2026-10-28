// DRL ruleset asset — a ruleflow-group of rules (SDK → .drl; rule-engine evaluates at runtime).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'rulesets', label: 'DRL rules', nameField: 'group',
  seed: (name, fields) => ({
    group: name,
    package: fields?.package || 'com.acme.rules',
    rules: [
      {
        name: fields?.ruleName || 'Standard Approval',
        priority: 10,
        when: [{ fact: fields?.fact || 'Claim', where: { amount: { lte: 1000 } } }],
        then: [{ set: fields?.fact || 'Claim', fields: { approved: true, discount: 0.05 } }],
      },
    ],
  }),
};
