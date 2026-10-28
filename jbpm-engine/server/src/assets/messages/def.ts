// Message asset — named message for send/receive/throw/catch correlation.
import { type AssetKindDef } from '../types.ts';
export const def: AssetKindDef = {
  key: 'messages', label: 'Messages', nameField: 'name',
  seed: (name, fields) => ({
    name,
    dataType: fields?.dataType || 'Object',
    correlationKey: fields?.correlationKey || 'correlationId',
    description: fields?.description || `Message contract for ${name}`,
  }),
};
