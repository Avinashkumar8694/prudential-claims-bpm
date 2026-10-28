// Form asset — task/start form (SDK form model → .frm on export; form runtime renders/validates).
import { type AssetKindDef, slug } from '../types.ts';
export const def: AssetKindDef = {
  key: 'forms', label: 'Forms', nameField: 'name',
  seed: (name, fields) => ({
    id: slug(name),
    name,
    type: fields?.type || name,
    model: { className: fields?.['model.className'] || fields?.className || `com.acme.model.${name}` },
    fields: [
      { bind: 'amount', label: 'Claim Amount', widget: 'number', required: true, placeholder: 'Enter amount' },
      { bind: 'description', label: 'Description', widget: 'textarea', required: false, placeholder: 'Claim details' },
    ],
  }),
};
