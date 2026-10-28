// Guided decision tree asset (SDK → .gdt).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'decisionTrees', label: 'Decision trees', nameField: 'name',
  seed: (name, fields) => ({
    name,
    package: fields?.package || 'com.acme.rules',
    fact: fields?.fact || 'Claim',
    root: {
      test: { field: fields?.field || 'amount' },
      branches: [
        { match: { lte: 1000 }, then: { output: { approved: true, discount: 0.1 } } },
        { match: { gt: 1000 }, then: { output: { approved: false, discount: 0 } } },
      ],
    },
  }),
};
