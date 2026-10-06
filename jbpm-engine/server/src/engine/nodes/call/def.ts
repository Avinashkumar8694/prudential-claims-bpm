import { type NodeDef, GENERAL } from '../def-types.ts';
// `independent` and the processRef picker's `workflowId` pin are ENGINE-ONLY additive fields —
// @fabrixly/bpmn-sdk's own EngineCall doesn't declare them, so they're not preserved on export to
// real jBPM BPMN2 XML (a re-imported process defaults to the normal wait-for-completion behavior).
export const def: NodeDef = {
  engineType: 'call',
  palette: [{ key: 'call', label: 'Call Activity', category: 'Sub-process', icon: '⇥', color: '#4f46e5', engineType: 'call', defaults: { type: 'call', process: '' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Called process', fields: [
    { key: 'process', label: 'Process', widget: 'processRef', placeholder: 'child-workflow.process', required: true, help: 'Resolved fresh, against every currently active deployment, at the moment this node actually runs (not at authoring time). If the id doesn\'t resolve, the node does NOT raise a catchable error — it silently returns outcome "called-process-not-deployed" and moves on. Deploy the target process before the instance reaches this node.' },
    { key: 'inputs', label: 'Inputs (childVar ← parentVar)', widget: 'keyval', keySource: 'called', valueSource: 'ownRef', help: 'Left = a variable declared on the called process. Right = "$name" to copy one of this process\'s own variables in, or a literal value.' },
    { key: 'outputs', label: 'Outputs (parentVar ← childVar)', widget: 'keyval', keySource: 'own', valueSource: 'called', help: 'Left = the variable to write on THIS process. Right = the variable to read from the called process once it completes. Only mapped back if the child actually reaches "completed" — if Independent (below) is checked, these outputs are silently skipped and never arrive.' },
    { key: 'independent', label: 'Independent (don’t wait)', widget: 'bool', help: 'Fire-and-forget: the parent continues immediately and the child keeps running standalone even after the parent completes or aborts.' },
  ] }],
  diagram: { icon: 'arrowRight', color: '#4f46e5', shape: 'rectangle' },
  typeLabel: 'Call activity',
};
