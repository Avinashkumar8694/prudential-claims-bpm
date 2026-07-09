// Guided rule template — engine template -> .template (TemplateModel: rule skeleton + columns + rows,
// well-formed, round-trip) + runtime expansion (substitute rows -> rules, run the same rule engine).
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { templateToTemplateXml, buildAsset, parseAsset, fromEngineProject } from '../dist/index.mjs';
import { expandTemplate } from '../examples/functions/rule-template.mjs';
import { run } from '../examples/functions/rule-engine.mjs';
import { TEMPLATE } from '../examples/guided/19-guided-rule-template.mjs';

const TYPES = { amount: 'double', region: 'string', tier: 'string' };

test('templateToTemplateXml — rule skeleton + parameter columns + data rows', () => {
  const t = buildAsset({ kind: 'guidedRuleTemplate', model: templateToTemplateXml(TEMPLATE, TYPES) });
  assert.ok(t.includes('<templateModel><name>Tier pricing</name>'), 'TemplateModel root');
  // skeleton with placeholder values
  assert.ok(t.includes('<fieldName>amount</fieldName>') && t.includes('<value>{min}</value>'), 'placeholder constraint value');
  assert.ok(t.includes('<field>tier</field>') && t.includes('<value>{tier}</value>'), 'placeholder action value');
  // parameter columns
  assert.ok(t.includes('<tableColumns><tableColumn>min</tableColumn><tableColumn>region</tableColumn><tableColumn>tier</tableColumn></tableColumns>'));
  // rows
  assert.ok(t.includes('<row><cell>5000</cell><cell>US</cell><cell>STANDARD</cell></row>'));
  assert.ok(t.includes('<row><cell>100000</cell><cell>US</cell><cell>HIGH</cell></row>'));
});

test('templateToTemplateXml — round-trip stable + well-formed (xmllint)', () => {
  const t = buildAsset({ kind: 'guidedRuleTemplate', model: templateToTemplateXml(TEMPLATE, TYPES) });
  assert.strictEqual(buildAsset(parseAsset('t.template', t)), t, 'round-trip stable');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpl-')); const p = path.join(tmp, 't.template'); fs.writeFileSync(p, t);
  execSync(`xmllint --noout "${p}"`, { stdio: 'pipe' });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('fromEngineProject — template -> .template at defaulted path', () => {
  const proj = fromEngineProject({
    types: [{ name: 'Claim', fields: [{ name: 'amount', type: 'double' }, { name: 'region', type: 'string' }, { name: 'tier', type: 'string' }] }],
    guidedRuleTemplates: [TEMPLATE],
    processes: [{ id: 'p', package: 'com.acme', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  });
  assert.ok(proj.descriptor.files['src/main/resources/com/acme/rules/Tier_pricing.template'], 'default path');
});

// ---- runtime (fully verified) ----
test('expandTemplate — one rule per row, placeholders substituted with type preserved', () => {
  const rs = expandTemplate(TEMPLATE);
  assert.deepStrictEqual(rs.rules.map((r) => r.name), ['Tier pricing_1', 'Tier pricing_2']);
  // {min} -> the NUMBER 100000 (not the string), region/tier -> strings
  assert.deepStrictEqual(rs.rules[1].when, [{ fact: 'Claim', as: 'c', where: { amount: { gte: 100000 }, region: 'US' } }]);
  assert.deepStrictEqual(rs.rules[1].then, [{ set: 'c', fields: { tier: 'HIGH' } }]);
});

test('runtime — expanded rules run on the rule engine (specific row last wins)', () => {
  const rs = expandTemplate(TEMPLATE);
  assert.strictEqual(run(rs, [{ _id: 'c', _type: 'Claim', amount: 250000, region: 'US', tier: '' }]).facts[0].tier, 'HIGH');
  assert.strictEqual(run(rs, [{ _id: 'c', _type: 'Claim', amount: 8000, region: 'US', tier: '' }]).facts[0].tier, 'STANDARD');
  assert.strictEqual(run(rs, [{ _id: 'c', _type: 'Claim', amount: 100, region: 'US', tier: '' }]).facts[0].tier, '');
});
