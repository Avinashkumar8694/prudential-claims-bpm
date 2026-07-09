// Guided decision tree asset (SDK → .gdt).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'decisionTrees', label: 'Decision trees', nameField: 'name',
  seed: (name) => ({ name, fact: '', root: null }),
};
