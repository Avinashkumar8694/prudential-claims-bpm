// Guided decision table asset — tabular rules over one fact (SDK → .gdst).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'guidedTables', label: 'Decision tables', nameField: 'name',
  seed: (name) => ({ name, fact: '', conditions: [], actions: [], rows: [] }),
};
