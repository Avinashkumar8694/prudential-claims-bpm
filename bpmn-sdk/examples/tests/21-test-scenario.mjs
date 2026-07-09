// Example 21 — author test cases in the engine model, RUN them in Node against the decision they
// target (real pass/fail — this is your test harness), AND generate the jBPM .scesim. Test scenarios
// verify a decision/rule, not the process flow. See docs/bpm-assets/test-scenario/.
import { fromEngineProject, writeProject } from '../../dist/index.mjs';
import { evaluateDecision } from '../functions/dmn-engine.mjs';
import { runScenarios } from '../functions/test-scenario.mjs';
import { isMain, outDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

// the decision under test (a DMN decision table)
export const DECISION = {
  name: 'Eligibility', hitPolicy: 'UNIQUE',
  inputs: [{ name: 'amount', type: 'number' }],
  outputs: [{ name: 'tier', type: 'string' }],
  rules: [
    { when: { amount: { gt: 100000 } }, then: { tier: 'HIGH' } },
    { when: { amount: { between: [1, 100000] } }, then: { tier: 'STANDARD' } },
    { when: { amount: { lte: 0 } }, then: { tier: 'NONE' } },
  ],
};

// the test suite: pinned given -> expected outputs
export const SUITE = {
  name: 'Eligibility',
  target: 'Eligibility',
  cases: [
    { name: 'high value', given: { amount: 250000 }, expect: { tier: 'HIGH' } },
    { name: 'standard', given: { amount: 3000 }, expect: { tier: 'STANDARD' } },
    { name: 'zero (edge)', given: { amount: 0 }, expect: { tier: 'NONE' } },
  ],
};

export function buildTestProject(dir) {
  const engine = {
    decisions: [{ name: 'ClaimDecisions', decisions: [DECISION] }],
    tests: [SUITE],
    processes: [{ id: 'p', name: 'p', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  };
  const project = fromEngineProject(engine);
  const written = writeProject(project, dir);
  return { project, written };
}

if (isMain(import.meta.url)) {
  const dir = outDir(import.meta.url, 'tests');
  const { project, written } = buildTestProject(dir);
  printWritten('test-scenario project', dir, written);
  const scesim = Object.keys(project.descriptor.files).find((f) => f.endsWith('.scesim'));
  console.log(`\nGenerated ${scesim} (${project.descriptor.files[scesim].length} bytes)\n`);

  // RUN the cases in Node against the decision — this is the real value
  const results = runScenarios(SUITE.cases, (given) => evaluateDecision(DECISION, given));
  for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : ' — ' + JSON.stringify(r.failures)}`);
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
}
