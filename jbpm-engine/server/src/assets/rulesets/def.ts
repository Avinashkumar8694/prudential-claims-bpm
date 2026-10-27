// DRL ruleset asset — a ruleflow-group of rules (SDK → .drl; rule-engine evaluates at runtime).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'rulesets', label: 'DRL rules', nameField: 'group',
  seed: (name) => ({ group: name, rules: [] }),
};
