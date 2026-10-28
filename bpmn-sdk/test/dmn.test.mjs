// DMN coverage — engine decision table -> DMN 1.2. Every InputTest/OutputResult form, hit policies,
// type mapping, round-trip + well-formedness. Mirrors docs/bpm-assets/dmn/scenarios.md.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { feelTest, feelResult, decisionToDmn, dmnToDecisionModel, parseFeelTest, parseFeelResult, buildAsset, parseAsset, fromEngineProject } from '../dist/index.mjs';

// ---- FEEL input-cell mapping (every InputTest form) ----
test('feelTest — every input cell form -> FEEL', () => {
  assert.strictEqual(feelTest('US'), '"US"');
  assert.strictEqual(feelTest(5), '5');
  assert.strictEqual(feelTest(true), 'true');
  assert.strictEqual(feelTest('-'), '-');
  assert.strictEqual(feelTest({ any: true }), '-');
  assert.strictEqual(feelTest(['A', 'B']), '"A", "B"');
  assert.strictEqual(feelTest({ in: ['A', 'B'] }), '"A", "B"');
  assert.strictEqual(feelTest({ gt: 100000 }), '> 100000');
  assert.strictEqual(feelTest({ gte: 1 }), '>= 1');
  assert.strictEqual(feelTest({ lt: 50 }), '< 50');
  assert.strictEqual(feelTest({ lte: 50 }), '<= 50');
  assert.strictEqual(feelTest({ between: [1, 10] }), '[1..10]');
  assert.strictEqual(feelTest({ not: 'US' }), 'not("US")');
  assert.strictEqual(feelTest({ not: ['A', 'B'] }), 'not("A", "B")');
  assert.strictEqual(feelTest({ feel: '> date("2026-01-01")' }), '> date("2026-01-01")');
});

test('feelResult — output cell forms', () => {
  assert.strictEqual(feelResult('HIGH'), '"HIGH"');
  assert.strictEqual(feelResult(42), '42');
  assert.strictEqual(feelResult(false), 'false');
  assert.strictEqual(feelResult({ feel: 'amount * 0.1' }), 'amount * 0.1');
});

const MODEL = {
  name: 'Eligibility',
  decisions: [{
    name: 'Eligibility', hitPolicy: 'UNIQUE',
    inputs: [{ name: 'amount', type: 'number' }, { name: 'region', type: 'string' }],
    outputs: [{ name: 'approved', type: 'boolean' }, { name: 'tier', type: 'string' }],
    rules: [
      { when: { amount: { gt: 100000 }, region: 'US' }, then: { approved: true, tier: 'HIGH' } },
      { when: { amount: { between: [1, 100000] } }, then: { approved: true, tier: 'STANDARD' } },
    ],
  }],
};

test('decisionToDmn — structure, typeRefs, FEEL cells, hitPolicy', () => {
  const dmn = buildAsset({ kind: 'dmn', model: decisionToDmn(MODEL) });
  assert.ok(dmn.includes('xmlns="http://www.omg.org/spec/DMN/20180521/MODEL/"'), 'DMN 1.2 namespace');
  assert.ok(dmn.includes('<decisionTable id="_dec_Eligibility_dt" hitPolicy="UNIQUE">'), 'hit policy');
  assert.ok(dmn.includes('<inputData id="_id_amount" name="amount">') && dmn.includes('typeRef="number"'), 'inputData + type');
  assert.ok(dmn.includes('<output id="_dec_Eligibility_dt_out_approved" name="approved" typeRef="boolean"/>'), 'named typed output');
  // FEEL cells are entity-escaped in XML but decode back
  assert.ok(dmn.includes('&gt; 100000'), '> escaped in XML');
  const back = parseAsset('e.dmn', dmn);
  const firstEntry = (function f(n) { if (n.name === 'inputEntry') return n; for (const c of n.children) { const r = f(c); if (r) return r; } })(back.model.xml);
  assert.strictEqual(firstEntry.children[0].text, '> 100000', 'FEEL decodes back');
});

test('decisionToDmn — COLLECT + aggregation attribute', () => {
  const dmn = buildAsset({ kind: 'dmn', model: decisionToDmn({
    name: 'Fees', decisions: [{ name: 'Fees', hitPolicy: 'COLLECT', aggregation: 'SUM',
      inputs: [{ name: 'kind', type: 'string' }], outputs: [{ name: 'charge', type: 'number' }],
      rules: [{ when: { kind: 'BASE' }, then: { charge: 50 } }] }] }) });
  assert.ok(dmn.includes('hitPolicy="COLLECT"') && dmn.includes('aggregation="SUM"'));
});

