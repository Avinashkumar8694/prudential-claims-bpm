// Form coverage — engine form -> jBPM .frm (widget derivation + override, label default, className
// resolution, flags, default path, codec round-trip). Mirrors docs/bpm-assets/form/scenarios.md.
import { test } from 'node:test';
import assert from 'node:assert';
import { formToFrm, buildAsset, parseAsset, fromEngineProject, makeTypeResolver } from '../dist/index.mjs';
import { FORM, CLAIM_TYPE } from '../examples/forms/14-form-to-frm.mjs';

const fieldTypes = Object.fromEntries(CLAIM_TYPE.fields.map((f) => [f.name, f.type]));
const resolve = makeTypeResolver([{ name: 'Claim', package: 'com.acme.model', fields: CLAIM_TYPE.fields }]);

test('formToFrm — widget derived from field type, className resolved, flags', () => {
  const { json } = formToFrm(FORM, fieldTypes, resolve);
  assert.strictEqual(json.model.className, 'com.acme.model.Claim', 'type -> className FQN');
  const by = Object.fromEntries(json.fields.map((f) => [f.id, f]));
  assert.strictEqual(by.amount.code, 'DoubleBox');   // double -> DoubleBox
  assert.strictEqual(by.status.code, 'TextBox');     // string -> TextBox
  assert.strictEqual(by.urgent.code, 'CheckBox');    // boolean -> CheckBox
  assert.strictEqual(by.notes.code, 'TextArea');     // explicit widget override
  // flags + label + binding
  assert.strictEqual(by.amount.readOnly, true);
  assert.strictEqual(by.status.required, true);
  assert.strictEqual(by.urgent.label, 'Urgent', 'label defaults to humanized bind');
  assert.strictEqual(by.status.binding, 'status');
});

test('formToFrm — every friendly widget maps to its jBPM code', () => {
  const { json } = formToFrm({ name: 'W', fields: [
    { bind: 'a', widget: 'text' }, { bind: 'b', widget: 'textarea' }, { bind: 'c', widget: 'integer' },
    { bind: 'd', widget: 'number' }, { bind: 'e', widget: 'checkbox' }, { bind: 'f', widget: 'dropdown' },
    { bind: 'g', widget: 'radio' }, { bind: 'h', widget: 'date' },
  ] });
  const codes = json.fields.map((f) => f.code);
  assert.deepStrictEqual(codes, ['TextBox', 'TextArea', 'IntegerBox', 'DoubleBox', 'CheckBox', 'ListBox', 'RadioGroup', 'DatePicker']);
});

test('formToFrm — no type -> no className, widgets default to TextBox', () => {
  const { json } = formToFrm({ name: 'F', fields: [{ bind: 'x' }] });
  assert.ok(!json.model.className, 'no className without a type');
  assert.strictEqual(json.fields[0].code, 'TextBox');
});

test('fromEngineProject — form -> .frm at default path, widgets derived from declared type', () => {
  const proj = fromEngineProject({
    types: [{ name: 'Claim', fields: CLAIM_TYPE.fields }],
    forms: [FORM],
    processes: [{ id: 'p', package: 'com.acme', nodes: [{ id: 's', type: 'start' }, { id: 'u', type: 'userTask', name: 'Review', form: 'ClaimReview' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'u' }, { from: 'u', to: 'e' }] }],
  });
  const frm = proj.descriptor.files['src/main/resources/forms/ClaimReview.frm'];
  assert.ok(frm, 'default path src/main/resources/forms/<name>.frm');
  const json = JSON.parse(frm);
  assert.strictEqual(json.model.className, 'com.acme.model.Claim');
  assert.strictEqual(json.fields.find((f) => f.id === 'amount').code, 'DoubleBox', 'derived from declared Claim.amount');
});

test('jBPM-side .frm codec — parse/build round-trip', () => {
  const frm = buildAsset({ kind: 'form', model: formToFrm(FORM, fieldTypes, resolve) });
  const a = parseAsset('ClaimReview.frm', frm);
  assert.strictEqual(a.kind, 'form');
  assert.strictEqual(a.model.json.name, 'ClaimReview');
  assert.strictEqual(buildAsset(a), frm, 'round-trip stable');
});
