// Complete per-node property schema — every configurable field the engine model / SDK supports for
// each node type (mirrors docs/bpm-nodes/*/node_properties.md). Drives the generic Properties panel so
// nothing is missing for full configuration. jBPM detail (FQNs, XML, ruleflow wiring) is synthesized
// by the SDK; here we expose the clean, complete authoring surface.

export type Widget =
  | 'text' | 'number' | 'bool' | 'select' | 'code' | 'textarea'
  | 'keyval' | 'stringlist' | 'event' | 'timer' | 'nodes';

export interface Field {
  key: string;                 // supports dotted paths, e.g. "on.signal", "dmn.namespace"
  label: string;
  widget: Widget;
  options?: string[];          // for select; for 'event' = allowed trigger kinds
  placeholder?: string;
  help?: string;
}
export interface Section { title: string; fields: Field[]; }

const GENERAL: Section = { title: 'General', fields: [
  { key: 'name', label: 'Name', widget: 'text' },
  { key: 'documentation', label: 'Documentation', widget: 'textarea', placeholder: 'Notes for this node' },
] };

export const NODE_SCHEMA: Record<string, Section[]> = {
  start: [GENERAL, { title: 'Trigger', fields: [
    { key: 'on', label: 'Start trigger', widget: 'event', options: ['none', 'signal', 'message', 'timer', 'condition'], help: 'How instances of this process are started' },
  ] }],

  end: [GENERAL, { title: 'End behavior', fields: [
    { key: 'result', label: 'Result', widget: 'select', options: ['(normal)', 'terminate'], help: 'terminate cancels all other tokens and ends the whole instance' },
    { key: 'throw', label: 'Throw event', widget: 'event', options: ['none', 'signal', 'error', 'escalation', 'message'] },
  ] }],

  script: [GENERAL, { title: 'Script (JavaScript)', fields: [
    { key: 'code', label: 'Script body', widget: 'code', placeholder: 'kcontext.setVariable("x", 1);', help: 'Runs as JavaScript against kcontext (getVariable/setVariable).' },
  ] }],

  http: [GENERAL, { title: 'Request', fields: [
    { key: 'method', label: 'Method', widget: 'select', options: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] },
    { key: 'url', label: 'URL (appended to base)', widget: 'text', placeholder: '/v1/claims' },
    { key: 'headers', label: 'Headers', widget: 'keyval' },
    { key: 'body', label: 'Body (value or $var)', widget: 'keyval' },
  ] }, { title: 'Response', fields: [
    { key: 'resultTo', label: 'Map response → variable (var ← JSONPath)', widget: 'keyval', help: 'e.g. verifierId ← $.verifierId' },
  ] }],

  call: [GENERAL, { title: 'Called process', fields: [
    { key: 'process', label: 'Process id / key', widget: 'text', placeholder: 'child-workflow.process' },
    { key: 'inputs', label: 'Inputs (childVar ← $parentVar or value)', widget: 'keyval' },
    { key: 'outputs', label: 'Outputs (parentVar ← childVar)', widget: 'keyval' },
    { key: 'independent', label: 'Independent (don’t wait)', widget: 'bool' },
  ] }],

  forEach: [GENERAL, { title: 'Multi-instance', fields: [
    { key: 'process', label: 'Process id / key', widget: 'text' },
    { key: 'over', label: 'Collection variable', widget: 'text', placeholder: 'applicablePolicies' },
    { key: 'as', label: 'Item variable', widget: 'text', placeholder: 'currentPolicy' },
    { key: 'collectInto', label: 'Collect results into', widget: 'text' },
    { key: 'itemResult', label: 'Item result variable', widget: 'text' },
    { key: 'parallel', label: 'Run in parallel', widget: 'bool' },
    { key: 'pass', label: 'Pass-through variables', widget: 'stringlist' },
  ] }],

  userTask: [GENERAL, { title: 'Assignment', fields: [
    { key: 'group', label: 'Group / role', widget: 'text', placeholder: 'examiners' },
    { key: 'assignee', label: 'Assignee (specific user)', widget: 'text' },
    { key: 'businessAdmin', label: 'Business administrator', widget: 'text' },
    { key: 'excludedOwners', label: 'Excluded owners', widget: 'stringlist' },
  ] }, { title: 'Form & behavior', fields: [
    { key: 'form', label: 'Form name', widget: 'text' },
    { key: 'priority', label: 'Priority', widget: 'number' },
    { key: 'dueDate', label: 'Due date / SLA', widget: 'text', placeholder: 'PT8H or 2026-01-01' },
    { key: 'skippable', label: 'Skippable', widget: 'bool' },
    { key: 'description', label: 'Task description', widget: 'textarea' },
  ] }, { title: 'Data', fields: [
    { key: 'inputs', label: 'Task inputs (taskVar ← $processVar)', widget: 'keyval' },
    { key: 'outputs', label: 'Task outputs (processVar ← taskVar)', widget: 'keyval' },
  ] }],

  rule: [GENERAL, { title: 'DRL rules', fields: [
    { key: 'ruleflowGroup', label: 'Ruleflow group', widget: 'text', placeholder: 'classify' },
  ] }, { title: 'DMN (alternative)', fields: [
    { key: 'dmn.namespace', label: 'DMN namespace', widget: 'text' },
    { key: 'dmn.model', label: 'DMN model name', widget: 'text' },
    { key: 'dmn.decision', label: 'Decision name', widget: 'text' },
  ] }],

  send: [GENERAL, { title: 'Message', fields: [
    { key: 'message', label: 'Message name', widget: 'text' },
    { key: 'implementation', label: 'Implementation', widget: 'select', options: ['##WebService', 'Other'] },
  ] }],
  receive: [GENERAL, { title: 'Message', fields: [
    { key: 'message', label: 'Message name', widget: 'text' },
    { key: 'implementation', label: 'Implementation', widget: 'select', options: ['##WebService', 'Other'] },
  ] }],

  manual: [GENERAL],

  gateway: [GENERAL, { title: 'Gateway', fields: [
    { key: 'mode', label: 'Mode', widget: 'select', options: ['exclusive', 'parallel', 'inclusive', 'event', 'complex'] },
    { key: 'direction', label: 'Direction', widget: 'select', options: ['Diverging', 'Converging'] },
    { key: 'default', label: 'Default flow id', widget: 'text', help: 'Taken when no condition matches (exclusive/inclusive)' },
  ] }],

  catch: [GENERAL, { title: 'Event', fields: [
    { key: 'event', label: 'Catch', widget: 'event', options: ['timer', 'message', 'signal', 'condition'] },
  ] }],
  throw: [GENERAL, { title: 'Event', fields: [
    { key: 'event', label: 'Throw', widget: 'event', options: ['signal', 'message', 'escalation'] },
  ] }],

  boundary: [GENERAL, { title: 'Error / boundary catch', fields: [
    { key: 'on', label: 'Catch from', widget: 'nodes', help: 'Pick node(s) to catch (boundary), or “All nodes” for a process-wide handler. Connect this node’s outgoing flow to the recovery path.' },
    { key: 'event', label: 'Trigger', widget: 'event', options: ['error', 'timer', 'message', 'signal', 'escalation', 'condition'] },
    { key: 'interrupting', label: 'Interrupting (cancel the caught activity)', widget: 'bool' },
  ] }],

  subprocess: [GENERAL, { title: 'Sub-process', fields: [
    { key: 'transaction', label: 'Transaction', widget: 'bool' },
    { key: 'on.error', label: 'Event sub-process on error', widget: 'text', help: 'Error code that triggers this as an event sub-process' },
  ] }],
};
