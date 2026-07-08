// Data object coverage — engine type -> Java POJO (field-type mapping, nested, typed collections,
// default package) and the jBPM-side codec (parse/write round-trip). Mirrors docs/bpm-assets/data-object.
import { test } from 'node:test';
import assert from 'node:assert';
import { parseDataObject, writeDataObject, buildAsset, parseAsset, fromEngineProject } from '../dist/index.mjs';
import { TYPES } from '../examples/data-objects/12-types-to-pojo.mjs';

test('fromEngineProject — engine types -> .java POJOs (mapping, nested, typed collections)', () => {
  const proj = fromEngineProject({
    id: 'com.acme.claims', types: TYPES,
    processes: [{ id: 'p', package: 'com.acme', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  });
  const f = proj.descriptor.files;
  // package defaulted from process package -> com.acme.model
  const claim = f['src/main/java/com/acme/model/Claim.java'];
  assert.ok(claim, 'Claim.java at defaulted package path');
  assert.ok(f['src/main/java/com/acme/model/Address.java'] && f['src/main/java/com/acme/model/LineItem.java'], 'all types generated');
  // primitive mapping
  assert.ok(claim.includes('private String id;'));
  assert.ok(claim.includes('private double amount;'));
  assert.ok(claim.includes('private boolean open;'));
  assert.ok(claim.includes('private java.util.Date filedOn;'));
  // nested declared type -> FQN
  assert.ok(claim.includes('private com.acme.model.Address address;'));
  // typed collections
  assert.ok(claim.includes('private java.util.List<com.acme.model.LineItem> items;'), 'List<FQN>');
  assert.ok(claim.includes('private java.util.List<String> tags;'), 'List<String>');
  // getters/setters generated
  assert.ok(claim.includes('public java.util.List<com.acme.model.LineItem> getItems()'));
});

test('every primitive field type maps correctly', () => {
  const proj = fromEngineProject({
    types: [{ name: 'AllTypes', fields: [
      { name: 'a', type: 'string' }, { name: 'b', type: 'int' }, { name: 'c', type: 'long' },
      { name: 'd', type: 'double' }, { name: 'e', type: 'float' }, { name: 'g', type: 'number' },
      { name: 'h', type: 'bool' }, { name: 'i', type: 'boolean' }, { name: 'j', type: 'date' },
      { name: 'k', type: 'object' }, { name: 'l', type: 'map' }, { name: 'm', type: 'list' },
      { name: 'n', type: 'int', list: true },
    ] }],
    processes: [{ id: 'p', package: 'com.acme', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  });
  const j = proj.descriptor.files['src/main/java/com/acme/model/AllTypes.java'];
  for (const frag of ['private String a;', 'private int b;', 'private long c;', 'private double d;',
    'private double e;', 'private double g;', 'private boolean h;', 'private boolean i;',
    'private java.util.Date j;', 'private Object k;', 'private java.util.Map l;', 'private java.util.List m;',
    'private java.util.List<Integer> n;']) {
    assert.ok(j.includes(frag), `missing: ${frag}`);
  }
});

test('jBPM-side DataObjectModel — parse/write round-trip', () => {
  const src = writeDataObject({ package: 'com.acme.model', className: 'Claim', fields: [{ name: 'id', type: 'String' }, { name: 'amount', type: 'double' }] });
  const m = parseDataObject(src);
  assert.strictEqual(m.package, 'com.acme.model');
  assert.strictEqual(m.className, 'Claim');
  assert.deepStrictEqual(m.fields.map((x) => x.name).sort(), ['amount', 'id']);
  assert.ok(src.includes('public double getAmount()') && src.includes('public void setAmount(double amount)'));
  // parseAsset/buildAsset stable
  const a = parseAsset('Claim.java', src);
  assert.strictEqual(a.kind, 'dataObject');
  assert.strictEqual(buildAsset(a), src, 'round-trip stable');
});
