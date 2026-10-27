// End-to-end: build ONE EngineProject that uses EVERY engine-native asset + a process, convert via
// fromEngineProject, write the kjar, and validate the whole thing — every expected file is produced,
// the BPMN re-parses/validates, and every generated XML asset is well-formed (xmllint).
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fromEngineProject, writeProject, parseBpmn, validateModel } from '../dist/index.mjs';

const ENGINE = {
  gav: { groupId: 'com.acme', artifactId: 'claims-bpm', version: '1.0.0', kieVersion: '7.73.0.Final' },
  deployment: { runtime: 'SINGLETON', env: { INTEGRATION_LAYER_URL: 'http://localhost:3000' } },
  types: [
    { name: 'Claim', fields: [{ name: 'amount', type: 'double' }, { name: 'region', type: 'string' }, { name: 'status', type: 'string' }, { name: 'priority', type: 'string' }, { name: 'riskScore', type: 'int' }] },
  ],
  rulesets: [{ group: 'classify', rules: [{ name: 'High', when: [{ fact: 'Claim', as: 'c', where: { amount: { gt: 100000 } } }], then: [{ set: 'c', fields: { priority: 'HIGH' } }] }] }],
  decisions: [{ name: 'ClaimDecisions', decisions: [{ name: 'Eligibility', hitPolicy: 'UNIQUE', inputs: [{ name: 'amount', type: 'number' }], outputs: [{ name: 'tier', type: 'string' }], rules: [{ when: { amount: { gt: 100000 } }, then: { tier: 'HIGH' } }] }] }],
  guidedTables: [{ name: 'Triage', fact: 'Claim', conditions: [{ field: 'amount', op: 'gt' }], actions: [{ field: 'priority' }], rows: [{ when: { amount: 100000 }, then: { priority: 'HIGH' } }] }],
  guidedRules: [{ name: 'FlagBig', when: [{ fact: 'Claim', as: 'c', where: { amount: { gt: 100000 } } }], then: [{ set: 'c', fields: { priority: 'HIGH' } }] }],
  guidedRuleTemplates: [{ name: 'Tiering', when: [{ fact: 'Claim', as: 'c', where: { amount: { gte: '{min}' } } }], then: [{ set: 'c', fields: { priority: '{tier}' } }], rows: [{ min: 100000, tier: 'HIGH' }] }],
  decisionTrees: [{ name: 'Route', fact: 'Claim', root: { field: 'amount', branches: [{ op: 'gt', value: 100000, then: [{ set: 'priority', value: 'HIGH' }] }] } }],
  scorecards: [{ name: 'Risk', fact: 'Claim', score: 'riskScore', baseline: 100, characteristics: [{ field: 'amount', bands: [{ when: { gt: 100000 }, points: 30 }] }] }],
  forms: [{ name: 'ClaimReview', type: 'Claim', fields: [{ bind: 'amount', readOnly: true }, { bind: 'status', required: true }] }],
  enumerations: [{ type: 'Claim', field: 'status', values: ['NEW', 'OPEN', 'APPROVED'] }],
  workItems: [{ name: 'SendEmail', parameters: { to: 'String' }, results: { id: 'String' } }],
  dsl: [{ scope: 'when', nl: 'a big claim', mapping: 'Claim( amount > 100000 )' }],
  messages: { default: { 'review.title': 'Review claim' }, fr: { 'review.title': 'Examiner' } },
  tests: [{ name: 'EligibilityTest', target: 'Eligibility', cases: [{ given: { amount: 250000 }, expect: { tier: 'HIGH' } }] }],
  processes: [{
    id: 'claims', name: 'Claims', package: 'com.acme',
    vars: [{ name: 'claim', type: 'Claim' }],
    nodes: [
      { id: 's', type: 'start' },
      { id: 'v', type: 'http', method: 'POST', url: '/v1/claims/validate', body: { id: 'x' } },
      { id: 'r', type: 'rule', name: 'Classify', ruleflowGroup: 'classify' },
      { id: 'u', type: 'userTask', name: 'Review', group: 'Examiner', form: 'ClaimReview' },
      { id: 'e', type: 'end' },
    ],
    flows: [{ from: 's', to: 'v' }, { from: 'v', to: 'r' }, { from: 'r', to: 'u' }, { from: 'u', to: 'e' }],
  }],
};

// every generated file we expect from the engine assets above
const EXPECTED = [
  'src/main/java/com/acme/model/Claim.java',
  'src/main/resources/com/acme/rules/classify.drl',
  'src/main/resources/ClaimDecisions.dmn',
  'src/main/resources/com/acme/rules/Triage.gdst',
  'src/main/resources/com/acme/rules/FlagBig.rdrl',
  'src/main/resources/com/acme/rules/Tiering.template',
  'src/main/resources/com/acme/rules/Route.gdt',
  'src/main/resources/com/acme/rules/Risk.scgd',
  'src/main/resources/forms/ClaimReview.frm',
  'src/main/resources/enumerations.enumeration',
  'src/main/resources/dsl/definitions.dsl',
  'src/main/resources/messages.properties',
  'src/main/resources/messages_fr.properties',
  'src/test/resources/EligibilityTest.scesim',
];
const XML_EXT = ['.bpmn', '.dmn', '.gdst', '.gdt', '.rdrl', '.template', '.scgd', '.scesim', '.xml'];

test('fromEngineProject + writeProject — full project produces every asset, all valid', () => {
  const project = fromEngineProject(ENGINE);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'full-'));
  const written = writeProject(project, dir);

  // 1. kjar scaffolding present
  for (const f of ['pom.xml', 'src/main/resources/META-INF/kmodule.xml', 'src/main/resources/META-INF/kie-deployment-descriptor.xml', 'global/WorkDefinitions.wid']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `scaffold: ${f}`);
  }
  // 2. every engine-asset file produced
  for (const f of EXPECTED) assert.ok(fs.existsSync(path.join(dir, f)), `asset: ${f}`);
  // 3. a .bpmn was written, re-parses and validates
  const bpmn = written.filter((f) => f.endsWith('.bpmn'));
  assert.strictEqual(bpmn.length, 1, 'one process .bpmn');
  const model = parseBpmn(fs.readFileSync(path.join(dir, bpmn[0]), 'utf8'));
  assert.ok(validateModel(model).ok, 'BPMN validates');
  assert.deepStrictEqual(model.nodes.map((n) => n.id).sort(), ['e', 'r', 's', 'u', 'v'], 'all nodes present');
  // 4. every generated XML asset is well-formed
  const walk = (d, acc = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, acc); else acc.push(p); } return acc; };
  const xmlFiles = walk(dir).filter((p) => XML_EXT.includes(path.extname(p)));
  assert.ok(xmlFiles.length >= 9, `expected many XML assets, got ${xmlFiles.length}`);
  for (const p of xmlFiles) execSync(`xmllint --noout "${p}"`, { stdio: 'pipe' });   // throws if malformed
  // 5. the generated form binds to the resolved Claim FQN
  assert.ok(fs.readFileSync(path.join(dir, 'src/main/resources/forms/ClaimReview.frm'), 'utf8').includes('com.acme.model.Claim'));
  // 6. default work-item handlers registered + custom SendEmail defined
  const names = project.descriptor.workDefinitions.map((w) => w.name);
  assert.ok(names.includes('Rest') && names.includes('SendEmail'), 'defaults + custom work items');

  fs.rmSync(dir, { recursive: true, force: true });
});
