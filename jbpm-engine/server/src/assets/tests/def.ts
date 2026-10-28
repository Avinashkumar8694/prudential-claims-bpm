// Test scenario asset — given/expect cases for a decision/process (SDK → .scesim).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'tests', label: 'Test scenarios', nameField: 'name',
  seed: (name, fields) => ({
    name,
    target: fields?.target || 'Eligibility',
    description: fields?.description || `Verification test suite for ${fields?.target || 'Eligibility'}`,
    cases: [
      {
        name: 'Small claim auto-approval',
        given: { amount: 500, creditScore: 800 },
        expect: { approved: true },
      },
      {
        name: 'High claim rejection',
        given: { amount: 15000, creditScore: 600 },
        expect: { approved: false },
      },
    ],
  }),
};
