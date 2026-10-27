// Guided decision table coverage — engine tabular ruleset -> Business Central decision-table52 XML.
// Column/operator/type mapping, row data, empty cells, round-trip + well-formedness, generation.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decisionTableToGdst, buildAsset, parseAsset, fromEngineProject } from '../dist/index.mjs';
import { TABLE } from '../examples/guided/13-guided-decision-table.mjs';

// column types are derived from the fact type; standalone (no project) we pass the map explicitly
const CLAIM_TYPES = { amount: 'number', region: 'string', status: 'string', priority: 'string' };

test('decisionTableToGdst — structure, columns, operators, types, rows', () => {
  const gdst = buildAsset({ kind: 'guidedDecisionTable', model: decisionTableToGdst(TABLE, 'com.acme.rules', CLAIM_TYPES) });
  assert.ok(gdst.includes('<tableFormat>EXTENDED_ENTRY</tableFormat>'));
  assert.ok(gdst.includes('<factType>Claim</factType>') && gdst.includes('<boundName>claim</boundName>'), 'bind defaults to lowercased fact');
  // condition column: field + operator (escaped) + java fieldType
  assert.ok(gdst.includes('<factField>amount</factField>') && gdst.includes('<operator>&gt;</operator>') && gdst.includes('<fieldType>Double</fieldType>'));
  assert.ok(gdst.includes('<factField>region</factField>') && gdst.includes('<operator>==</operator>') && gdst.includes('<fieldType>String</fieldType>'));
  // action set-field column
  assert.ok(gdst.includes('<action-set-field-column52>') && gdst.includes('<factField>status</factField>') && gdst.includes('<type>String</type>'));
  // packageName
  assert.ok(gdst.includes('<packageName>com.acme.rules</packageName>'));
  // data: row 1 STANDARD (amount 5000, region empty), row 2 HIGH (amount 100000, region US)
  assert.ok(gdst.includes('<valueString>5000</valueString>') && gdst.includes('<valueString>STANDARD</valueString>'));
  assert.ok(gdst.includes('<valueString>100000</valueString>') && gdst.includes('<valueString>US</valueString>') && gdst.includes('<valueString>HIGH</valueString>'));
});

test('operator + type mapping — every op / type', () => {
  const gdst = buildAsset({ kind: 'guidedDecisionTable', model: decisionTableToGdst({
    name: 'Ops', fact: 'F', bind: 'f',
    conditions: [
      { field: 'a', op: 'eq', type: 'string' }, { field: 'b', op: 'ne', type: 'int' },
      { field: 'c', op: 'gt', type: 'number' }, { field: 'd', op: 'gte', type: 'long' },
      { field: 'e', op: 'lt', type: 'boolean' }, { field: 'g', op: 'lte', type: 'double' },
    ],
    actions: [{ field: 'out', type: 'string' }],
    rows: [{ when: {}, then: { out: 'x' } }],
  }, 'p') });
  for (const op of ['==', '!=', '&gt;', '&gt;=', '&lt;', '&lt;=']) assert.ok(gdst.includes(`<operator>${op}</operator>`), op);
  for (const t of ['String', 'Integer', 'Double', 'Long', 'Boolean']) assert.ok(gdst.includes(`<fieldType>${t}</fieldType>`), t);
  for (const d of ['STRING', 'NUMERIC_INTEGER', 'NUMERIC_DOUBLE', 'BOOLEAN']) assert.ok(gdst.includes(`<dataType>${d}</dataType>`), d);
});

test('empty cell for a condition omitted in a row', () => {
  const gdst = buildAsset({ kind: 'guidedDecisionTable', model: decisionTableToGdst(TABLE, 'com.acme.rules') });
  // row 1 omits `region` -> an empty <valueString/> cell exists
  assert.ok(gdst.includes('<valueString/>'), 'empty condition cell');
});

test('round-trip stable + well-formed (xmllint)', () => {
  const gdst = buildAsset({ kind: 'guidedDecisionTable', model: decisionTableToGdst(TABLE, 'com.acme.rules') });
  assert.strictEqual(buildAsset(parseAsset('t.gdst', gdst)), gdst, 'round-trip stable');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdst-')); const p = path.join(tmp, 't.gdst'); fs.writeFileSync(p, gdst);
  execSync(`xmllint --noout "${p}"`, { stdio: 'pipe' });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('fromEngineProject — column types DERIVED from the declared fact type', () => {
  const proj = fromEngineProject({
    // the fact type is declared once; the guided table's columns carry no `type`
    types: [{ name: 'Claim', fields: [{ name: 'amount', type: 'double' }, { name: 'region', type: 'string' }, { name: 'status', type: 'string' }, { name: 'priority', type: 'string' }] }],
    guidedTables: [TABLE],
    processes: [{ id: 'p', package: 'com.acme', nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], flows: [{ from: 's', to: 'e' }] }],
  });
  const gdst = proj.descriptor.files['src/main/resources/com/acme/rules/Claim_classification.gdst'];
  assert.ok(gdst, 'default path (package com.acme.rules, name -> Claim_classification.gdst)');
  assert.ok(gdst.includes('<packageName>com.acme.rules</packageName>'));
  // amount column typed Double even though the TABLE column has no `type` (derived from Claim.amount)
  assert.ok(gdst.includes('<fieldType>Double</fieldType>'), 'amount type derived from declared Claim');
  assert.ok(gdst.includes('<factField>amount</factField>') && gdst.includes('<operator>&gt;</operator>'));
});
