// UI config that lives next to each node's backend handler. A node folder holds:
//   def.ts     — palette entries + property schema (what the UI shows)
//   handler.ts — the backend runtime logic (what the engine runs)
//   index.ts   — self-registers both with the factory (see factory.ts)
// The catalog endpoint serves these defs to the app; the engine dispatches to the handlers.
export type Widget =
  | 'text' | 'number' | 'bool' | 'select' | 'code' | 'textarea'
  | 'keyval' | 'stringlist' | 'event' | 'timer' | 'nodes' | 'assetRef' | 'processRef' | 'varRef'
  /** subprocess's `on.error` field only — a plain text input that ALSO writes the same code onto the
   *  node's own inner Error Start node, so the two locations this engine and @fabrixly/bpmn-sdk's
   *  real-BPMN2 import/export both care about never drift apart. */
  | 'eventSubError';

export type VarSource = 'own' | 'ownRef' | 'called';

export interface UiField {
  key: string; label: string; widget: Widget; options?: string[]; placeholder?: string; help?: string;
  assetKind?: string; varSource?: VarSource; keySource?: VarSource; valueSource?: VarSource;
  /** Purely a UI hint (renders a "*" next to the label) — never itself enforces anything. Set this on
   *  a field only when validation/rules.ts's own rules already block publish when it's empty. */
  required?: boolean;
}
export interface UiSection { title: string; fields: UiField[]; }

export interface PaletteEntry {
  key: string; label: string; category: string; icon: string; color: string;
  engineType: string; defaults: Record<string, unknown>;
}

export interface Ports { maxIn?: number; maxOut?: number; }

export interface NodeDef {
  engineType: string;
  palette: PaletteEntry[];
  ports: Ports;
  schema: UiSection[];
  diagram: { icon: string; color: string; shape: 'circle' | 'diamond' | 'rectangle' };
  typeLabel: string;
}

export const CATEGORIES = ['Events', 'Tasks', 'Gateways', 'Sub-process', 'Data'];

// shared "General" section reused by every node's schema. onEntry/onExit are generic action hooks
// available on virtually every node type — execution-engine.ts's handle()/runLifecycle() runs them
// unconditionally for every node type (including handler-less ones like boundary).
export const GENERAL: UiSection = { title: 'General', fields: [
  { key: 'name', label: 'Name', widget: 'text', help: 'Shown in run history, audit log, and diagrams; also readable inside this node\'s own scripts/conditions via kcontext (nodeName).' },
  { key: 'documentation', label: 'Documentation', widget: 'textarea', placeholder: 'Notes for this node' },
  { key: 'onEntry', label: 'On-entry action', widget: 'code', placeholder: 'kcontext.setVariable("x", 1);', help: 'Runs the moment this node is entered, before its own normal behavior — same kcontext surface as a Script task.' },
  { key: 'onEntryLang', label: 'On-entry language', widget: 'select', options: ['js', 'java'], help: 'Which dialect the action above runs as. Any value other than js/java is skipped, same as a Script task\'s own Language field.' },
  { key: 'onExit', label: 'On-exit action', widget: 'code', placeholder: 'kcontext.setVariable("y", 2);', help: 'Runs once this node actually completes (after any wait is over) — never on an error/abort path.' },
  { key: 'onExitLang', label: 'On-exit language', widget: 'select', options: ['js', 'java'], help: 'Which dialect the action above runs as. Any value other than js/java is skipped, same as a Script task\'s own Language field.' },
] };
