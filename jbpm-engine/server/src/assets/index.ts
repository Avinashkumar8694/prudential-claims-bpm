// Asset registry — each asset kind lives in its own folder (assets/<kind>/def.ts). Add an asset kind
// = add a folder + register it here. Consumed by the assets module (list/add) and the SDK on export.
import type { AssetKindDef } from './types.ts';
import { def as forms } from './forms/def.ts';
import { def as rulesets } from './rulesets/def.ts';
import { def as decisions } from './decisions/def.ts';
import { def as guidedTables } from './guided-tables/def.ts';
import { def as decisionTrees } from './decision-trees/def.ts';
import { def as scorecards } from './scorecards/def.ts';
import { def as enumerations } from './enumerations/def.ts';
import { def as types } from './types-asset/def.ts';
import { def as messages } from './messages/def.ts';
import { def as tests } from './tests/def.ts';

export const ASSET_KINDS: AssetKindDef[] = [
  forms, rulesets, decisions, guidedTables, decisionTrees, scorecards, enumerations, types, messages, tests,
];
export const ASSET_DEFS: Record<string, AssetKindDef> = Object.fromEntries(ASSET_KINDS.map((d) => [d.key, d]));
export type { AssetKindDef } from './types.ts';
