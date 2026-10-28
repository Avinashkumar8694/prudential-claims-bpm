// Data type asset — a POJO/fact type used by variables, forms, and rules (SDK → .java).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'types', label: 'Data types', nameField: 'name',
  seed: (name, fields) => ({
    name,
    package: fields?.package || 'com.acme.model',
    fields: [
      { name: 'id', type: 'string', list: false },
      { name: 'amount', type: 'double', list: false },
      { name: 'status', type: 'string', list: false },
    ],
  }),
};
