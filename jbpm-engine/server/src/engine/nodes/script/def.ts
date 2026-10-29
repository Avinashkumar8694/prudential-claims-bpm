import { type NodeDef, GENERAL } from '../def-types.ts';

export const def: NodeDef = {
  engineType: 'script',
  palette: [{ key: 'script', label: 'Script Task', category: 'Tasks', icon: '{ }', color: '#0891b2', engineType: 'script', defaults: { type: 'script', lang: 'js', code: '' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Script (JavaScript / Java)', fields: [
    { key: 'lang', label: 'Language dialect', widget: 'select', options: ['js', 'java'], help: 'JavaScript executes in isolated Node.js VM; Java executes in JVM sidecar.' },
    { key: 'code', label: 'Script body', widget: 'code', placeholder: 'kcontext.setVariable("x", 1);', help: 'Runs against kcontext (getVariable/setVariable).' },
  ] }],
  diagram: { icon: 'code', color: '#0891b2', shape: 'rectangle' },
  typeLabel: 'Script task',
  docs: {
    summary: 'Executes synchronous JavaScript or Java 8 code against kcontext to transform process variables.',
    purpose: 'Provides sandboxed procedural logic execution. Accesses and mutates instance variables via kcontext.getVariable() and kcontext.setVariable().',
    whenToUse: [
      'Use for synchronous data transformations, string formatting, and mathematical computations.',
      'Use for parsing and reshaping payloads before external API calls.',
      'Use Java dialect to migrate legacy jBPM / Drools scripts without rewriting.',
    ],
    whenNotToUse: [
      'Do not perform outbound network or database calls in a script (use Service Task).',
      'Do not run long-running CPU loops; bounded by scriptTimeoutSeconds.',
    ],
    scenarios: [
      {
        title: 'JavaScript Data Transformation',
        description: 'Calculates derived values and formats variables natively in Node.js VM.',
        whenToUse: 'General data mapping and arithmetic calculations.',
        exampleJson: { id: 'script_1', name: 'Calculate Total', type: 'script', lang: 'js', code: 'const val = kcontext.getVariable("amount") || 0;\nkcontext.setVariable("tax", val * 0.18);' },
      },
      {
        title: 'Legacy jBPM Java Execution',
        description: 'Runs real Java 8 bytecode via the JVM sidecar with full standard library support.',
        whenToUse: 'Migrating legacy Java rules and scripts.',
        exampleJson: { id: 'script_java', name: 'Java Script', type: 'script', lang: 'java', code: 'String s = (String) kcontext.getVariable("input");\nkcontext.setVariable("output", s.toUpperCase());' },
      },
    ],
    fields: [
      { key: 'name', label: 'Name', type: 'string', default: 'Script Task', required: true, description: 'Display name rendered on diagram.' },
      { key: 'lang', label: 'Language', type: 'select', options: ['js', 'java'], default: 'js', required: false, description: 'Execution dialect: js (Node VM) or java (JVM sidecar).' },
      { key: 'code', label: 'Script Code', type: 'string', required: true, description: 'Script statements to execute.' },
    ],
    gotchas: [
      'Scripts run synchronously in the token path and are subject to the system setting scriptTimeoutSeconds.',
      'Spawning threads or accessing Node.js process / fs internals is blocked by the security sandbox.',
    ],
  },
};
