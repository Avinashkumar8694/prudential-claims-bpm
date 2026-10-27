// The reference schema helper (examples/functions/data-object) uses an engine TYPE at runtime:
// instantiate a default object, and validate a plain object's field JS-types against the schema.
import { test } from 'node:test';
import assert from 'node:assert';
import { instantiate, validate } from '../examples/functions/data-object.mjs';
import { TYPES } from '../examples/data-objects/12-types-to-pojo.mjs';

const Claim = TYPES.find((t) => t.name === 'Claim');

test('instantiate — defaults per field type', () => {
  assert.deepStrictEqual(instantiate(Claim), {
    id: '', amount: 0, open: false, filedOn: null, address: null, items: [], tags: [],
  });
});

test('validate — a well-typed object passes', () => {
  const good = { id: 'C1', amount: 5000, open: true, filedOn: null, address: { city: 'NYC', zip: '10001' }, items: [], tags: ['vip'] };
  assert.deepStrictEqual(validate(Claim, good), []);
});

test('validate — reports every field type mismatch', () => {
  const bad = { id: 'C2', amount: 'lots', open: 'yes', items: {}, tags: 'nope' };
  const errs = validate(Claim, bad);
  const byField = Object.fromEntries(errs.map((e) => [e.field, e]));
  assert.ok(byField.amount && byField.amount.expected === 'double' && byField.amount.got === 'string');
  assert.ok(byField.open && byField.open.expected === 'boolean');
  assert.ok(byField.items && byField.items.expected === 'LineItem[]' && byField.items.got === 'object');
  assert.ok(byField.tags && byField.tags.expected === 'string[]' && byField.tags.got === 'string');
  // id (string) and null/absent fields are fine
  assert.ok(!byField.id);
});
