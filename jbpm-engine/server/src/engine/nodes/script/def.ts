import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'script',
  palette: [{ key: 'script', label: 'Script Task', category: 'Tasks', icon: '{ }', color: '#0891b2', engineType: 'script', defaults: { type: 'script', lang: 'js', code: '' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Script', fields: [
    { key: 'lang', label: 'Language', widget: 'select', options: ['js', 'java'], help: 'js runs natively; java runs in the JVM sidecar and dry-compiles at publish time. Any other dialect (e.g. mvel) is not implemented — the node would silently no-op.' },
    { key: 'code', label: 'Script body', widget: 'code', placeholder: 'kcontext.setVariable("x", 1);', required: true, help: 'Runs against kcontext (getVariable/setVariable) in a sandboxed VM with a wall-clock timeout; a thrown error or timeout fails the node with SCRIPT_ERROR, catchable by a Boundary/error-catch. console.log output is captured into this node\'s history entry.' },
  ] }],
  diagram: { icon: 'code', color: '#0891b2', shape: 'rectangle' },
  typeLabel: 'Script task',
};
