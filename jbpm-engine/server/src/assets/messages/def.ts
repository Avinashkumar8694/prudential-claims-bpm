// Message asset — named message for send/receive/throw/catch correlation.
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'messages', label: 'Messages', nameField: 'name',
  seed: (name) => ({ name }),
};
