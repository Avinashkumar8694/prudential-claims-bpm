// UI config that lives next to each node's backend handler. A node folder holds:
//   def.ts     — palette entries + property schema (what the UI shows)
//   handler.ts — the backend runtime logic (what the engine runs)
// The catalog endpoint serves these defs to the app; the engine dispatches to the handlers.
export type Widget =
  | 'text' | 'number' | 'bool' | 'select' | 'code' | 'textarea'
  | 'keyval' | 'stringlist' | 'event' | 'timer' | 'nodes';

export interface UiField { key: string; label: string; widget: Widget; options?: string[]; placeholder?: string; help?: string; }
export interface UiSection { title: string; fields: UiField[]; }

export interface PaletteEntry {
  key: string; label: string; category: string; icon: string; color: string;
  engineType: string; defaults: Record<string, unknown>;
}

/** Connection points a node exposes (self-contained BPMN wiring rules). */
export interface Ports {
  in: boolean;    // accepts an incoming sequence flow (target) — false for start & boundary
  out: boolean;   // has an outgoing sequence flow (source) — false for end
}

export interface NodeDef {
  engineType: string;      // the EngineNode.type this folder implements
  palette: PaletteEntry[]; // one or more palette tiles that create this node type
  ports: Ports;            // which connection points this node has (drives UI ports + validation)
  schema: UiSection[];     // the properties panel form
}

export const CATEGORIES = ['Events', 'Tasks', 'Gateways', 'Sub-process', 'Data'];

// shared "General" section reused by every node's schema
export const GENERAL: UiSection = { title: 'General', fields: [
  { key: 'name', label: 'Name', widget: 'text' },
  { key: 'documentation', label: 'Documentation', widget: 'textarea', placeholder: 'Notes for this node' },
] };
