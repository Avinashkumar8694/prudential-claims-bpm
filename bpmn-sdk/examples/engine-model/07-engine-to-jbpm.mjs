// Example 7 — author in the clean ENGINE model, convert to jBPM, export a kjar.
//
// Highlights the type-resolution answer: the engine declares data TYPES by name; the converter
// resolves a name -> Java FQN wherever jBPM needs one (variable structureRef, form className) AND
// auto-generates the .java POJO. The JS engine never hand-writes a Java class or an FQN.
import { fromEngineProject, makeTypeResolver, writeProject, toEngine, parseBpmn } from '../../dist/index.mjs';
import { isMain, outDir as defaultOutDir } from '../functions/io.mjs';
import fs from 'node:fs';

// declared data types (schemas) — the engine's source of truth for facts/POJOs
const types = [
  { name: 'Claim', package: 'com.acme.model', fields: [
    { name: 'id', type: 'string' }, { name: 'amount', type: 'double' }, { name: 'status', type: 'string' }] },
];
const resolveType = makeTypeResolver(types);          // name -> FQN  (e.g. "Claim" -> "com.acme.model.Claim")

export function buildEngineProject(outDir) {
  const engine = {
    id: 'engine-claims-bpm',
    gav: { groupId: 'com.acme', artifactId: 'engine-claims-bpm', version: '1.0.0-SNAPSHOT', kieVersion: '7.73.0.Final' },
    deployment: { runtime: 'SINGLETON', env: { INTEGRATION_LAYER_URL: 'http://localhost:3000' }, handlers: ['Rest'] },
    types,
    assets: {
      // a form whose model className is RESOLVED from the type name — not hand-written
      'src/main/resources/forms/review.frm': {
        kind: 'form',
        model: { json: { id: 'review', name: 'review',
          model: { className: resolveType('Claim') },   // -> "com.acme.model.Claim"
          fields: [{ id: 'amount', code: 'DoubleBox', binding: 'amount' }, { id: 'status', code: 'TextBox', binding: 'status' }] } },
      },
    },
    processes: [{
      id: 'com.acme.engine.claims', name: 'engine-claims', package: 'com.acme',
      vars: [
        { name: 'caseId', type: 'string' },
        { name: 'claim', type: 'Claim' },        // <-- type NAME; converter resolves to the FQN
        { name: 'tier', type: 'string' },
      ],
      nodes: [
        { id: 's', type: 'start' },
        { id: 'boot', type: 'script', lang: 'java', code: 'kcontext.setVariable("baseUrl", "http://localhost:3000");' },
        { id: 'derive', type: 'script', lang: 'js', code: 'kcontext.setVariable("tier", "STANDARD");' },  // JS dialect
        { id: 'status', type: 'http', method: 'POST', url: '/v1/claims/status',
          body: { status: '$tier', caseId: '$caseId' }, resultTo: { tier: '$.status' } },
        { id: 'rules', type: 'rule', ruleflowGroup: 'classify' },
        { id: 'items', type: 'forEach', process: 'com.acme.engine.claims', over: 'policies', as: 'policy', collectInto: 'results', parallel: true },
        { id: 'xg', type: 'gateway', mode: 'exclusive', default: 'other' },
        { id: 'review', type: 'userTask', name: 'Review', group: 'Verifier', form: 'review' },
        { id: 'e1', type: 'end' },
        { id: 'e2', type: 'end', result: 'terminate' },
      ],
      flows: [
        { from: 's', to: 'boot' }, { from: 'boot', to: 'derive' }, { from: 'derive', to: 'status' },
        { from: 'status', to: 'rules' }, { from: 'rules', to: 'xg' },
        { id: 'high', from: 'xg', to: 'review', when: 'tier == "HIGH"', lang: 'js' },
        { id: 'other', from: 'xg', to: 'e1' },
        { from: 'review', to: 'e2' },
      ],
    }],
  };

  const project = fromEngineProject(engine);   // engine JSON -> jBPM ProcessModel + kjar descriptor
  const written = writeProject(project, outDir);
  return { engine, project, written };
}

if (isMain(import.meta.url)) {
  const outDir = defaultOutDir(import.meta.url, 'engine');
  const { project, written } = buildEngineProject(outDir);
  const claim = project.processes[0].variables.find((v) => v.name === 'claim');
  console.log(`Exported engine project (${written.length} files).`);
  console.log(`  var 'claim' resolved type: ${claim.type}`);
  console.log(`  generated POJO: ${written.find((f) => f.endsWith('Claim.java'))}`);
  // reverse: jBPM -> engine
  const back = toEngine(project.processes[0]);
  console.log('  toEngine node types:', back.nodes.map((n) => n.type).join(', '));
}
