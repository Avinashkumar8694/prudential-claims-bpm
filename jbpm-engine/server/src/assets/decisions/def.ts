// DMN decision model asset — decision tables (SDK → .dmn; dmn-engine evaluates at runtime).
import { type AssetKindDef, slug } from '../types.ts';
export const def: AssetKindDef = {
  key: 'decisions', label: 'DMN decisions', nameField: 'name',
  seed: (name) => ({ name, namespace: `https://kie.org/dmn/${slug(name)}`, decisions: [{ name, hitPolicy: 'UNIQUE', inputs: [], outputs: [], rules: [] }] }),
};