test('decisionToDmn — round-trip stable + well-formed (xmllint)', () => {
  const dmn = buildAsset({ kind: 'dmn', model: decisionToDmn(MODEL) });
  assert.strictEqual(buildAsset(parseAsset('e.dmn', dmn)), dmn, 'round-trip stable');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dmn-')); const dp = path.join(tmp, 'e.dmn'); fs.writeFileSync(dp, dmn);
  execSync(`xmllint --noout "${dp}"`, { stdio: 'pipe' });
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- inverse direction: real DMN XML -> engine decision model (best-effort, decisionTable only) ----
test('parseFeelTest / parseFeelResult — inverse of feelTest/feelResult for every cell form', () => {
  assert.deepStrictEqual(parseFeelTest('"US"'), 'US');
  assert.deepStrictEqual(parseFeelTest('5'), 5);
  assert.deepStrictEqual(parseFeelTest('true'), true);
  assert.deepStrictEqual(parseFeelTest('-'), { any: true });
  assert.deepStrictEqual(parseFeelTest('"A", "B"'), ['A', 'B']);
  assert.deepStrictEqual(parseFeelTest('> 100000'), { gt: 100000 });
  assert.deepStrictEqual(parseFeelTest('>= 1'), { gte: 1 });
  assert.deepStrictEqual(parseFeelTest('< 50'), { lt: 50 });
  assert.deepStrictEqual(parseFeelTest('<= 50'), { lte: 50 });
  assert.deepStrictEqual(parseFeelTest('[1..10]'), { between: [1, 10] });
  assert.deepStrictEqual(parseFeelTest('not("US")'), { not: 'US' });
  assert.deepStrictEqual(parseFeelTest('some_function(x)'), { feel: 'some_function(x)' }, 'real FEEL falls back to the escape hatch, not a crash');
  assert.deepStrictEqual(parseFeelResult('"HIGH"'), 'HIGH');
  assert.deepStrictEqual(parseFeelResult('42'), 42);
  assert.deepStrictEqual(parseFeelResult('amount * 0.1'), { feel: 'amount * 0.1' });
});

test('dmnToDecisionModel — recovers a decisionTable-driven model from real DMN XML (round-trip with decisionToDmn)', () => {
  const dmn = buildAsset({ kind: 'dmn', model: decisionToDmn(MODEL) });
  const recovered = dmnToDecisionModel(parseAsset('e.dmn', dmn).model.xml);
  assert.ok(recovered, 'a decisionTable-based DMN file recovers a model');
  assert.strictEqual(recovered.decisions[0].name, 'Eligibility');
  assert.strictEqual(recovered.decisions[0].hitPolicy, 'UNIQUE');
  assert.deepStrictEqual(recovered.decisions[0].inputs.map((i) => i.name), ['amount', 'region']);
  assert.deepStrictEqual(recovered.decisions[0].outputs.map((o) => o.name), ['approved', 'tier']);
  // decisionToDmn fills in an explicit "-" (any) for every input a rule doesn't mention (see its own
  // `inp.name in r.when ? ... : '-'`), so a sparse `when` on the way in comes back fully populated —
  // check the two rules' actual cell values instead of a raw deepStrictEqual against the sparse MODEL.
  assert.deepStrictEqual(recovered.decisions[0].rules[0].when, { amount: { gt: 100000 }, region: 'US' });
  assert.deepStrictEqual(recovered.decisions[0].rules[1].when, { amount: { between: [1, 100000] }, region: { any: true } });
  assert.deepStrictEqual(recovered.decisions[0].rules.map((r) => r.then), MODEL.decisions[0].rules.map((r) => r.then));
  // re-serializing the recovered model produces byte-identical DMN — a genuine full round trip,
  // not just "didn't crash": model -> XML -> model' -> XML' with XML === XML'.
  const dmn2 = buildAsset({ kind: 'dmn', model: decisionToDmn(recovered) });
  assert.strictEqual(dmn2, dmn, 'recovered model re-serializes to identical DMN XML');
});

test('dmnToDecisionModel — a literalExpression-only DMN (no decisionTable) recovers nothing, not a wrong guess', () => {
  const dmn = `<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/DMN/20180521/MODEL/" id="_d" name="LitOnly" namespace="ns">
    <decision id="_dec1" name="isAdult"><variable name="isAdult"/>
      <literalExpression><text>if age &gt;= 18 then "YES" else "NO"</text></literalExpression>
    </decision></definitions>`;
  const recovered = dmnToDecisionModel(parseAsset('e.dmn', dmn).model.xml);
  assert.strictEqual(recovered, undefined, 'no decisionTable anywhere -> nothing recoverable, not a guess');
});

test('fromEngineProject — engine decisions -> generated .dmn with default namespace + path', () => {
  const proj = fromEngineProject({
    id: 'com.acme.claims',
    decisions: [MODEL],
    processes: [{ id: 'p', package: 'com.acme',
      nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  });
  const dmn = proj.descriptor.files['src/main/resources/Eligibility.dmn'];
  assert.ok(dmn, 'default path src/main/resources/<name>.dmn');
  assert.ok(dmn.includes('namespace="https://com/acme/dmn/Eligibility"'), 'namespace defaulted from process package');
});
