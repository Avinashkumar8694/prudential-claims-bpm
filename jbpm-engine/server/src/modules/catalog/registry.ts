// Node registry — the single catalog that drives the UI palette, canvas rendering, and property forms.
// Mirrors the SDK node set and docs/bpm-nodes. `schemaRef` points at the per-node JSON Schema doc.
import type { EngineNode } from '../../sdk/index.js';

export type NodeCategory = 'Events' | 'Tasks' | 'Gateways' | 'Sub-process' | 'Data';

export interface NodeSpec {
  key: string;
  label: string;
  category: NodeCategory;
  icon: string;      // emoji placeholder; app maps to its icon set
  color: string;     // icon chip background (matches reference palette)
  engineType: EngineNode['type'];
  defaults: Record<string, unknown>;
  docFolder: string; // docs/bpm-nodes/<docFolder>
}

export const NODE_REGISTRY: NodeSpec[] = [
  // Events
  { key: 'start', label: 'Start', category: 'Events', icon: '▶', color: '#16a34a', engineType: 'start', defaults: { type: 'start', name: 'Start' }, docFolder: 'start-event-none' },
  { key: 'start-signal', label: 'Start (Signal)', category: 'Events', icon: '📡', color: '#16a34a', engineType: 'start', defaults: { type: 'start', on: { signal: 'Start' } }, docFolder: 'start-event-signal' },
  { key: 'end', label: 'End', category: 'Events', icon: '⏹', color: '#dc2626', engineType: 'end', defaults: { type: 'end', name: 'End' }, docFolder: 'end-event-none' },
  { key: 'end-terminate', label: 'End (Terminate)', category: 'Events', icon: '⛔', color: '#dc2626', engineType: 'end', defaults: { type: 'end', result: 'terminate' }, docFolder: 'end-event-terminate' },
  { key: 'catch-timer', label: 'Timer', category: 'Events', icon: '⏱', color: '#7c3aed', engineType: 'catch', defaults: { type: 'catch', event: { timer: { duration: 'PT5M' } } }, docFolder: 'intermediate-catch-timer' },
  { key: 'catch-message', label: 'Catch Message', category: 'Events', icon: '✉', color: '#7c3aed', engineType: 'catch', defaults: { type: 'catch', event: { message: 'Msg' } }, docFolder: 'event-message' },
  { key: 'throw-signal', label: 'Throw Signal', category: 'Events', icon: '📣', color: '#7c3aed', engineType: 'throw', defaults: { type: 'throw', event: { signal: 'Go' } }, docFolder: 'intermediate-throw-event' },
  { key: 'boundary-timer', label: 'Boundary Timer', category: 'Events', icon: '⏰', color: '#7c3aed', engineType: 'boundary', defaults: { type: 'boundary', on: '', event: { timer: { duration: 'P1D' } }, interrupting: false }, docFolder: 'boundary-event-timer' },
  { key: 'boundary-error', label: 'Boundary Error', category: 'Events', icon: '⚠', color: '#7c3aed', engineType: 'boundary', defaults: { type: 'boundary', on: '', event: { error: 'ERR' }, interrupting: true }, docFolder: 'boundary-event-error' },

  // Tasks
  { key: 'userTask', label: 'User Task', category: 'Tasks', icon: '👤', color: '#2563eb', engineType: 'userTask', defaults: { type: 'userTask', name: 'User Task', group: 'user' }, docFolder: 'user-task' },
  { key: 'script', label: 'Script Task', category: 'Tasks', icon: '{ }', color: '#0891b2', engineType: 'script', defaults: { type: 'script', lang: 'js', code: '' }, docFolder: 'script-task' },
  { key: 'http', label: 'Service Task (REST)', category: 'Tasks', icon: '🌐', color: '#0d9488', engineType: 'http', defaults: { type: 'http', method: 'POST', url: '/' }, docFolder: 'service-task-rest' },
  { key: 'rule', label: 'Business Rule', category: 'Tasks', icon: '📐', color: '#ea580c', engineType: 'rule', defaults: { type: 'rule', ruleflowGroup: 'group' }, docFolder: 'business-rule-task' },
  { key: 'send', label: 'Send Task', category: 'Tasks', icon: '📤', color: '#16a34a', engineType: 'send', defaults: { type: 'send', message: 'Msg' }, docFolder: 'send-task' },
  { key: 'receive', label: 'Receive Task', category: 'Tasks', icon: '📥', color: '#16a34a', engineType: 'receive', defaults: { type: 'receive', message: 'Msg' }, docFolder: 'receive-task' },
  { key: 'manual', label: 'Manual Task', category: 'Tasks', icon: '✋', color: '#64748b', engineType: 'manual', defaults: { type: 'manual', name: 'Manual Task' }, docFolder: 'manual-task' },

  // Gateways
  { key: 'gw-exclusive', label: 'Exclusive Gateway', category: 'Gateways', icon: '✕', color: '#f59e0b', engineType: 'gateway', defaults: { type: 'gateway', mode: 'exclusive' }, docFolder: 'exclusive-gateway' },
  { key: 'gw-parallel', label: 'Parallel Gateway', category: 'Gateways', icon: '＋', color: '#f59e0b', engineType: 'gateway', defaults: { type: 'gateway', mode: 'parallel' }, docFolder: 'parallel-gateway' },
  { key: 'gw-inclusive', label: 'Inclusive Gateway', category: 'Gateways', icon: '○', color: '#f59e0b', engineType: 'gateway', defaults: { type: 'gateway', mode: 'inclusive' }, docFolder: 'inclusive-gateway' },
  { key: 'gw-event', label: 'Event Gateway', category: 'Gateways', icon: '◇', color: '#f59e0b', engineType: 'gateway', defaults: { type: 'gateway', mode: 'event' }, docFolder: 'event-based-gateway' },

  // Sub-process
  { key: 'call', label: 'Call Activity', category: 'Sub-process', icon: '⇥', color: '#4f46e5', engineType: 'call', defaults: { type: 'call', process: '' }, docFolder: 'call-activity' },
  { key: 'forEach', label: 'Multi-Instance', category: 'Sub-process', icon: '⇶', color: '#4f46e5', engineType: 'forEach', defaults: { type: 'forEach', process: '', over: 'items' }, docFolder: 'call-activity-multi-instance' },
  { key: 'subprocess', label: 'Sub-process', category: 'Sub-process', icon: '▭', color: '#4f46e5', engineType: 'subprocess', defaults: { type: 'subprocess', nodes: [], flows: [] }, docFolder: 'subprocess-embedded' },

  // Data
  { key: 'data', label: 'Data Object', category: 'Data', icon: '🗎', color: '#2563eb', engineType: 'raw', defaults: {}, docFolder: 'data-object' },
];

export const CATEGORIES: NodeCategory[] = ['Events', 'Tasks', 'Gateways', 'Sub-process', 'Data'];
