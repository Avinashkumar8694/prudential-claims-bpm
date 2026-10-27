// Per-asset-kind definition. Each asset kind lives in its own folder (assets/<kind>/def.ts) with its
// label, the field that names an instance, and a seed() that creates a minimal new asset. The SDK
// exports these engine assets to real jBPM assets (.frm/.drl/.dmn/.gdst/.java/…).
export interface AssetKindDef {
  key: string;          // engine collection on EngineProject (forms, rulesets, decisions, …)
  label: string;
  nameField: string;    // which field holds the display name (e.g. 'name', 'group')
  seed: (name: string) => any;
}

export const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
