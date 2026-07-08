import { test } from 'node:test';
import assert from 'node:assert';
import { parseAsset, buildAsset, assetKind } from '../dist/index.mjs';
import { ASSET_FILES } from '../examples/05-all-assets-project.mjs';

// build(parse(x)) must be idempotent and re-parse to an equal model (structured, stable round-trip)
function assertStable(path, content) {
  const a1 = parseAsset(path, content);
  const b1 = buildAsset(a1);
  const a2 = parseAsset(path, b1);
  const b2 = buildAsset(a2);
  assert.strictEqual(b2, b1, `${path}: build is idempotent`);
  assert.deepStrictEqual(a2.model, a1.model, `${path}: model stable across round-trip`);
  return a1;
}

test('assetKind detects every extension', () => {
  const cases = {
    'a.drl': 'drl', 'a.dmn': 'dmn', 'a.dsl': 'dsl', 'a.enumeration': 'enumeration',
    'a.gdst': 'guidedDecisionTable', 'a.gdt': 'guidedDecisionTree', 'a.rdrl': 'guidedRule',
    'a.template': 'guidedRuleTemplate', 'a.scgd': 'scoreCard', 'a.scesim': 'testScenario',
    'a.scenario': 'testScenarioLegacy', 'a.frm': 'form', 'a.java': 'dataObject',
    'a.wid': 'workItemDefinition', 'a.properties': 'properties', 'x.solver.xml': 'solver',
  };
  for (const [f, k] of Object.entries(cases)) assert.strictEqual(assetKind(f), k, f);
});

test('every example asset parses to structured JSON and round-trips stably', () => {
  for (const [path, content] of Object.entries(ASSET_FILES)) assertStable(path, content);
});

test('DRL -> structured model (package, imports, rules with when/then/attributes)', () => {
  const a = parseAsset('classify.drl', ASSET_FILES['src/main/resources/com/acme/rules/classify.drl']);
  assert.strictEqual(a.kind, 'drl');
  assert.strictEqual(a.model.package, 'com.acme.rules');
  assert.deepStrictEqual(a.model.imports, ['com.acme.model.Claim']);
  assert.strictEqual(a.model.rules.length, 2);
  assert.strictEqual(a.model.rules[0].name, 'High value claim');
  assert.ok(a.model.rules[0].attributes.some((x) => x.includes('ruleflow-group')), 'ruleflow-group captured');
  assert.ok(a.model.rules[0].when.includes('Claim( amount > 100000 )'));
});

test('DMN / guided / scorecard / test scenario -> generic XML tree JSON', () => {
  for (const [p, c] of Object.entries(ASSET_FILES)) {
    const kind = assetKind(p);
    if (['dmn', 'guidedDecisionTable', 'guidedRule', 'guidedRuleTemplate', 'scoreCard', 'testScenario', 'testScenarioLegacy', 'solver'].includes(kind)) {
      const a = parseAsset(p, c);
      assert.ok(a.model.xml && a.model.xml.name, `${p}: has an XML root node`);
      assert.ok(Array.isArray(a.model.xml.children), `${p}: children array (traversable/editable)`);
    }
  }
  // e.g. edit the DMN structurally then rebuild
  const dmnPath = Object.keys(ASSET_FILES).find((f) => f.endsWith('.dmn'));
  const a = parseAsset(dmnPath, ASSET_FILES[dmnPath]);
  assert.strictEqual(a.model.xml.attrs.name, 'Eligibility');
});

test('data object (Java) -> {package, className, fields[]} and rebuilds', () => {
  const a = parseAsset('Claim.java', ASSET_FILES['src/main/java/com/acme/model/Claim.java']);
  assert.strictEqual(a.model.className, 'Claim');
  assert.strictEqual(a.model.package, 'com.acme.model');
  const names = a.model.fields.map((f) => f.name).sort();
  assert.deepStrictEqual(names, ['amount', 'id', 'status']);
  const rebuilt = buildAsset(a);
  assert.ok(rebuilt.includes('public double getAmount()'), 'getter generated');
});

test('properties / enumeration / dsl / wid typed models', () => {
  const props = parseAsset('m.properties', ASSET_FILES['src/main/resources/com/acme/messages.properties']).model.props;
  assert.strictEqual(props['review.title'], 'Review claim');
  const enums = parseAsset('e.enumeration', ASSET_FILES['src/main/resources/com/acme/data/enums.enumeration']).model.enums;
  assert.deepStrictEqual(enums['Claim.type'], ['DEATH', 'TI']);
  const dsl = parseAsset('c.dsl', ASSET_FILES['src/main/resources/com/acme/rules/claims.dsl']).model.entries;
  assert.ok(dsl.some((e) => e.scope === 'when') && dsl.some((e) => e.scope === 'then'));
});
