// Enumeration asset — value lists for form/field dropdowns (SDK → enumerations).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'enumerations', label: 'Enumerations', nameField: 'name',
  seed: (name, fields) => {
    const fact = fields?.fact || fields?.type || 'Claim';
    const field = fields?.field || 'status';
    const vals = Array.isArray(fields?.values) ? fields.values : typeof fields?.values === 'string' ? fields.values.split(',').map((s: string) => s.trim()).filter(Boolean) : ['NEW', 'PENDING', 'APPROVED', 'REJECTED'];
    return {
      name,
      type: fact,
      field,
      values: vals,
      entries: { [`${fact}.${field}`]: vals },
    };
  },
};
