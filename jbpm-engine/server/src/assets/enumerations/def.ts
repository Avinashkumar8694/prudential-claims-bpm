// Enumeration asset — value lists for form/field dropdowns (SDK → enumerations).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'enumerations', label: 'Enumerations', nameField: 'name',
  seed: (name) => ({ name, entries: {} }),
};
