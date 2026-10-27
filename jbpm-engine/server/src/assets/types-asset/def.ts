// Data type asset — a POJO/fact type used by variables, forms, and rules (SDK → .java).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'types', label: 'Data types', nameField: 'name',
  seed: (name) => ({ name, fields: [] }),
};
