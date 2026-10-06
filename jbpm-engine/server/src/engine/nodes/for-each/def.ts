import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'forEach',
  palette: [{ key: 'forEach', label: 'Multi-Instance', category: 'Sub-process', icon: '⇶', color: '#4f46e5', engineType: 'forEach', defaults: { type: 'forEach', process: '', over: '' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Multi-instance', fields: [
    { key: 'process', label: 'Process', widget: 'processRef', required: true, help: 'Run once per item, resolved fresh each time this node runs against every currently active deployment. If the id doesn\'t resolve, the node silently no-ops with outcome "mi-process-not-deployed" — no error, no items collected.' },
    { key: 'over', label: 'Collection variable', widget: 'varRef', varSource: 'own', placeholder: 'applicablePolicies', required: true, help: 'One of this process\'s own variables, holding the array to iterate. Must already be a populated array when this node runs — if missing, not an array, or empty, this node silently runs zero iterations.' },
    { key: 'as', label: 'Item variable', widget: 'text', placeholder: 'currentPolicy', required: true, help: 'New variable name on the CHILD process, set to the current item on each run. Without this the child can\'t tell which item it\'s processing.' },
    { key: 'collectInto', label: 'Collect results into', widget: 'varRef', varSource: 'own', help: 'This process\'s variable to collect every child\'s item result into, as an array.' },
    { key: 'itemResult', label: 'Item result variable', widget: 'varRef', varSource: 'called', help: 'Which variable on the CHILD process holds its one result — read back into "Collect results into" above.' },
    { key: 'parallel', label: 'Run in parallel', widget: 'bool', help: 'Off (default, sequential): starts each item\'s child only after the previous one settles; a failing item stops the loop immediately. On (parallel): every item\'s child starts at once — a failing item is only discovered once ALL items have settled.' },
    { key: 'pass', label: 'Pass-through variables', widget: 'stringlist', varSource: 'own', help: 'This process\'s own variables to copy into every child run unchanged. If a name here matches "Item variable" (as), the current item silently overwrites it.' },
  ] }],
  diagram: { icon: 'projects', color: '#4f46e5', shape: 'rectangle' },
  typeLabel: 'Multi-instance',
};
