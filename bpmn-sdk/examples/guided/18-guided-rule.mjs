// Example 18 — author a guided RULE in the engine model (one rule, same when/then as a DRL ruleset
// rule), generate the Business Central .rdrl, and execute it with the SAME rule engine. The engine
// model + runtime are fully verified; the .rdrl XML is best-effort. See docs/bpm-assets/guided-rule/.
import { fromEngineProject, writeProject } from '../../dist/index.mjs';
import { run } from '../functions/rule-engine.mjs';
import { isMain, outDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

export const RULE = {
  name: 'High value open claim',
  when: [{ fact: 'Claim', as: 'c', where: { amount: { gt: 100000 }, status: 'OPEN' } }],
  then: [{ set: 'c', fields: { priority: 'HIGH' } }],
};

export function buildGuidedRuleProject(dir) {
  const engine = {
    types: [{ name: 'Claim', fields: [{ name: 'amount', type: 'double' }, { name: 'status', type: 'string' }, { name: 'priority', type: 'string' }] }],
    guidedRules: [RULE],
    processes: [{ id: 'p', name: 'p', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  };
  const project = fromEngineProject(engine);
  const written = writeProject(project, dir);
  return { project, written };
}

if (isMain(import.meta.url)) {
  const dir = outDir(import.meta.url, 'guided-rule');
  const { project, written } = buildGuidedRuleProject(dir);
  printWritten('guided rule project', dir, written);
  const rdrlPath = Object.keys(project.descriptor.files).find((f) => f.endsWith('.rdrl'));
  console.log(`\nGenerated ${rdrlPath} (${project.descriptor.files[rdrlPath].length} bytes)\n`);

  // runtime: a guided rule IS a rule — the same engine executes it (wrap as a one-rule ruleset)
  const ruleset = { rules: [{ name: RULE.name, when: RULE.when, then: RULE.then }] };
  for (const claim of [
    { _id: 'c1', _type: 'Claim', amount: 250000, status: 'OPEN', priority: '' },
    { _id: 'c2', _type: 'Claim', amount: 250000, status: 'CLOSED', priority: '' },
  ]) {
    const { facts, trace } = run(ruleset, [claim]);
    console.log(`in ${JSON.stringify(claim)}\n  fired ${JSON.stringify(trace)} -> priority=${JSON.stringify(facts[0].priority)}`);
  }
}
