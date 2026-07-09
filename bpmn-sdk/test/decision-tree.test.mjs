// Guided decision tree — engine tree -> .gdt (structure, operators, nesting, derived value types,
// round-trip, well-formedness) + the runtime evaluator (fully verified). Mirrors the scenarios doc.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decisionTreeToGdt, buildAsset, parseAsset, fromEngineProject } from '../dist/index.mjs';
import { evaluateDecisionTree } from '../examples/functions/decision-tree.mjs';
import { TREE } from '../examples/guided/17-decision-tree.mjs';

const TYPES = { amount: 'double', region: 'string', priority: 'string' };

test('decisionTreeToGdt — structure, operators, nested constraints, action leaves', () => {
  const gdt = buildAsset({ kind: 'guidedDecisionTree', model: decisionTreeToGdt(TREE, TYPES, (t) => `com.acme.model.${t}`) });
  assert.ok(gdt.includes('<GuidedDecisionTree><treeName>Claim triage</treeName>'));
  assert.ok(gdt.includes('TypeNodeImpl') && gdt.includes('<className>com.acme.model.Claim</className>'), 'root type node + resolved FQN');
  assert.ok(gdt.includes('<fieldName>amount</fieldName>') && gdt.includes('<operator>&gt;</operator>'), 'constraint field + op');
  assert.ok(gdt.includes('<operator>&lt;=</operator>') && gdt.includes('<fieldName>region</fieldName>'), 'nested constraint');
  // action leaf sets priority
  assert.ok(gdt.includes('ActionUpdateNodeImpl') && gdt.includes('<fieldName>priority</fieldName>') && gdt.includes('>HIGH<'));
  // value type derived from the declared field types
  assert.ok(gdt.includes('<value class="java.lang.Double">100000</value>'), 'numeric value class derived');
  assert.ok(gdt.includes('<value class="java.lang.String">US</value>'), 'string value class derived');
});

test('decisionTreeToGdt — round-trip stable + well-formed (xmllint)', () => {
  const gdt = buildAsset({ kind: 'guidedDecisionTree', model: decisionTreeToGdt(TREE, TYPES) });
  assert.strictEqual(buildAsset(parseAsset('t.gdt', gdt)), gdt, 'round-trip stable');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdt-')); const p = path.join(tmp, 't.gdt'); fs.writeFileSync(p, gdt);
  execSync(`xmllint --noout "${p}"`, { stdio: 'pipe' });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('fromEngineProject — tree -> .gdt at defaulted path, value types derived from the fact', () => {
  const proj = fromEngineProject({
    types: [{ name: 'Claim', fields: [{ name: 'amount', type: 'double' }, { name: 'region', type: 'string' }, { name: 'priority', type: 'string' }] }],
    decisionTrees: [TREE],
    processes: [{ id: 'p', package: 'com.acme', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  });
  const gdt = proj.descriptor.files['src/main/resources/com/acme/rules/Claim_triage.gdt'];
  assert.ok(gdt, 'default path');
  assert.ok(gdt.includes('<className>com.acme.model.Claim</className>'), 'fact resolved to FQN');
  assert.ok(gdt.includes('<value class="java.lang.Double">100000</value>'), 'derived numeric value class');
});

// ---- runtime evaluator (fully verified) ----
test('evaluateDecisionTree — first branch → leaf', () => {
  const { fact, path } = evaluateDecisionTree(TREE, { amount: 250000, region: 'US', priority: '' });
  assert.strictEqual(fact.priority, 'HIGH');
  assert.deepStrictEqual(path, ['amount gt 100000']);
});

test('evaluateDecisionTree — descend into a nested node', () => {
  const { fact, path } = evaluateDecisionTree(TREE, { amount: 8000, region: 'EU', priority: '' });
  assert.strictEqual(fact.priority, 'REVIEW');
  assert.deepStrictEqual(path, ['amount lte 100000', 'region eq "EU"']);
});

test('evaluateDecisionTree — no matching branch leaves the fact unchanged', () => {
  const { fact, path } = evaluateDecisionTree(TREE, { amount: 5000, region: 'APAC', priority: '' });
  assert.strictEqual(fact.priority, '');                 // region has no APAC branch
  assert.deepStrictEqual(path, ['amount lte 100000']);   // walked in, then stuck
});
