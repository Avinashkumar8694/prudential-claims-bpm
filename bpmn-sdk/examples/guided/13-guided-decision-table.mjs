// Example 13 — author a Business Central GUIDED decision table in the engine model, convert to a jBPM
// kjar, and evaluate it on data. You write a tabular ruleset (fact + condition columns + action
// columns + rows); fromEngineProject synthesizes the decision-table52 XML (which compiles to DRL in
// Business Central). At runtime it behaves as a tabular ruleset. See docs/bpm-assets/guided-decision-table/.
import { fromEngineProject, writeProject } from '../../dist/index.mjs';
import { evaluateGuidedTable } from '../functions/guided-table.mjs';
import { isMain, outDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

export const TABLE = {
  name: 'Claim classification',
  fact: 'Claim',                 // references the declared `Claim` type; column types come from its fields
  conditions: [                  // columns need only field + op — the `type` is derived from Claim
    { field: 'amount', op: 'gt' },
    { field: 'region', op: 'eq' },
  ],
  actions: [
    { field: 'status' },
    { field: 'priority' },
  ],
  // rows fire top-to-bottom; a later matching row overrides earlier action cells, so the more specific
  // row (HIGH) goes LAST to win when it applies. (Or make rows mutually exclusive.)
  rows: [
    { when: { amount: 5000 },                  then: { status: 'STANDARD', priority: 'P3' } },
    { when: { amount: 100000, region: 'US' }, then: { status: 'HIGH', priority: 'P1' } },
  ],
};

export function buildGuidedProject(dir) {
  // Nothing here is jBPM-shaped: `id`/`name` are plain identifiers, and there's NO `package` — the SDK
  // defaults the generated Java packages. Set `package` only if you care what those packages are named.
  const engine = {
    types: [{ name: 'Claim', fields: [
      { name: 'amount', type: 'double' }, { name: 'region', type: 'string' },
      { name: 'status', type: 'string' }, { name: 'priority', type: 'string' },
    ] }],
    guidedTables: [TABLE],
    processes: [{
      id: 'classify-claims', name: 'Classify claims',
      nodes: [{ id: 's', type: 'start' }, { id: 'r', type: 'rule', name: 'Classify', ruleflowGroup: 'Claim classification' }, { id: 'e', type: 'end' }],
      flows: [{ from: 's', to: 'r' }, { from: 'r', to: 'e' }],
    }],
  };
  const project = fromEngineProject(engine);
  const written = writeProject(project, dir);
  return { project, written };
}

if (isMain(import.meta.url)) {
  const dir = outDir(import.meta.url, 'guided');
  const { project, written } = buildGuidedProject(dir);
  printWritten('guided decision table project', dir, written);
  const gdstPath = Object.keys(project.descriptor.files).find((f) => f.endsWith('.gdst'));
  console.log(`\nGenerated ${gdstPath} (${project.descriptor.files[gdstPath].length} bytes)\n`);

  // runtime: apply the table to sample facts
  for (const claim of [
    { amount: 250000, region: 'US', status: 'NEW', priority: '' },
    { amount: 8000, region: 'EU', status: 'NEW', priority: '' },
    { amount: 100, region: 'US', status: 'NEW', priority: '' },
  ]) {
    const { fact, fired } = evaluateGuidedTable(TABLE, claim);
    console.log(`in ${JSON.stringify(claim)}\n  fired rows ${JSON.stringify(fired)} -> ${JSON.stringify(fact)}`);
  }
}
