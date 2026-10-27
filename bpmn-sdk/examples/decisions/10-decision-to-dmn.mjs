// Example 10 — author a DMN decision TABLE in the clean engine model, convert to a jBPM kjar.
//
// You write columns (inputs/outputs) + rows (rules with when/then). No FEEL, no DMN XML, no
// namespaces — fromEngineProject runs decisionToDmn to synthesize the DMN 1.2 file, and a `rule`
// node bound to dmn:{model,decision} fires it. See docs/bpm-assets/dmn/.
import { fromEngineProject, writeProject } from '../../dist/index.mjs';
import { isMain, outDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

export const DECISION_MODEL = {
  name: 'ClaimDecisions',
  decisions: [{
    name: 'Eligibility',
    hitPolicy: 'UNIQUE',
    inputs: [{ name: 'amount', type: 'number' }, { name: 'region', type: 'string' }],
    outputs: [{ name: 'approved', type: 'boolean' }, { name: 'tier', type: 'string' }],
    rules: [
      { when: { amount: { gt: 100000 }, region: 'US' }, then: { approved: true, tier: 'HIGH' } },
      { when: { amount: { between: [1, 100000] } },      then: { approved: true, tier: 'STANDARD' } },
      { when: { amount: { lt: 1 } },                     then: { approved: false, tier: 'NONE' } },
    ],
  }],
};

export function buildDecisionProject(dir) {
  const engine = {
    id: 'com.acme.claims',
    decisions: [DECISION_MODEL],
    processes: [{
      id: 'com.acme.claims.eligibility', name: 'eligibility', package: 'com.acme',
      nodes: [
        { id: 's', type: 'start' },
        // fires the generated DMN decision; namespace matches the SDK default <pkg>/dmn/<model>
        { id: 'd', type: 'rule', name: 'Eligibility', dmn: { namespace: 'https://com/acme/dmn/ClaimDecisions', model: 'ClaimDecisions', decision: 'Eligibility' } },
        { id: 'e', type: 'end' },
      ],
      flows: [{ from: 's', to: 'd' }, { from: 'd', to: 'e' }],
    }],
  };
  const project = fromEngineProject(engine);
  const written = writeProject(project, dir);
  return { project, written };
}

if (isMain(import.meta.url)) {
  const dir = outDir(import.meta.url, 'decision');
  const { project, written } = buildDecisionProject(dir);
  printWritten('DMN decision project', dir, written);
  console.log('\nGenerated DMN:\n');
  console.log(project.descriptor.files['src/main/resources/ClaimDecisions.dmn']);
}
