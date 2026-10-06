// Mirrors @fabrixly/bpmn-sdk's engine model + server/src/engine/nodes/def-types.ts. The frontend never
// enforces the per-type field shape strictly (that's the backend's job at publish-time validation) —
// here every node is just `{id, type, name?, x?, y?, ...rest}` so the canvas can render and edit any
// of the 17 real types uniformly, reading/writing the type-specific fields the node-defs schema names.
export interface EngineVar { name: string; type: string; }
export interface EngineFlow { id?: string; from: string; to: string; when?: string; lang?: string; }

export interface EngineNode {
  id: string; type: string; name?: string;
  x?: number; y?: number;
  [key: string]: unknown;
}

export interface EngineProcess {
  id: string; name?: string; package?: string;
  vars?: EngineVar[];
  nodes: EngineNode[]; flows: EngineFlow[];
}

export interface EngineBundle { id: string; name: string; processes: EngineProcess[]; }

// ---- node catalog (GET /api/node-defs) ----
export type Widget =
  | 'text' | 'number' | 'bool' | 'select' | 'code' | 'textarea'
  | 'keyval' | 'stringlist' | 'event' | 'timer' | 'nodes' | 'assetRef' | 'processRef' | 'varRef' | 'eventSubError';

export interface UiField {
  key: string; label: string; widget: Widget; options?: string[]; placeholder?: string; help?: string;
  assetKind?: string; required?: boolean;
}
export interface UiSection { title: string; fields: UiField[]; }
export interface PaletteEntry {
  key: string; label: string; category: string; icon: string; color: string;
  engineType: string; defaults: Record<string, unknown>;
}
export interface Ports { maxIn?: number; maxOut?: number; }
export interface NodeDef {
  engineType: string; palette: PaletteEntry[]; ports: Ports; schema: UiSection[];
  diagram: { icon: string; color: string; shape: 'circle' | 'diamond' | 'rectangle' };
  typeLabel: string;
}
export interface NodeCatalog { categories: string[]; defs: NodeDef[]; }
