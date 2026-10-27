// Guided rule — engine rule -> .rdrl (RuleModel: fact patterns + constraints + actions, derived types,
// round-trip, well-formedness) + runtime via the SAME rule engine (a guided rule IS a rule).
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ruleToRdrl, buildAsset, parseAsset, fromEngineProject } from '../dist/index.mjs';
import { run } from '../examples/functions/rule-engine.mjs';
import { RULE } from '../examples/guided/18-guided-rule.mjs';

const TYPES = { amount: 'double', status: 'string', priority: 'string' };

test('ruleToRdrl — fact pattern + field constraints + set action, derived field types', () => {
  const rdrl = buildAsset({ kind: 'guidedRule', model: ruleToRdrl(RULE, TYPES) });
  assert.ok(rdrl.startsWith('<?xml') && rdrl.includes('<rule><name>High value open claim</name>'));
  assert.ok(rdrl.includes('FactPattern') && rdrl.includes('<factType>Claim</factType>') && rdrl.includes('<boundName>c</boundName>'));
  // constraints: amount > 100000 (Double), status == OPEN (String)
  assert.ok(rdrl.includes('<fieldName>amount</fieldName>') && rdrl.includes('<fieldType>Double</fieldType>') && rdrl.includes('<operator>&gt;</operator>') && rdrl.includes('<value>100000</value>'));
  assert.ok(rdrl.includes('<fieldName>status</fieldName>') && rdrl.includes('<operator>==</operator>') && rdrl.includes('<value>OPEN</value>'));
  // action: set priority = HIGH
  assert.ok(rdrl.includes('ActionSetField') && rdrl.includes('<variable>c</variable>') && rdrl.includes('<field>priority</field>') && rdrl.includes('<value>HIGH</value>'));
});

test('ruleToRdrl — attributes + negation + insert action', () => {
  const rdrl = buildAsset({ kind: 'guidedRule', model: ruleToRdrl({
    name: 'R', priority: 10, noLoop: true,
    when: [{ fact: 'Claim', as: 'c', where: { amount: { gt: 1 } } }, { fact: 'Reviewer', exists: false, where: { assigned: true } }],
    then: [{ insert: 'Escalation', fields: { level: 3 } }],
  }, { amount: 'double', assigned: 'boolean', level: 'int' }) });
  assert.ok(rdrl.includes('salience') && rdrl.includes('<value>10</value>') && rdrl.includes('no-loop'));
  assert.ok(rdrl.includes('CompositeFactPattern') && rdrl.includes('type="not"'), 'exists:false -> not pattern');
  assert.ok(rdrl.includes('ActionInsertFact') && rdrl.includes('<factType>Escalation</factType>'));
});

test('ruleToRdrl — round-trip stable + well-formed (xmllint)', () => {
  const rdrl = buildAsset({ kind: 'guidedRule', model: ruleToRdrl(RULE, TYPES) });
  assert.strictEqual(buildAsset(parseAsset('r.rdrl', rdrl)), rdrl, 'round-trip stable');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rdrl-')); const p = path.join(tmp, 'r.rdrl'); fs.writeFileSync(p, rdrl);
  execSync(`xmllint --noout "${p}"`, { stdio: 'pipe' });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('fromEngineProject — guided rule -> .rdrl at defaulted path, types derived', () => {
  const proj = fromEngineProject({
    types: [{ name: 'Claim', fields: [{ name: 'amount', type: 'double' }, { name: 'status', type: 'string' }, { name: 'priority', type: 'string' }] }],
    guidedRules: [RULE],
    processes: [{ id: 'p', package: 'com.acme', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  });
  const rdrl = proj.descriptor.files['src/main/resources/com/acme/rules/High_value_open_claim.rdrl'];
  assert.ok(rdrl, 'default path');
  assert.ok(rdrl.includes('<fieldType>Double</fieldType>'), 'amount type derived from Claim');
});

test('runtime — the same rule engine executes the guided rule', () => {
  const ruleset = { rules: [{ name: RULE.name, when: RULE.when, then: RULE.then }] };
  const hit = run(ruleset, [{ _id: 'c1', _type: 'Claim', amount: 250000, status: 'OPEN', priority: '' }]);
  assert.strictEqual(hit.facts[0].priority, 'HIGH');
  const miss = run(ruleset, [{ _id: 'c2', _type: 'Claim', amount: 250000, status: 'CLOSED', priority: '' }]);
  assert.strictEqual(miss.facts[0].priority, '');
});
