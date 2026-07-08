// The reference enumeration helper (examples/functions/enumeration) uses engine enums at runtime:
// populate dropdown options (with/without labels) and validate a value.
import { test } from 'node:test';
import assert from 'node:assert';
import { optionsFor, labeledOptionsFor, isAllowed } from '../examples/functions/enumeration.mjs';
import { ENUMS } from '../examples/enumerations/15-enumerations.mjs';

test('optionsFor — stored values (labels stripped)', () => {
  assert.deepStrictEqual(optionsFor(ENUMS, 'Claim', 'status'), ['NEW', 'OPEN', 'APPROVED', 'REJECTED']);
  assert.deepStrictEqual(optionsFor(ENUMS, 'Claim', 'type'), ['DEATH', 'TI']);         // "KEY=Label" -> KEY
  assert.deepStrictEqual(optionsFor(ENUMS, 'Claim', 'missing'), []);                    // no enum -> []
});

test('labeledOptionsFor — value + display label', () => {
  assert.deepStrictEqual(labeledOptionsFor(ENUMS, 'Claim', 'type'), [
    { value: 'DEATH', label: 'Death claim' },
    { value: 'TI', label: 'Total & permanent disability' },
  ]);
});

test('isAllowed — constrains only fields that have an enumeration', () => {
  assert.ok(isAllowed(ENUMS, 'Claim', 'status', 'APPROVED'));
  assert.ok(!isAllowed(ENUMS, 'Claim', 'status', 'BOGUS'));
  assert.ok(isAllowed(ENUMS, 'Claim', 'type', 'DEATH'));       // matches the KEY, not the label
  assert.ok(isAllowed(ENUMS, 'Claim', 'amount', 12345), 'no enum on amount -> anything allowed');
});
