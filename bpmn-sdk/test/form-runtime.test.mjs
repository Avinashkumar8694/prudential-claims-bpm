// The reference form helper (examples/functions/form) uses an engine FORM at runtime: build a UI
// render model (widgets derived from the type) and validate a submission (required fields).
import { test } from 'node:test';
import assert from 'node:assert';
import { renderModel, validateSubmission } from '../examples/functions/form.mjs';
import { FORM, CLAIM_TYPE } from '../examples/forms/14-form-to-frm.mjs';

test('renderModel — widgets derived from type, explicit widget wins, label defaults', () => {
  const model = renderModel(FORM, CLAIM_TYPE);
  const by = Object.fromEntries(model.map((f) => [f.bind, f]));
  assert.strictEqual(by.amount.widget, 'number');   // double
  assert.strictEqual(by.status.widget, 'text');     // string
  assert.strictEqual(by.urgent.widget, 'checkbox');  // boolean
  assert.strictEqual(by.notes.widget, 'textarea');   // explicit override
  assert.strictEqual(by.urgent.label, 'Urgent', 'humanized default label');
  assert.strictEqual(by.amount.readOnly, true);
  assert.strictEqual(by.status.required, true);
});

test('validateSubmission — required fields must be present', () => {
  assert.deepStrictEqual(validateSubmission(FORM, {}), [{ bind: 'status', error: 'required' }]);
  assert.deepStrictEqual(validateSubmission(FORM, { status: '' }), [{ bind: 'status', error: 'required' }]);
  assert.deepStrictEqual(validateSubmission(FORM, { status: 'OPEN' }), []);
});
