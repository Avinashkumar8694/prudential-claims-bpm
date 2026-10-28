// Guided decision table asset — tabular rules over one fact (SDK → .gdst).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'guidedTables', label: 'Decision tables', nameField: 'name',
  seed: (name, fields) => {
    const fact = fields?.fact || 'Claim';
    return {
      name,
      fact,
      package: fields?.package || 'com.acme.rules',
      conditions: [
        { field: 'amount', op: 'lte', type: 'number' },
        { field: 'region', op: 'eq', type: 'string' },
      ],
      actions: [
        { field: 'approved', type: 'boolean' },
        { field: 'discount', type: 'number' },
      ],
      rows: [
        { when: { amount: 1000 }, then: { approved: true, discount: 0.1 } },
        { when: { amount: 10000, region: 'US' }, then: { approved: false, discount: 0 } },
      ],
    };
  },
};
