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

/** How many connections a node accepts on each side (self-contained BPMN wiring rule).
 *  maxIn/maxOut: 0 = none, a number = that many, undefined = unlimited (gateways).
 *  A node has an input port when maxIn !== 0, and an output port when maxOut !== 0. */
export interface Ports { maxIn?: number; maxOut?: number; }

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
