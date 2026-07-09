// Example 19 — author a guided RULE TEMPLATE (a rule skeleton with {params} + a data grid), generate
// the Business Central .template, and execute it by EXPANDING into concrete rules and running the same
// rule engine. Engine model + runtime are fully verified; the .template XML is best-effort. See
// docs/bpm-assets/guided-rule-template/.
import { fromEngineProject, writeProject } from '../../dist/index.mjs';
import { expandTemplate } from '../functions/rule-template.mjs';
import { run } from '../functions/rule-engine.mjs';
import { isMain, outDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

export const TEMPLATE = {
  name: 'Tier pricing',
  when: [{ fact: 'Claim', as: 'c', where: { amount: { gte: '{min}' }, region: '{region}' } }],
  then: [{ set: 'c', fields: { tier: '{tier}' } }],
  // specific row (HIGH) LAST so it wins when both match (rows fire independently, later overrides)
  rows: [
    { min: 5000, region: 'US', tier: 'STANDARD' },
    { min: 100000, region: 'US', tier: 'HIGH' },
  ],
};

export function buildTemplateProject(dir) {
  const engine = {
    types: [{ name: 'Claim', fields: [{ name: 'amount', type: 'double' }, { name: 'region', type: 'string' }, { name: 'tier', type: 'string' }] }],
    guidedRuleTemplates: [TEMPLATE],
    processes: [{ id: 'p', name: 'p', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  };
  const project = fromEngineProject(engine);
  const written = writeProject(project, dir);
  return { project, written };
}

if (isMain(import.meta.url)) {
  const dir = outDir(import.meta.url, 'template');
  const { project, written } = buildTemplateProject(dir);
  printWritten('rule template project', dir, written);
  const tPath = Object.keys(project.descriptor.files).find((f) => f.endsWith('.template'));
  console.log(`\nGenerated ${tPath} (${project.descriptor.files[tPath].length} bytes)`);

  // runtime: expand the rows into concrete rules, then run the same rule engine
  const ruleset = expandTemplate(TEMPLATE);
  console.log('\nExpanded rules:', ruleset.rules.map((r) => r.name).join(', '));
  for (const amount of [250000, 8000, 100]) {
    const { facts } = run(ruleset, [{ _id: 'c', _type: 'Claim', amount, region: 'US', tier: '' }]);
    console.log(`  amount=${amount} -> tier=${JSON.stringify(facts[0].tier)}`);
  }
}
