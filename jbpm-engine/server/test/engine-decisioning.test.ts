// Decision-tree and scorecard runtime (Node-native; the SDK exports the same models to .gdt/.scgd).
// Pure evaluator tests over an engine-project fragment + instance variables.
import { test } from 'node:test';
import assert from 'node:assert';
import { evaluateDecisionTree, evaluateScorecard } from '../src/engine/decisioning.ts';

const engine: any = {
  decisionTrees: [{
    name: 'triage', fact: '', root: {
      test: { field: 'amount' },
      branches: [
        { match: { gt: 10000 }, then: { output: { tier: 'high', queue: 'senior' } } },
        { match: { gt: 1000 }, then: {
          test: { field: 'region' },
          branches: [
            { match: 'EU', then: { output: { tier: 'mid', queue: 'eu-ops' } } },
            { match: '-', then: { output: { tier: 'mid', queue: 'ops' } } },
          ],
        } },
        { match: '-', then: { output: { tier: 'low', queue: 'auto' } } },
      ],
    },
  }],
  scorecards: [{
    name: 'credit', fact: '', baseline: 500, target: 'score',
    characteristics: [
      { field: 'age', attributes: [{ match: { gte: 30 }, points: 40, reason: 'age>=30' }, { match: '-', points: 10 }] },
      { field: 'defaults', attributes: [{ match: 0, points: 60, reason: 'clean' }, { match: '-', points: -50, reason: 'has-defaults' }] },
    ],
  }],
};

test('decision tree descends the first matching branch and applies leaf outputs', () => {
  assert.deepStrictEqual(evaluateDecisionTree(engine, 'triage', { amount: 50000 }), { tier: 'high', queue: 'senior' });
  assert.deepStrictEqual(evaluateDecisionTree(engine, 'triage', { amount: 5000, region: 'EU' }), { tier: 'mid', queue: 'eu-ops' });
  assert.deepStrictEqual(evaluateDecisionTree(engine, 'triage', { amount: 5000, region: 'US' }), { tier: 'mid', queue: 'ops' });
  assert.deepStrictEqual(evaluateDecisionTree(engine, 'triage', { amount: 50 }), { tier: 'low', queue: 'auto' });
});

test('scorecard sums baseline + first-matching attribute points and collects reasons', () => {
  const good = evaluateScorecard(engine, 'credit', { age: 35, defaults: 0 });
  assert.strictEqual(good.score, 500 + 40 + 60);
  assert.deepStrictEqual(good.scoreReasons, ['age>=30', 'clean']);

  const risky = evaluateScorecard(engine, 'credit', { age: 20, defaults: 2 });
  assert.strictEqual(risky.score, 500 + 10 - 50);
  assert.deepStrictEqual(risky.scoreReasons, ['has-defaults']);
});

test('missing model throws (routed to RULE_ERROR by the node handler)', () => {
  assert.throws(() => evaluateDecisionTree(engine, 'nope', {}), /not found/);
  assert.throws(() => evaluateScorecard(engine, 'nope', {}), /not found/);
});
