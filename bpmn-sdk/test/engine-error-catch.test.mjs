// A multi-host / global (*) error-catch expands on export to one BPMN boundary event per host activity,
// each sharing the catch's recovery flow.
import { test } from 'node:test';
import assert from 'node:assert';
import { fromEngine, validateModel, serializeProcess, parseBpmn } from '../dist/index.mjs';

const proc = (on) => ({
  id: 'com.acme.err', name: 'err', package: 'com.acme', vars: [],
  nodes: [
    { id: 's', type: 'start' },
    { id: 't1', type: 'manual', name: 'A' },
    { id: 't2', type: 'manual', name: 'B' },
    { id: 'c', type: 'boundary', name: 'Catch', on, event: { error: '*' }, interrupting: true },
    { id: 'rec', type: 'manual', name: 'Recover' },
    { id: 'e', type: 'end' },
  ],
  flows: [
    { id: 'f1', from: 's', to: 't1' }, { id: 'f2', from: 't1', to: 't2' }, { id: 'f3', from: 't2', to: 'e' },
    { id: 'f4', from: 'c', to: 'rec' }, { id: 'f5', from: 'rec', to: 'e' },
  ],
});

test('explicit multi-host error-catch → one boundary event per host, sharing the recovery flow', () => {
  const m = fromEngine(proc(['t1', 't2']));
  const bounds = m.nodes.filter((n) => n.type === 'boundaryEvent');
  assert.strictEqual(bounds.length, 2, 'one boundary per host');
  assert.deepStrictEqual(bounds.map((b) => b.attachedTo).sort(), ['t1', 't2']);
  for (const b of bounds) assert.ok(m.flows.some((f) => f.sourceRef === b.id && f.targetRef === 'rec'), `${b.id} → rec`);
  assert.ok(validateModel(m).ok);
  assert.ok(parseBpmn(serializeProcess(m)).nodes.length >= m.nodes.length - 0, 'serializes + reparses');
});

test('global (*) error-catch → a boundary on every activity except its own recovery path', () => {
  const m = fromEngine(proc(['*']));
  const bounds = m.nodes.filter((n) => n.type === 'boundaryEvent');
  const hosts = bounds.map((b) => b.attachedTo).sort();
  // activities are t1, t2, rec — global attaches to t1 & t2 but NOT rec (its recovery entry)
  assert.deepStrictEqual(hosts, ['t1', 't2']);
  assert.ok(validateModel(m).ok);
});
