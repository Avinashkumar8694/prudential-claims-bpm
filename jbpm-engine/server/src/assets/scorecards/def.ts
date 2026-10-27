// Scorecard asset — additive scoring over characteristics (SDK → .scgd).
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'scorecards', label: 'Scorecards', nameField: 'name',
  seed: (name) => ({ name, fact: '', baseline: 0, target: 'score', characteristics: [] }),
};
