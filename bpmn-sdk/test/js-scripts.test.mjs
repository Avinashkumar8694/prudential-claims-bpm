import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBpmn, serializeProcess } from '../dist/index.mjs';
import { buildJsProject, CLASSIFY_JS, BOOT_JS, NOTIFY_JS, COND_HIGH_JS, COND_OTHER_JS } from '../examples/jbpm-project/04-js-scripts.mjs';

const JS = 'http://www.javascript.com/javascript';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'js-'));
const { project } = buildJsProject(out);
const bpmnPath = path.join(out, 'src/main/resources/org/jbpm/js-classify.bpmn');
const xml = fs.readFileSync(bpmnPath, 'utf8');

test('JS script tasks are emitted with the JavaScript dialect + CDATA body', () => {
  assert.ok(xml.includes(`scriptFormat="${JS}"`), 'JS scriptFormat attr present');
  // the multiline JS body (with && and >) survives inside CDATA, unescaped
  assert.ok(xml.includes('amt > 100000'), 'operator > preserved (CDATA)');
  assert.ok(xml.includes('amt != null && amt > 10000'), '&& preserved (CDATA)');
  assert.ok(xml.includes('<![CDATA[' ), 'script wrapped in CDATA');
});

test('JS gateway conditions emitted with JavaScript language', () => {
  assert.ok(xml.includes(`language="${JS}"`), 'JS condition language present');
  assert.ok(xml.includes('tier == "HIGH"'), 'JS condition body present');
});

test('round-trip preserves JS script bodies EXACTLY (byte-for-byte)', () => {
  const m = parseBpmn(xml);
  const byId = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
  assert.strictEqual(byId['_boot'].scriptFormat, JS);
  assert.strictEqual(byId['_boot'].script, BOOT_JS);
  assert.strictEqual(byId['_classify'].scriptFormat, JS);
  assert.strictEqual(byId['_classify'].script, CLASSIFY_JS, 'multiline JS body identical');
  assert.strictEqual(byId['_notify'].script, NOTIFY_JS);
});

test('round-trip preserves JS conditions + dialect EXACTLY', () => {
  const m = parseBpmn(xml);
  const byId = Object.fromEntries(m.flows.map((f) => [f.id, f]));
  assert.strictEqual(byId['fHigh'].condition, COND_HIGH_JS);
  assert.strictEqual(byId['fHigh'].conditionLanguage, JS);
  assert.strictEqual(byId['fOther'].condition, COND_OTHER_JS);
  assert.strictEqual(byId['fOther'].conditionLanguage, JS);
});

test('double round-trip is stable (parse -> serialize -> parse -> serialize identical scripts)', () => {
  const m1 = parseBpmn(xml);
  const xml2 = serializeProcess(m1);
  const m2 = parseBpmn(xml2);
  for (const id of ['_boot', '_classify', '_notify']) {
    const a = m1.nodes.find((n) => n.id === id);
    const b = m2.nodes.find((n) => n.id === id);
    assert.strictEqual(b.script, a.script, `${id} script stable`);
    assert.strictEqual(b.scriptFormat, a.scriptFormat, `${id} dialect stable`);
  }
});

test('tricky characters in a JS body survive (<, >, &&, quotes, newlines)', () => {
  const tricky = 'var a = 1;\nif (a < 2 && a > 0) { print("a=" + a + " <ok>"); }';
  const proc = { id: 'p', name: 'p', declarations: { signals: [], errors: [] }, variables: [],
    nodes: [{ id: 'n', type: 'scriptTask', name: 'T', scriptFormat: JS, script: tricky, incoming: [], outgoing: [] }], flows: [] };
  const back = parseBpmn(serializeProcess(proc));
  assert.strictEqual(back.nodes[0].script, tricky, 'tricky JS preserved verbatim');
});

test.after(() => fs.rmSync(out, { recursive: true, force: true }));
