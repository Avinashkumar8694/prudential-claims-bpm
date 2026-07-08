// Example 6 — GENERATE Business Central assets from structured JSON with the SDK's codecs,
// then package them into a deployable kjar. This is the "my engine emits a model, SDK writes the
// file" workflow: parseAsset (file -> JSON) / buildAsset (JSON -> file). See docs/bpm-assets/.
import { buildAsset, parseAsset, writeProject } from '../../dist/index.mjs';
import { isMain, outDir as defaultOutDir } from '../functions/io.mjs';

const PKG = 'src/main/resources/com/acme';

// 1) DRL from a structured model
const drl = buildAsset({ kind: 'drl', model: {
  package: 'com.acme.rules', imports: ['com.acme.model.Claim'], globals: [],
  rules: [{ name: 'High value claim', attributes: ['ruleflow-group "classify"'],
    when: '$c : Claim( amount > 100000 )', then: 'modify( $c ) { setStatus( "HIGH" ) };' }],
} });

// 2) DMN by building a generic XML tree (element nodes)
const el = (name, attrs = {}, children = [], text = '') => ({ name, attrs, children, text, cdata: [] });
const dmn = buildAsset({ kind: 'dmn', model: { xml:
  el('definitions', { name: 'Eligibility', namespace: 'https://acme/dmn' }, [
    el('inputData', { id: '_a', name: 'amount' }, [el('variable', { name: 'amount', typeRef: 'number' })]),
    el('decision', { id: '_d', name: 'isEligible' }, [el('literalExpression', {}, [], 'amount < 500000')]),
  ]) } });

// 3) Java data object from fields
const java = buildAsset({ kind: 'dataObject', model: { package: 'com.acme.model', className: 'Claim',
  fields: [{ name: 'id', type: 'String' }, { name: 'amount', type: 'double' }, { name: 'status', type: 'String' }] } });

// 4) enumeration, 5) dsl, 6) properties, 7) work-item def (.wid)
const enumeration = buildAsset({ kind: 'enumeration', model: { enums: { 'Claim.status': ['NEW', 'HIGH', 'STANDARD'], 'Claim.type': ['DEATH', 'TI'] } } });
const dsl = buildAsset({ kind: 'dsl', model: { entries: [
  { scope: 'when', nl: 'There is a claim over {amount}', mapping: '$c : Claim( amount > {amount} )' },
  { scope: 'then', nl: 'Set status to {status}', mapping: 'modify( $c ) { setStatus( "{status}" ) };' }] } });
const props = buildAsset({ kind: 'properties', model: { props: { 'review.title': 'Review claim' } } });
const wid = buildAsset({ kind: 'workItemDefinition', model: { definitions: [
  { name: 'Rest', displayName: 'REST', category: 'Communication', defaultHandler: 'mvel: new org.jbpm.process.workitem.rest.RESTWorkItemHandler(classLoader)',
    parameters: { Url: 'StringDataType', Method: 'StringDataType' }, results: { Result: 'ObjectDataType' } }] } });

export const GENERATED = {
  [`${PKG}/rules/classify.drl`]: drl,
  [`${PKG}/Eligibility.dmn`]: dmn,
  'src/main/java/com/acme/model/Claim.java': java,
  [`${PKG}/data/enums.enumeration`]: enumeration,
  [`${PKG}/rules/claims.dsl`]: dsl,
  [`${PKG}/messages.properties`]: props,
  'global/WorkDefinitions.wid': wid,
};

export function buildGeneratedAssetsProject(outDir) {
  const process = {
    id: 'com.acme.gen.main', name: 'gen-main', packageName: 'com.acme',
    declarations: { signals: [], errors: [] },
    variables: [{ name: 'caseId', type: 'String' }, { name: 'claim', type: 'com.acme.model.Claim' }],
    nodes: [
      { id: '_s', type: 'startEvent', subtype: 'none', name: 'Start', position: { x: 60, y: 100, width: 40, height: 40 }, outgoing: ['f1'] },
      { id: '_rules', type: 'businessRuleTask', name: 'Classify', ruleFlowGroup: 'classify', implementation: '##unspecified', position: { x: 150, y: 90, width: 120, height: 60 }, incoming: ['f1'], outgoing: ['f2'] },
      { id: '_e', type: 'endEvent', subtype: 'none', name: 'End', position: { x: 320, y: 100, width: 40, height: 40 }, incoming: ['f2'] },
    ],
    flows: [{ id: 'f1', sourceRef: '_s', targetRef: '_rules' }, { id: 'f2', sourceRef: '_rules', targetRef: '_e' }],
  };
  const project = {
    root: outDir,
    descriptor: {
      gav: { groupId: 'com.acme', artifactId: 'generated-assets-bpm', version: '1.0.0-SNAPSHOT', kieVersion: '7.73.0.Final' },
      deployment: { runtimeStrategy: 'SINGLETON', workItemHandlers: [], environmentEntries: [] },
      files: { ...GENERATED },   // assets generated from JSON, carried into the kjar
    },
    processes: [process],
  };
  const written = writeProject(project, outDir);
  return { outDir, written };
}

if (isMain(import.meta.url)) {
  const outDir = defaultOutDir(import.meta.url, 'generated');
  const { written } = buildGeneratedAssetsProject(outDir);
  console.log(`Generated assets from JSON + exported project to ${outDir} (${written.length} files)`);
  // demo the reverse: parse one back to structured JSON
  const back = parseAsset('classify.drl', GENERATED[`${PKG}/rules/classify.drl`]);
  console.log('DRL re-parsed -> rules:', back.model.rules.map((r) => r.name));
}
