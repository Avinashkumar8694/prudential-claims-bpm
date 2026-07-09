// Form asset — task/start form (SDK form model → .frm on export; form runtime renders/validates).
import { type AssetKindDef, slug } from '../types.ts';
export const def: AssetKindDef = {
  key: 'forms', label: 'Forms', nameField: 'name',
  seed: (name) => ({ id: slug(name), name, model: { className: '' }, fields: [] }),
};
