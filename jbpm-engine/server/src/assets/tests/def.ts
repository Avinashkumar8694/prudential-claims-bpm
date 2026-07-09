// Test scenario asset — given/expect cases for a decision/process (SDK → .scesim).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'tests', label: 'Test scenarios', nameField: 'name',
  seed: (name) => ({ name, target: '', cases: [] }),
};
