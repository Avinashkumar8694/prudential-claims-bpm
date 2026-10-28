// The reference guided-table evaluator (examples/functions/guided-table) applies the tabular ruleset
// to a fact: match condition columns, apply matching rows' set-actions in order (later overrides).
import { test } from 'node:test';
import assert from 'node:assert';
import { evaluateGuidedTable } from '../examples/functions/guided-table.mjs';
import { TABLE } from '../examples/guided/13-guided-decision-table.mjs';

test('both rows match -> later (more specific) row wins', () => {
  const { fact, fired } = evaluateGuidedTable(TABLE, { amount: 250000, region: 'US', status: 'NEW', priority: '' });
  assert.deepStrictEqual(fired, [1, 2]);
  assert.strictEqual(fact.status, 'HIGH');
  assert.strictEqual(fact.priority, 'P1');
});

test('only the general row matches (region differs)', () => {
  const { fact, fired } = evaluateGuidedTable(TABLE, { amount: 8000, region: 'EU', status: 'NEW', priority: '' });
  assert.deepStrictEqual(fired, [1]);
  assert.strictEqual(fact.status, 'STANDARD');
});

test('no row matches -> fact unchanged', () => {
  const input = { amount: 100, region: 'US', status: 'NEW', priority: '' };
  const { fact, fired } = evaluateGuidedTable(TABLE, input);
  assert.deepStrictEqual(fired, []);
  assert.deepStrictEqual(fact, input);
});

test('empty condition cell = no constraint (matches any region)', () => {
  // row 1 has no region cell, so it matches regardless of region
  const { fired } = evaluateGuidedTable(TABLE, { amount: 9000, region: 'ANYTHING' });
  assert.deepStrictEqual(fired, [1]);
});
