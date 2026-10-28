// The reference DMN evaluator (examples/functions/dmn-engine) executes the engine decision model on
// data. Proves how input tests, hit policies, and aggregation apply. Uses the comprehensive example.
import { test } from 'node:test';
import assert from 'node:assert';
import { evaluateDecision, evaluateModel, testMatch } from '../examples/functions/dmn-engine.mjs';
import { MODEL } from '../examples/decisions/11-comprehensive-decision.mjs';

test('testMatch — every input test form on values', () => {
  assert.ok(testMatch('US', 'US'));
  assert.ok(testMatch(5, '-') && testMatch(5, { any: true }));       // any
  assert.ok(testMatch('A', ['A', 'B']) && !testMatch('C', ['A', 'B']));
  assert.ok(testMatch(200, { gt: 100 }) && !testMatch(50, { gt: 100 }));
  assert.ok(testMatch(100, { gte: 100 }) && testMatch(1, { lte: 100 }) && testMatch(1, { lt: 100 }));
  assert.ok(testMatch(5, { between: [1, 10] }) && !testMatch(11, { between: [1, 10] }));
  assert.ok(testMatch('X', { not: 'US' }) && !testMatch('US', { not: 'US' }));
  assert.ok(testMatch('X', { not: ['A', 'B'] }) && !testMatch('A', { not: ['A', 'B'] }));
  assert.ok(testMatch('Q', { in: ['Q'] }));
  assert.ok(testMatch(1, { feel: 'anything' }));                     // raw FEEL -> wildcard (no parser)
});

const triage = MODEL.decisions[0];
const fees = MODEL.decisions[1];

test('UNIQUE table — one output object per input set', () => {
  assert.deepStrictEqual(evaluateDecision(triage, { amount: 250000, region: 'US', type: 'DEATH', score: 80 }),
    { band: 'HIGH', fee: 'amount * 0.01' });                          // {feel} output returned verbatim
  assert.deepStrictEqual(evaluateDecision(triage, { amount: 4000, region: 'EU', type: 'TI', score: 40 }),
    { band: 'STANDARD', fee: 100 });
  assert.deepStrictEqual(evaluateDecision(triage, { amount: 0, region: 'US', type: 'TI', score: 10 }),
    { band: 'REJECT', fee: 0 });
});

test('UNIQUE table — no match returns null', () => {
  assert.strictEqual(evaluateDecision(triage, { amount: 250000, region: 'EU', type: 'TI', score: 10 }), null);
});

test('COLLECT + SUM aggregation', () => {
  assert.deepStrictEqual(evaluateDecision(fees, { kind: 'RUSH' }), { charge: 30 });   // one match -> sum 30
  assert.deepStrictEqual(evaluateDecision(fees, { kind: 'BASE' }), { charge: 50 });
});

test('COLLECT without aggregation -> array of all matches', () => {
  const model = { name: 'M', decisions: [{ name: 'M', hitPolicy: 'COLLECT',
    inputs: [{ name: 'n', type: 'number' }], outputs: [{ name: 'label', type: 'string' }],
    rules: [
      { when: { n: { gte: 0 } }, then: { label: 'nonneg' } },
      { when: { n: { lte: 10 } }, then: { label: 'small' } },
    ] }] };
  assert.deepStrictEqual(evaluateDecision(model.decisions[0], { n: 5 }), [{ label: 'nonneg' }, { label: 'small' }]);
});

test('evaluateModel runs every decision', () => {
  const out = evaluateModel(MODEL, { amount: 250000, region: 'US', type: 'DEATH', score: 80, kind: 'INTL' });
  assert.strictEqual(out.Triage.band, 'HIGH');
  assert.deepStrictEqual(out.FeeTotal, { charge: 20 });
});
