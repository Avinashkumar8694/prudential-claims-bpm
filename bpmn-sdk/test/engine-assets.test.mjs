import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fromEngineProject, toEngineProject, parseAsset } from '../dist/index.mjs';

// an engine project that declares a type + structured assets (DRL, DMN, properties)
const engine = {
  id: 'com.acme.assets',
  gav: { groupId: 'com.acme', artifactId: 'assets-bpm', version: '1', kieVersion: '7.73.0.Final' },
  deployment: { runtime: 'SINGLETON', env: { INTEGRATION_LAYER_URL: 'http://localhost:3000' }, handlers: ['Rest'] },
  types: [{ name: 'Claim', package: 'com.acme.model', fields: [{ name: 'amount', type: 'double' }, { name: 'status', type: 'string' }] }],
  assets: {
    'src/main/resources/com/acme/rules/classify.drl': { kind: 'drl', model: {
      package: 'com.acme.rules', imports: ['com.acme.model.Claim'], globals: [],
      rules: [{ name: 'High', attributes: ['ruleflow-group "classify"'], when: '$c : Claim( amount > 100000 )', then: 'modify( $c ) { setStatus( "HIGH" ) };' }] } },
    'src/main/resources/com/acme/Eligibility.dmn': { kind: 'dmn', model: { xml: {
      name: 'definitions', attrs: { name: 'Eligibility', namespace: 'https://acme/dmn' },
      children: [{ name: 'decision', attrs: { id: '_d', name: 'isEligible' }, children: [{ name: 'literalExpression', attrs: {}, children: [], text: 'amount < 500000', cdata: [] }], text: '', cdata: [] }], text: '', cdata: [] } } },
    'src/main/resources/com/acme/messages.properties': { kind: 'properties', model: { props: { 'review.title': 'Review claim' } } },
  },
  processes: [{
    id: 'com.acme.assets.p', name: 'p', package: 'com.acme',
    vars: [{ name: 'claim', type: 'Claim' }],
    nodes: [{ id: 's', type: 'start' }, { id: 'r', type: 'rule', ruleflowGroup: 'classify' }, { id: 'e', type: 'end' }],
    flows: [{ from: 's', to: 'r' }, { from: 'r', to: 'e' }],
  }],
};

test('fromEngineProject converts structured assets (DRL/DMN/properties) to real files', () => {
  const proj = fromEngineProject(engine);
  const f = proj.descriptor.files;
  // .java generated from the declared type
  assert.ok(f['src/main/java/com/acme/model/Claim.java'].includes('public double getAmount()'), 'type -> POJO');
  // DRL model -> DRL text
  const drl = f['src/main/resources/com/acme/rules/classify.drl'];
  assert.ok(drl.includes('rule "High"') && drl.includes('ruleflow-group "classify"'), 'DRL built from model');
  // DMN model (xml tree) -> DMN text, well-formed
  const dmn = f['src/main/resources/com/acme/Eligibility.dmn'];
  // `<` in text is correctly escaped to &lt; in the file (well-formed XML); decodes back on parse
  assert.ok(dmn.includes('<definitions') && dmn.includes('amount &lt; 500000'), 'DMN built (entity-escaped)');
  assert.strictEqual(parseAsset('x.dmn', dmn).model.xml.children[0].children[0].text, 'amount < 500000', 'round-trips to decoded text');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dmn-')); const dp = path.join(tmp, 'e.dmn'); fs.writeFileSync(dp, dmn);
  execSync(`xmllint --noout "${dp}"`, { stdio: 'pipe' });
  fs.rmSync(tmp, { recursive: true, force: true });
  // properties
  assert.ok(f['src/main/resources/com/acme/messages.properties'].includes('review.title=Review claim'));
});

test('toEngineProject recovers types + structured assets from a jBPM project', () => {
  const proj = fromEngineProject(engine);
  const back = toEngineProject(proj);
  // type recovered from the generated .java
  const claim = back.types.find((t) => t.name === 'Claim');
  assert.ok(claim, 'Claim type recovered');
  assert.strictEqual(claim.package, 'com.acme.model');
  assert.deepStrictEqual(claim.fields.map((f) => f.type).sort(), ['double', 'string']);
  // assets recovered as STRUCTURED models
  const drl = back.assets['src/main/resources/com/acme/rules/classify.drl'];
  assert.strictEqual(drl.kind, 'drl');
  assert.strictEqual(drl.model.rules[0].name, 'High');
  const dmn = back.assets['src/main/resources/com/acme/Eligibility.dmn'];
  assert.strictEqual(dmn.kind, 'dmn');
  assert.strictEqual(dmn.model.xml.attrs.name, 'Eligibility');
  // deployment/gav recovered
  assert.strictEqual(back.gav.artifactId, 'assets-bpm');
  assert.strictEqual(back.deployment.env.INTEGRATION_LAYER_URL, 'http://localhost:3000');
  assert.ok(back.deployment.handlers.includes('Rest'));
});

test('engine -> jBPM -> engine round-trip keeps assets + types stable', () => {
  const back = toEngineProject(fromEngineProject(engine));
  const again = toEngineProject(fromEngineProject(back));
  assert.deepStrictEqual(again.types, back.types, 'types stable');
  assert.deepStrictEqual(Object.keys(again.assets).sort(), Object.keys(back.assets).sort(), 'asset paths stable');
  assert.deepStrictEqual(again.assets[Object.keys(again.assets)[0]].model, back.assets[Object.keys(back.assets)[0]].model, 'asset model stable');
});
