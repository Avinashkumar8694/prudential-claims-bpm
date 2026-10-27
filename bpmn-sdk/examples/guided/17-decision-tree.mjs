// Example 17 — author a guided DECISION TREE in the engine model (a recursive branch/leaf structure
// over one fact), generate the Business Central .gdt, and evaluate it on data. The runtime evaluator
// is the fully-verified part; the .gdt XML is best-effort. See docs/bpm-assets/guided-decision-tree/.
import { fromEngineProject, writeProject } from '../../dist/index.mjs';
import { evaluateDecisionTree } from '../functions/decision-tree.mjs';
import { isMain, outDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

export const TREE = {
  name: 'Claim triage',
  fact: 'Claim',
  root: {
    field: 'amount',
    branches: [
      { op: 'gt', value: 100000, then: [{ set: 'priority', value: 'HIGH' }] },
      { op: 'lte', value: 100000, then: {
        field: 'region',
        branches: [
          { op: 'eq', value: 'US', then: [{ set: 'priority', value: 'STANDARD' }] },
          { op: 'eq', value: 'EU', then: [{ set: 'priority', value: 'REVIEW' }] },
        ],
      } },
    ],
  },
};

export function buildTreeProject(dir) {
  const engine = {
    types: [{ name: 'Claim', fields: [{ name: 'amount', type: 'double' }, { name: 'region', type: 'string' }, { name: 'priority', type: 'string' }] }],
    decisionTrees: [TREE],
    processes: [{ id: 'triage', name: 'Triage', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  };
  const project = fromEngineProject(engine);
  const written = writeProject(project, dir);
  return { project, written };
}

if (isMain(import.meta.url)) {
  const dir = outDir(import.meta.url, 'tree');
  const { project, written } = buildTreeProject(dir);
  printWritten('decision tree project', dir, written);
  const gdtPath = Object.keys(project.descriptor.files).find((f) => f.endsWith('.gdt'));
  console.log(`\nGenerated ${gdtPath} (${project.descriptor.files[gdtPath].length} bytes)\n`);

  for (const claim of [
    { amount: 250000, region: 'US', priority: '' },
    { amount: 8000, region: 'EU', priority: '' },
    { amount: 5000, region: 'APAC', priority: '' },
  ]) {
    const { fact, path } = evaluateDecisionTree(TREE, claim);
    console.log(`in ${JSON.stringify(claim)}\n  path ${JSON.stringify(path)} -> ${JSON.stringify(fact)}`);
  }
}
