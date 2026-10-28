// Enumeration coverage — engine enums -> jBPM .enumeration ('Type.field' : [ … ]) + codec round-trip.
import { test } from 'node:test';
import assert from 'node:assert';
import { enumerationsToModel, buildAsset, parseAsset, fromEngineProject } from '../dist/index.mjs';
import { ENUMS } from '../examples/enumerations/15-enumerations.mjs';

test('enumerationsToModel — type/field/values -> Type.field map', () => {
  const m = enumerationsToModel(ENUMS);
  assert.deepStrictEqual(m.enums['Claim.status'], ['NEW', 'OPEN', 'APPROVED', 'REJECTED']);
  assert.deepStrictEqual(m.enums['Claim.type'], ['DEATH=Death claim', 'TI=Total & permanent disability']);
});

test('fromEngineProject — enums -> a single .enumeration file', () => {
  const proj = fromEngineProject({
    enumerations: ENUMS,
    processes: [{ id: 'p', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  });
  const enu = proj.descriptor.files['src/main/resources/enumerations.enumeration'];
  assert.ok(enu, 'default enumeration file path');
  assert.ok(enu.includes("'Claim.status' : [ 'NEW', 'OPEN', 'APPROVED', 'REJECTED' ]"));
  assert.ok(enu.includes("'Claim.type' : [ 'DEATH=Death claim', 'TI=Total & permanent disability' ]"));
});

test('no enumerations -> no file emitted', () => {
  const proj = fromEngineProject({ processes: [{ id: 'p', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }] });
  assert.ok(!proj.descriptor.files['src/main/resources/enumerations.enumeration']);
});

test('jBPM-side .enumeration codec — parse/build round-trip', () => {
  const enu = buildAsset({ kind: 'enumeration', model: enumerationsToModel(ENUMS) });
  const a = parseAsset('x.enumeration', enu);
  assert.strictEqual(a.kind, 'enumeration');
  assert.deepStrictEqual(a.model.enums['Claim.status'], ['NEW', 'OPEN', 'APPROVED', 'REJECTED']);
  assert.strictEqual(buildAsset(a), enu, 'round-trip stable');
});
